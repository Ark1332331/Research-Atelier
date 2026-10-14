export interface TermContext { slug: string; title: string; meaning: string; quote: string; page?: number; nextAction?: string }
export interface TermAssessment { id:string; at:string; answer:string; verdict:"supported"|"needs-work"|"uncertain"; suggestedStatus:string; feedback:string; nextQuestion:string; slug?:string; referenceHash?:string }
export interface TermReview { at: string; answer: string; rating: "again" | "good"; status: string; assessmentId?:string }
export interface Term {
  id: string; name: string; role: string; status: string; reuse: string; note: string; source: string; links: string; updatedAt: string;
  papers?: { slug: string; title: string }[]; contexts?: TermContext[]; mechanism?: string; example?: string; nextAction?: string;
  reviews?: TermReview[]; reviewLevel?: number; dueAt?: string; explanationSource?: string;
  assessments?: TermAssessment[]; legacyIds?:string[]; legacyCards?:Term[];
}
export const TERM_STATUSES = ["未接触", "有直觉", "能解释", "能对应论文", "能实现"];
export function termKey(name: string): string { return name.split(/[／/]/)[0].normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, " "); }
export function termsForPaper(terms: Term[], slug: string, title?: string): Term[] {
  return terms.filter(t => t.papers?.some(p => p.slug === slug) || t.contexts?.some(p => p.slug === slug) || (t.source ?? "").toLowerCase().includes(slug.toLowerCase()) || Boolean(title && (t.source ?? "").split("/")[0].trim().toLowerCase() === title.trim().toLowerCase()));
}
export function reviewTerm(t: Term, answer: string, rating: "again" | "good", status: string, now = Date.now()): Term {
  if (!answer.trim()) throw Error("先写下你的复述，再记录回顾结果");
  if (!TERM_STATUSES.includes(status)) throw Error("理解状态无效");
  const level = rating === "again" ? 0 : Math.min((t.reviewLevel ?? 0) + 1, 5);
  const days = [1, 2, 4, 7, 14, 30][level];
  return { ...t, status: rating === "again" ? "有直觉" : status, reviewLevel: level, dueAt: new Date(now + days * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(), reviews: [...(t.reviews ?? []), { at: new Date(now).toISOString(), answer: answer.trim(), rating, status: rating === "again" ? "有直觉" : status }] };
}

export function consolidateTerms(items:Term[]):Term[] {
  const result:Term[]=[];
  for(const item of items){const canonical=result.find(t=>termKey(t.name)===termKey(item.name));
    if(!canonical){
      const copy=structuredClone(item);let suffix=1;
      while(result.some(t=>t.id===copy.id))copy.id=`${item.id}-recovered-${suffix++}`;
      if(copy.id!==item.id){copy.legacyIds=[...new Set([...(copy.legacyIds??[]),item.id])];copy.legacyCards=[...(copy.legacyCards??[]),structuredClone(item)];}
      result.push(copy);continue;
    }
    canonical.legacyIds=[...new Set([...(canonical.legacyIds??[]),item.id,...(item.legacyIds??[])])];
    canonical.legacyCards=[...(canonical.legacyCards??[]),structuredClone(item)];
    canonical.papers=[...new Map([...(canonical.papers??[]),...(item.papers??[])].map(p=>[p.slug,p])).values()];
    canonical.contexts=[...new Map([...(item.contexts??[]),...(canonical.contexts??[])].map(c=>[c.slug,c])).values()];
    canonical.reviews=[...(canonical.reviews??[]),...(item.reviews??[])];canonical.assessments=[...(canonical.assessments??[]),...(item.assessments??[])];
  }
  return result;
}
