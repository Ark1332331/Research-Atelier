import type { PaperHit } from "@/lib/paper-tools";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REQUESTS = 8;
const MAX_HOPS = 3;
const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2001::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function sourceUrl(value: string, base?: string): URL {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new Error("无效的来源地址"); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port)) || !hostname.includes(".") && !isIP(hostname) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(hostname) || isIP(hostname) && !publicAddress(hostname)) {
    throw new Error("来源地址必须是公开的 HTTP(S) 地址");
  }
  url.hash = "";
  return url;
}

async function validateHost(url: URL): Promise<LookupAddress[]> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return [{ address:hostname, family:isIP(hostname) }];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    dns.lookup(hostname, { all: true }),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("来源 DNS 解析超时")),5000);}),
  ]).finally(()=>clearTimeout(timer));
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("来源地址必须解析到公开网络地址");
  return addresses;
}

type SourceFetcher = (url: string, options: RequestInit, addresses: LookupAddress[]) => Promise<Response>;

/** Pin every connection to the validated DNS result, including redirect targets. */
const fetchPublic: SourceFetcher = (url, options, addresses) => new Promise((resolve,reject) => {
  const transport = new URL(url).protocol === "https:" ? https : http;
  const request = transport.request(url, {
    method:"GET", headers:Object.fromEntries(new Headers(options.headers)), signal:options.signal || undefined,
    lookup: (_hostname, lookupOptions, callback) => {
      const family = lookupOptions.family;
      const available = family ? addresses.filter(address=>address.family===family) : addresses;
      if (!available.length) { callback(new Error("来源没有可用的公开网络地址"), "", 4); return; }
      if (lookupOptions.all) callback(null,available);
      else callback(null,available[0].address,available[0].family);
    },
  }, incoming => {
    const headers = new Headers();
    for (const [key,value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key,Array.isArray(value)?value.join(", "):value);
    const status = incoming.statusCode || 502;
    if ([204,205,304].includes(status)) { incoming.resume(); resolve(new Response(null,{status,headers})); }
    else resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {status,headers}));
  });
  request.on("error",reject);
  request.end();
});

function text(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" " };
    if (entity.startsWith("#")) {
      const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return named[entity.toLowerCase()] || match;
  }).replace(/\s+/g," ").trim();
}

function attributes(tag: string): Record<string,string> {
  const values: Record<string,string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) values[match[1].toLowerCase()] = text(match[2] ?? match[3] ?? match[4]);
  return values;
}

function element(html: string, tag: string): string {
  return text(html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}

function arxivId(url: string): string | undefined {
  const match = url.match(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?(?:[?#].*)?$/i);
  return match?.[1];
}

type Page = { url: string; body: string; pdf: boolean };
type Budget = { requests: number; deadline: number; visited: Set<string>; fetch: SourceFetcher };

async function fetchPage(input: string, budget: Budget): Promise<Page> {
  let url = sourceUrl(input);
  for (let redirect = 0; redirect <= MAX_HOPS; redirect++) {
    if (budget.requests >= MAX_REQUESTS || Date.now() >= budget.deadline) throw new Error("来源解析已达到请求或时间上限");
    const addresses = await validateHost(url);
    budget.requests++;
    const response = await budget.fetch(url.href, {
      redirect:"manual", cache:"no-store", signal:AbortSignal.timeout(Math.max(1,Math.min(12000,budget.deadline-Date.now()))),
      headers:{"User-Agent":"Mozilla/5.0 (ResearchAtelier; scholarly source resolver)", Accept:"text/html,application/atom+xml,application/json,application/pdf;q=0.9,*/*;q=0.5", ...(/\.pdf(?:$|\?)|arxiv\.org\/pdf\//i.test(url.href) ? {Range:"bytes=0-1023"} : {})},
    },addresses);
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const target = response.headers.get("location");
      if (!target || redirect === MAX_HOPS) throw new Error("来源地址重定向过多或缺少目标");
      url = sourceUrl(target,url.href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`来源访问失败（HTTP ${response.status}）：${url.hostname}`); }
    // PDF streams are cancelled after their signature; full documents are downloaded only on import.
    const reader = response.body?.getReader();
    if (!reader) return {url:url.href,body:"",pdf:false};
    const declaredPdf = /application\/pdf/i.test(response.headers.get("content-type") || "");
    if (!declaredPdf && Number(response.headers.get("content-length")) > MAX_BYTES) { await reader.cancel(); throw new Error("来源页面过大"); }
    const decoder = new TextDecoder();
    let body = "";
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        body += decoder.decode(chunk.value, {stream:true});
        if (/^\s*%PDF-\d\.\d/.test(body.slice(0,1024))) return {url:url.href,body:"",pdf:true};
        if (declaredPdf && size >= 1024) throw new Error("来源返回的文件不是有效 PDF");
        if (size > MAX_BYTES) throw new Error("来源页面过大");
      }
      body += decoder.decode();
      return {url:url.href,body,pdf:false};
    } finally { await reader.cancel().catch(()=>{}); }
  }
  throw new Error("来源地址重定向过多");
}

function metadata(page: Page, fallback: string): { hit: PaperHit; pdf?: string; scholarly: boolean } {
  const meta = new Map<string,string[]>();
  for (const tag of page.body.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag[0]);
    const key = (attrs.name || attrs.property || "").toLowerCase();
    if (key && attrs.content) meta.set(key,[...(meta.get(key) || []),attrs.content]);
  }
  const first = (...keys: string[]) => keys.map(key=>meta.get(key)?.[0]).find(Boolean) || "";
  const title = first("citation_title","dc.title","og:title","twitter:title") || element(page.body,"h1") || element(page.body,"title") || fallback;
  const date = first("citation_publication_date","citation_date","dc.date","article:published_time");
  return {
    scholarly: Boolean(first("citation_title","citation_pdf_url")), pdf:first("citation_pdf_url") || undefined,
    hit: {
      id:page.url, title, authors:(meta.get("citation_author") || meta.get("dc.creator") || []).join(", "), year:date.match(/\b(?:19|20)\d{2}\b/)?.[0] || "",
      abstract:first("citation_abstract","dc.description","description","og:description"), doi:first("citation_doi","dc.identifier.doi") || undefined,
      arxivId:arxivId(page.url), isOa:false, publisherUrl:page.url,
      publisherName:first("citation_journal_title","citation_conference_title","og:site_name") || new URL(page.url).hostname,
    },
  };
}

type Link = { url: string; label: string; priority: number };
function paperLinks(page: Page, name: string): Link[] {
  // GitHub navigation is unrelated to the repository. Documentation footers and
  // bibliographies likewise must not supply another paper merely because it is linked.
  let body = page.body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,"");
  if (new URL(page.url).hostname === "github.com") body = body.match(/<article\b[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/article>/i)?.[1] || body;
  else body = body.replace(/<(nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,"");
  body = body.split(/<h[1-6]\b[^>]*>\s*(?:<[^>]*>\s*)*(?:references|bibliography|related work|related papers)\b|^#{1,6}\s+(?:references|bibliography|related work|related papers)\b/im)[0];
  const links: Link[] = [];
  const add = (href: string, label: string) => {
    if (!href || href.startsWith("#")) return;
    let url: URL;
    try { url = sourceUrl(href,page.url); } catch { return; }
    const normalized = text(label).replace(/[\s\[\]📝📄📜]+/g," ").trim();
    const explicit = /^(?:(?:read|view|download|our|the|full|research|official)\s+)*(?:paper|publication|preprint|technical\s*report|research\s*report|pdf|arxiv)(?:\s*(?:\(.*\)|\[.*\]|pdf|here|→|↗|↗️|:.*))?$/i.test(normalized);
    const named = name.length > 2 && normalized.toLowerCase().includes(name.toLowerCase()) && /paper|report|arxiv|publication|\.pdf/i.test(`${normalized} ${url.href}`);
    if (!explicit && !named) return;
    if (/supplement|appendix|poster|slide|license|dataset/i.test(`${normalized} ${url.pathname}`)) return;
    links.push({url:url.href,label:normalized,priority:/\.pdf(?:$|\?)|arxiv\.org\/(?:abs|pdf)\//i.test(url.href) ? 2 : 1});
  };
  for (const anchor of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = attributes(anchor[1]);
    const imageLabels = [...anchor[2].matchAll(/<img\b[^>]*>/gi)].map(img=>attributes(img[0]).alt || "").join(" ");
    let label = `${text(anchor[2])} ${imageLabels}`;
    if (text(anchor[2]) === attrs.href) {
      const prefix = text(body.slice(Math.max(0,anchor.index!-250),anchor.index).replace(/<[^>]*>/g," "));
      label = prefix.match(/\b(paper|technical report|publication|preprint)\s*[:：]\s*$/i)?.[1] || label;
    }
    add(attrs.href,label);
  }
  for (const match of body.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)) add(match[2],match[1]);
  for (const match of body.matchAll(/^\s*(?:[-*]\s+)?(?:\*\*)?(paper|technical report|publication|preprint)(?:\*\*)?\s*[:：]\s*(https?:\/\/[^\s<>]+)/gim)) add(match[2],match[1]);
  return [...new Map(links.sort((a,b)=>b.priority-a.priority).map(link=>[link.url,link])).values()].slice(0,4);
}

async function arxivFallback(identifier: string, budget: Budget): Promise<PaperHit[]> {
  const page = await fetchPage(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifier)}&max_results=1`,budget);
  if (!/<feed\b/i.test(page.body)) throw new Error("arXiv 返回了无效的来源响应");
  const hits: PaperHit[] = [];
  for (const match of page.body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const entry = match[1];
    const identity = element(entry,"id");
    const id = arxivId(identity);
    if (!id || (identifier.match(/v\d+$/) ? id !== identifier : id.replace(/v\d+$/,"") !== identifier)) continue;
    const title = element(entry,"title");
    if (!title) continue;
    const hit: PaperHit = {id:identity, arxivId:id, title, authors:[...entry.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)].map(author=>element(author[1],"name")).join(", "), year:element(entry,"published").slice(0,4), abstract:element(entry,"summary"), doi:element(entry,"arxiv:doi") || undefined, isOa:false,publisherUrl:identity,publisherName:"arXiv"};
    for (const tag of entry.matchAll(/<link\b[^>]*>/gi)) {
      const attrs = attributes(tag[0]);
      if ((attrs.type === "application/pdf" || attrs.title === "pdf") && arxivId(attrs.href || "") === id) {
        try { const pdf = await fetchPage(attrs.href,budget); if(pdf.pdf) {hit.oaPdfUrl=pdf.url;hit.isOa=true;} } catch { /* Metadata remains useful when the PDF host is temporarily unavailable. */ }
        break;
      }
    }
    hits.push(hit);
  }
  return hits;
}

async function githubReadme(url: string, budget: Budget): Promise<Page | undefined> {
  const parsed = new URL(url);
  const repo = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (parsed.hostname !== "github.com" || !repo) return;
  const page = await fetchPage(`https://api.github.com/repos/${repo[1]}/${repo[2]}/readme`,budget);
  const data = JSON.parse(page.body) as {content?:string;encoding?:string};
  if (data.encoding !== "base64" || typeof data.content !== "string") return;
  return {url,body:Buffer.from(data.content,"base64").toString("utf8"),pdf:false};
}

async function resolvePage(url: string, name: string, budget: Budget, hop: number, inherited?: PaperHit): Promise<PaperHit[]> {
  // arXiv PDF endpoints have an official abstract endpoint for the same identity.
  // Read it first to recover authors/title and unify repeated abs/PDF links.
  const inputIdentifier = arxivId(url);
  if (inputIdentifier && /\/pdf\//.test(new URL(url).pathname)) url = `https://arxiv.org/abs/${inputIdentifier}`;
  if (hop > MAX_HOPS || budget.visited.has(url) || budget.requests >= MAX_REQUESTS) return [];
  budget.visited.add(url);
  let page: Page;
  const identifier = arxivId(url);
  try { page = await fetchPage(url,budget); }
  catch (error) {
    if (identifier) return arxivFallback(identifier,budget);
    const readme = await githubReadme(url,budget);
    if (!readme) throw error;
    page = readme;
  }
  if (page.pdf) return [{...(inherited || metadata(page,name).hit),id:page.url,oaPdfUrl:page.url,isOa:true}];
  const { hit, pdf, scholarly } = metadata(page,name);
  if (identifier && !scholarly) {
    const fromApi = await arxivFallback(identifier,budget);
    if (fromApi.length) return fromApi;
  }
  const results: PaperHit[] = [];
  if (pdf) {
    try {
      const verified = await fetchPage(sourceUrl(pdf,page.url).href,budget);
      if (verified.pdf) return [{...hit,oaPdfUrl:verified.url,isOa:true}];
    } catch { /* Preserve genuine article metadata, but never label HTML/error bodies as PDFs. */ }
  }
  let links = paperLinks(page,name);
  if (!links.length && new URL(url).hostname === "github.com") {
    try { const readme = await githubReadme(url,budget); if(readme) links=paperLinks(readme,name); } catch { /* The repository itself remains a valid source. */ }
  }
  if (hop < MAX_HOPS) for (const link of links) {
    try {
      const children = await resolvePage(link.url,name,budget,hop+1,scholarly ? hit : {...hit,title:hit.title || name});
      results.push(...children.filter(child=>child.oaPdfUrl || child.arxivId || child.authors));
    } catch { /* A broken optional link must not discard a valid source page. */ }
  }
  return results.length ? [...new Map(results.map(result=>[result.oaPdfUrl || result.arxivId || result.doi || result.id,result])).values()] : [hit];
}

/** Resolve an explicit source before any search index. No library writes or full PDF downloads. */
export async function resolveImportSource(url: string, name: string, fetcher: SourceFetcher = fetchPublic): Promise<PaperHit[]> {
  if (typeof url !== "string" || url.length > 2048) throw new Error("无效的来源地址");
  const target = sourceUrl(url.trim());
  return resolvePage(target.href,name.trim(),{requests:0,deadline:Date.now()+45000,visited:new Set(),fetch:fetcher},0);
}
