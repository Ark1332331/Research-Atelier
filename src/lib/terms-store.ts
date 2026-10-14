import { randomUUID } from "node:crypto";
import { readLocalArray, mutateLocalArray } from "./local-json.ts";
import { termKey, type Term, type TermContext } from "./terms.ts";
export const readTerms = () => readLocalArray<Term>("glossary.json");
export const mutateTerms = <R>(fn: (items: Term[]) => R) => mutateLocalArray<Term, R>("glossary.json", fn);
export async function mergeExtractedTerms(input: { name: string; role?: string; reuse?: string; note?: string; quote?: string; page?: number }[], paper: { slug: string; title: string }, pages: string[]) {
  return mutateTerms(items => {
    for (const t of input) {
      const name = t.name.trim(); if (!name || name.length > 200) continue;
      let found = items.find(x => termKey(x.name) === termKey(name));
      if (!found) { found = { id: randomUUID(), name, role: t.role ?? "领域背景", reuse: t.reuse ?? "通用", status: "未接触", note: t.note ?? "", source: paper.title, links: "", updatedAt: new Date().toISOString() }; items.push(found); }
      found.papers ??= []; if (!found.papers.some(p => p.slug === paper.slug)) found.papers.push(paper);
      const quotePage = typeof t.quote === "string" && t.quote.length >= 4 ? pages.findIndex(p => p.includes(t.quote!)) : -1;
      const context: TermContext = { ...paper, meaning: t.note ?? "", quote: quotePage >= 0 ? t.quote! : "", ...(quotePage >= 0 ? { page: quotePage + 1 } : {}) };
      found.contexts ??= []; const existingContext=found.contexts.find(c=>c.slug===paper.slug);
      if(!existingContext)found.contexts.push(context);
      else if(!existingContext.quote && context.quote){existingContext.quote=context.quote;existingContext.page=context.page;}
      if(existingContext && !existingContext.meaning && context.meaning)existingContext.meaning=context.meaning;
      found.updatedAt = new Date().toISOString();
    }
    return items;
  });
}
