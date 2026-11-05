import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { resolveImportSource as resolveSource } from '../src/lib/paper-import-source.ts';

const resolveImportSource = (url, name) => resolveSource(url, name, globalThis.fetch);

const originalFetch = globalThis.fetch;
const originalLookup = dns.lookup;
afterEach(() => { globalThis.fetch = originalFetch; dns.lookup = originalLookup; });
const pdf = () => new Response('%PDF-1.7\nfixture', { headers: { 'content-type':'application/pdf' } });
const article = (title, pdfUrl = '/paper.pdf') => `<meta name="citation_title" content="${title}"><meta name="citation_author" content="A Author"><meta name="citation_author" content="B Author"><meta name="citation_publication_date" content="2026/09/01"><meta name="citation_pdf_url" content="${pdfUrl}">`;
function network(pages) {
  const calls = [];
  dns.lookup = async () => [{ address:'93.184.216.34', family:4 }];
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    calls.push(href);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    const page = pages[href];
    assert.ok(page, `Unexpected request: ${href}`);
    return typeof page === 'function' ? page() : new Response(page, { headers:{'content-type':'text/html'} });
  };
  return calls;
}

test('official citation metadata resolves a verified relative PDF without search services', async () => {
  const calls = network({ 'https://proceedings.mlr.press/v306/a.html':article('Example &amp; Research'), 'https://proceedings.mlr.press/paper.pdf':pdf });
  const [hit] = await resolveImportSource('https://proceedings.mlr.press/v306/a.html', 'Example');
  assert.equal(hit.title,'Example & Research');
  assert.equal(hit.authors,'A Author, B Author');
  assert.equal(hit.year,'2026');
  assert.equal(hit.oaPdfUrl,'https://proceedings.mlr.press/paper.pdf');
  assert.equal(calls.length,2);
});

test('direct arxiv links use abs metadata and need no functioning search index', async () => {
  network({ 'https://arxiv.org/abs/2608.11738':article('Named Paper','https://arxiv.org/pdf/2608.11738'), 'https://arxiv.org/pdf/2608.11738':pdf });
  const [hit] = await resolveImportSource('https://arxiv.org/abs/2608.11738','Named');
  assert.equal(hit.arxivId,'2608.11738');
  assert.equal(hit.oaPdfUrl,'https://arxiv.org/pdf/2608.11738');
});

test('arxiv abs failure falls back to exact official API metadata and real PDF link', async () => {
  network({ 'https://arxiv.org/abs/2608.11738':()=>new Response('',{status:503}),
    'https://export.arxiv.org/api/query?id_list=2608.11738&max_results=1':'<feed><entry><id>https://arxiv.org/abs/2608.11738v2</id><title>Real Paper</title><published>2026-08-01</published><author><name>Real Author</name></author><link title="pdf" href="https://arxiv.org/pdf/2608.11738v2" type="application/pdf"/></entry></feed>',
    'https://arxiv.org/pdf/2608.11738v2':pdf });
  const [hit] = await resolveImportSource('https://arxiv.org/abs/2608.11738','Real');
  assert.equal(hit.authors,'Real Author');
  assert.equal(hit.arxivId,'2608.11738v2');
});

test('GitHub README paper badges resolve official article metadata while references are ignored', async () => {
  const calls = network({ 'https://github.com/owner/model':'<title>GitHub model</title><article class="markdown-body"><h1>Model</h1><a href="https://arxiv.org/abs/2608.11738"><img alt="Paper"></a><h2>References</h2><a href="https://arxiv.org/abs/1111.1111">Paper</a></article>',
    'https://arxiv.org/abs/2608.11738':article('Model: Actual Paper','/pdf/2608.11738'), 'https://arxiv.org/pdf/2608.11738':pdf });
  const [hit] = await resolveImportSource('https://github.com/owner/model','Model');
  assert.equal(hit.title,'Model: Actual Paper');
  assert.equal(hit.publisherUrl,'https://arxiv.org/abs/2608.11738');
  assert.equal(calls.length,3);
});

test('GitHub can use its README API when repository HTML is unavailable', async () => {
  network({ 'https://github.com/owner/model':()=>new Response('',{status:429}),
    'https://api.github.com/repos/owner/model/readme':()=>Response.json({encoding:'base64',content:Buffer.from('# Model\n[Technical Report](https://arxiv.org/abs/2608.11738)\n## References\n[Paper](https://arxiv.org/abs/1111.1111)').toString('base64')}),
    'https://arxiv.org/abs/2608.11738':article('Model Paper','/pdf/2608.11738'),'https://arxiv.org/pdf/2608.11738':pdf });
  assert.ok((await resolveImportSource('https://github.com/owner/model','Model'))[0].oaPdfUrl);
});

test('valid product documentation without its own PDF remains a reference and does not import cited research', async () => {
  const calls = network({'https://docs.nvidia.com/cosmos/latest/reason2/index.html':'<title>Cosmos Reason2</title><main><h1>Cosmos Reason2</h1><p>Documentation</p><h2>References</h2><a href="https://arxiv.org/abs/1111.1111">Technical Report</a></main>'});
  const [hit] = await resolveImportSource('https://docs.nvidia.com/cosmos/latest/reason2/index.html','Cosmos Reason2');
  assert.equal(hit.oaPdfUrl,undefined);
  assert.equal(hit.publisherUrl,'https://docs.nvidia.com/cosmos/latest/reason2/index.html');
  assert.equal(calls.length,1);
});

test('multiple explicit project papers are returned as choices', async () => {
  network({'https://example.com/project':'<title>Project</title><a href="/a">Paper</a><a href="/b">Technical report</a>',
    'https://example.com/a':article('Project A','/a.pdf'),'https://example.com/b':article('Project B','/b.pdf'),
    'https://example.com/a.pdf':pdf,'https://example.com/b.pdf':pdf });
  const hits = await resolveImportSource('https://example.com/project','Project');
  assert.deepEqual(hits.map(h=>h.title),['Project A','Project B']);
});

test('HTML masquerading as PDF is never marked downloadable', async () => {
  network({'https://example.com/article':article('Actual','/blocked.pdf'),'https://example.com/blocked.pdf':'<title>Access denied</title>'});
  assert.equal((await resolveImportSource('https://example.com/article','Actual'))[0].oaPdfUrl,undefined);
});

test('non-public targets and redirects are refused before fetching them', async () => {
  const calls = network({'https://example.com/article':()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/admin'}})});
  for (const url of ['http://localhost/x','http://127.0.0.1/x','http://10.1.2.3/x','http://[::1]/x','http://[::ffff:127.0.0.1]/x','file:///secret']) {
    await assert.rejects(resolveImportSource(url,'Unsafe'),/public|公开|地址|协议/i);
  }
  assert.equal(calls.length,0);
  await assert.rejects(resolveImportSource('https://example.com/article','Redirect'),/public|公开|地址/i);
  assert.equal(calls.length,1);
});

test('hostnames resolving to a private address are refused', async () => {
  const calls = network({});
  dns.lookup = async () => [{ address:'192.168.1.1', family:4 }];
  await assert.rejects(resolveImportSource('https://example.com/article','Private DNS'),/public|公开|地址/i);
  assert.equal(calls.length,0);
});

test('traversal stops at three link hops and never fetches more than eight responses', async () => {
  const pages = {};
  for(let i=0;i<10;i++) pages[`https://example.com/p${i}`] = `<title>Project ${i}</title><a href="/p${i+1}">Paper</a>`;
  const calls = network(pages);
  await resolveImportSource('https://example.com/p0','Project');
  assert.ok(calls.length <= 4);
});

test('oversized source pages reject without unlimited body buffering', async () => {
  network({'https://example.com/large':()=>new Response('x',{headers:{'content-length':'9000000','content-type':'text/html'}})});
  await assert.rejects(resolveImportSource('https://example.com/large','Large'),/large|过大/i);
});

test('a README Paper label preceding a bare arxiv PDF resolves the article metadata', async () => {
  network({'https://github.com/owner/model':'<article class="markdown-body"><h1>Model</h1><li><strong>Paper</strong>: <a href="https://arxiv.org/pdf/2608.11738">https://arxiv.org/pdf/2608.11738</a></li></article>',
    'https://arxiv.org/abs/2608.11738':article('Model: Actual Paper','/pdf/2608.11738'),'https://arxiv.org/pdf/2608.11738':pdf});
  const [hit] = await resolveImportSource('https://github.com/owner/model','Model');
  assert.equal(hit.title,'Model: Actual Paper');
  assert.equal(hit.authors,'A Author, B Author');
});

test('arxiv abstract and PDF links for the same work do not create duplicate candidates', async () => {
  network({'https://example.com/project':'<title>Project</title><a href="https://arxiv.org/abs/2608.11738">arXiv</a><a href="https://arxiv.org/pdf/2608.11738">PDF</a>',
    'https://arxiv.org/abs/2608.11738':article('Project: Actual Paper','/pdf/2608.11738'),'https://arxiv.org/pdf/2608.11738':pdf});
  const hits = await resolveImportSource('https://example.com/project','Project');
  assert.equal(hits.length,1);
  assert.equal(hits[0].title,'Project: Actual Paper');
});

test('project hero paper links outside main content are still resolved', async () => {
  network({'https://example.com/project/':'<title>Project</title><header><a href="./Project.pdf"><span>Paper</span></a></header><main><h2>Overview</h2>Research description</main>',
    'https://example.com/project/Project.pdf':pdf});
  assert.equal((await resolveImportSource('https://example.com/project/','Project'))[0].oaPdfUrl,'https://example.com/project/Project.pdf');
});

test('production transport pins the validated DNS answer so DNS rebinding cannot reach a private IP', async t => {
  let lookups=0;
  dns.lookup = async () => {lookups++; return [{address:lookups===1?'93.184.216.34':'127.0.0.1',family:4}];};
  let pinned;
  t.mock.method(https,'request',(url, options, callback)=>{
    options.lookup('example.com',{all:true},(error, addresses)=>{assert.equal(error,null);pinned=addresses;});
    const request=new EventEmitter();
    request.end=()=>{
      const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'text/html'};
      callback(response);response.end('<title>Public reference</title>');
    };
    return request;
  });
  const hits=await resolveSource('https://example.com/article','Public');
  assert.equal(hits[0].title,'Public reference');
  assert.deepEqual(pinned,[{address:'93.184.216.34',family:4}]);
  assert.equal(lookups,1);
});

test('a PDF signature mentioned inside an HTML page is not a PDF response', async () => {
  network({'https://example.com/article':article('Paper','/paper.pdf'),'https://example.com/paper.pdf':'<html><title>Help</title><p>This server cannot serve %PDF- files.</p></html>'});
  assert.equal((await resolveImportSource('https://example.com/article','Paper'))[0].oaPdfUrl,undefined);
});

test('a redirect to a private DNS answer never opens that connection', async () => {
  const calls=network({'https://example.com/article':()=>new Response('',{status:302,headers:{location:'https://private.example.com/secret'}})});
  dns.lookup=async hostname=>[{address:hostname==='private.example.com'?'10.0.0.2':'93.184.216.34',family:4}];
  await assert.rejects(resolveImportSource('https://example.com/article','Redirect'),/public|公开|地址/i);
  assert.equal(calls.length,1);
});

test('GitHub raw README handles a Paper label with a bare URL', async () => {
  network({'https://github.com/owner/model':()=>new Response('',{status:429}),
    'https://api.github.com/repos/owner/model/readme':()=>Response.json({encoding:'base64',content:Buffer.from('# Model\n- **Paper**: https://arxiv.org/pdf/2608.11738\n## References\n- **Paper**: https://arxiv.org/pdf/1111.1111').toString('base64')}),
    'https://arxiv.org/abs/2608.11738':article('Model: Actual Paper','/pdf/2608.11738'),'https://arxiv.org/pdf/2608.11738':pdf});
  const [hit]=await resolveImportSource('https://github.com/owner/model','Model');
  assert.equal(hit.title,'Model: Actual Paper');
  assert.ok(hit.oaPdfUrl);
});

test('the same PDF reached through versioned and unversioned article URLs remains one choice', async () => {
  network({'https://example.com/project':'<title>Project</title><a href="https://arxiv.org/abs/2608.11738">Paper</a><a href="https://arxiv.org/abs/2608.11738v1">Paper</a>',
    'https://arxiv.org/abs/2608.11738':article('Project: Actual Paper','/pdf/2608.11738'),
    'https://arxiv.org/abs/2608.11738v1':article('Project: Actual Paper','/pdf/2608.11738'),'https://arxiv.org/pdf/2608.11738':pdf});
  assert.equal((await resolveImportSource('https://example.com/project','Project')).length,1);
});

test('distinct direct PDFs from one project receive distinct selectable identities', async () => {
  network({'https://example.com/project':'<title>Project</title><a href="/a.pdf">Paper</a><a href="/b.pdf">Technical Report</a>',
    'https://example.com/a.pdf':pdf,'https://example.com/b.pdf':pdf});
  const hits=await resolveImportSource('https://example.com/project','Project');
  assert.equal(hits.length,2);
  assert.notEqual(hits[0].id,hits[1].id);
});
