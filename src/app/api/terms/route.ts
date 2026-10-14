import { recordObservation } from "@/lib/learning/observations";
import { withToolObservation } from "@/lib/learning/tool-observation";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/store";
import { readTerms, mutateTerms, mergeExtractedTerms } from "@/lib/terms-store";
import { reviewTerm, termKey, TERM_STATUSES, type Term, type TermAssessment } from "@/lib/terms";
import { studyJson, modelText } from "@/lib/study-model";
import { prepareLearning, finishLearning, mutateLearning, addProposal } from "@/lib/learning/store";

export type { Term } from "@/lib/terms";
export const runtime = "nodejs";
function referenceHash(term:Term, slug?:string) { return createHash("sha256").update(JSON.stringify({name:term.name,note:term.note,mechanism:term.mechanism,context:term.contexts?.find(c=>c.slug===slug)})).digest("hex"); }
export async function GET() { try { return Response.json({ terms: await readTerms() }, { headers: { "Cache-Control": "no-store" } }); } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); } }
async function observedPOST(request: Request) {
  try {
    const body = await request.json();

    if(body.action === "capture") {
      if(typeof body.slug!=="string"||!/^[\p{L}\p{N}_.-]{1,180}$/u.test(body.slug)||body.slug==="."||body.slug===".."||!Number.isInteger(body.page)||body.page<1||body.page>10000||typeof body.text!=="string"||body.text.length<2||body.text.length>160)throw Error("请选择当前论文中的术语");
      const dir=path.join(DATA_DIR,"papers",body.slug);const meta=JSON.parse(await fs.readFile(path.join(dir,"meta.json"),"utf8"));
      const original=await fs.readFile(path.join(dir,`page_${String(body.page).padStart(2,"0")}.txt`),"utf8");
      const escaped=body.text.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");const m=new RegExp(escaped,"i").exec(original);if(!m)throw Error("无法在该页原文中核对所选术语，请换一处选区");
      const quote=original.slice(Math.max(0,m.index-100),m.index+m[0].length+180);const pages=Array.from({length:body.page},()=>"");pages[body.page-1]=original;
      const terms=await mergeExtractedTerms([{name:body.text,quote}],{slug:body.slug,title:meta.title??body.slug},pages);
      return Response.json({terms,saved:terms.find(t=>termKey(t.name)===termKey(body.text))});
    }
    if (body.action === "explain" || body.action === "assess") {
      const term = (await readTerms()).find(t => t.id === body.id); if (!term) throw Error("术语不存在");
      const context = term.contexts?.find(c => c.slug === body.slug);
      const learning = await prepareLearning(`解释术语 ${term.name}`, "paper", null);
      try {
        if(body.action === "assess") {
          if(typeof body.answer!=="string" || !body.answer.trim() || body.answer.length>5000) throw Error("先写下你的真实复述");
          const d=await studyJson('检查学习者对术语的复述。对照材料检查概念、输入输出与用途，指出具体错误。材料不足或回答太空泛不能判通过。返回 {"verdict":"supported|needs-work|uncertain","suggestedStatus":"有直觉|能解释|能对应论文","feedback":"具体反馈，指出正确部分和缺口","nextQuestion":"一道最小追问"}。仅有具体论文摘录且复述正确映射到原文时可建议能对应论文；不能从复述断言能实现。' + learning.prompt, {term:term.name,reference:{note:term.note,mechanism:term.mechanism,context},learnerAnswer:body.answer});
          const verdict=d.verdict;if(!["supported","needs-work","uncertain"].includes(String(verdict)))throw Error("复述检查格式异常");
          const suggestedStatus=verdict!=="supported"?"有直觉":d.suggestedStatus==="能对应论文" && context?.quote ? "能对应论文":"能解释";
          const assessment:TermAssessment={id:randomUUID(),referenceHash:referenceHash(term,context?.slug),at:new Date().toISOString(),answer:body.answer.trim(),verdict:verdict as TermAssessment["verdict"],suggestedStatus,feedback:modelText(d,"feedback"),nextQuestion:modelText(d,"nextQuestion"),...(context?{slug:context.slug}:{})};
          const result=await mutateTerms(items=>{const current=items.find(t=>t.id===term.id);if(!current)throw Error("术语已删除");if(current.updatedAt!==term.updatedAt)throw Error("笔记已变化，请重新检查复述");current.assessments??=[];current.assessments.push(assessment);current.updatedAt=new Date().toISOString();return {terms:items,assessment,saved:current};});
          const candidateIds:string[]=[];
          if(assessment.verdict==="needs-work") await mutateLearning(state=>{const m=addProposal(state,{key:`term-gap:${term.id}:${context?.slug??"global"}`,kind:"gap",text:`讲解 ${term.name} 时先针对本次复述的卡点解释：${assessment.feedback}。用一个最小例子澄清，再问：${assessment.nextQuestion}。这是模型从一次复述提出的改法，不能据此断言永久能力不足。`,quote:assessment.answer,scene:"paper",projectId:null,source:`术语复述检查 ${assessment.id} / 模型推断 / 待用户确认`});if(m)candidateIds.push(m.id);});
          await recordObservation({traceId:learning.id,source:"术语复述检查",scene:"paper",resourceId:context?.slug,kind:"recall",action:assessment.verdict==="needs-work"?"发现可能的概念误解":"完成复述核对",userText:assessment.answer,candidateIds});
          await finishLearning(learning,JSON.stringify(assessment));return Response.json(result);
        }
        const d = await studyJson('给科研学习者解释术语。返回 {"note":"一句话中文定义","mechanism":"机制：具体输入如何变化为输出，不能只说提取特征","example":"一个最小具体例子，绑定到真实对象","nextAction":"一条可复述或在论文中定位的检查问题"}。区分通用定义与该论文的实现；没有原文证据不得断言输入是否网格化、网络操作或输出结构。材料不足时明确说是假设例子，不编造论文结论。' + learning.prompt, { term: term.name, role: term.role, context: context ?? { meaning: term.note, source: term.source }, existingNote:term.note, existingMechanism:term.mechanism });
        const explanation = { note: modelText(d,"note"), mechanism: modelText(d,"mechanism"), example: modelText(d,"example"), nextAction: modelText(d,"nextAction") };
        await finishLearning(learning,JSON.stringify(explanation));return Response.json({ explanation, selected:learning.selected });
      }catch(e){await finishLearning(learning,"",e instanceof Error?e.message:String(e));throw e;}
    }

    return Response.json(await mutateTerms(terms => {
      if (body.deleteId) { const i = terms.findIndex(t => t.id === body.deleteId); if (i < 0) throw Error("术语不存在"); terms.splice(i, 1); return { terms }; }
      if (body.action === "review") {
        const i = terms.findIndex(t => t.id === body.id); if (i < 0) throw Error("术语不存在");
        if (typeof body.answer !== "string" || body.answer.length > 5000 || !["again","good"].includes(body.rating)) throw Error("复述或评价无效");
        const assessment=terms[i].assessments?.find(a=>a.id===body.assessmentId);
        if(body.rating==="good" && (!assessment || assessment.verdict!=="supported" || assessment.answer!==body.answer.trim()))throw Error("先检查本次复述；检查通过后才能确认理解状态");
        if(body.rating==="good" && assessment?.referenceHash!==referenceHash(terms[i],assessment?.slug))throw Error("参考笔记已变化，请重新检查复述");
        if(assessment && terms[i].reviews?.some(r=>r.assessmentId===assessment.id))throw Error("这次复述已记录；下一次回顾请重新复述并检查");
        const status=body.rating==="good"?assessment!.suggestedStatus:terms[i].status;
        terms[i] = reviewTerm(terms[i], body.answer, body.rating, status);
        if(assessment)terms[i].reviews!.at(-1)!.assessmentId=assessment.id;
        return { terms, saved: terms[i] };
      }
      const input = body.term; if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 200) throw Error("术语名称须为 1–200 字符");
      const i = input.id ? terms.findIndex(t => t.id === input.id) : -1; if (input.id && i < 0) throw Error("术语不存在");
      if (terms.some((t,j) => j !== i && termKey(t.name) === termKey(input.name))) throw Error("已有同名术语，请修改现有卡片");
      if (input.status && !TERM_STATUSES.includes(input.status)) throw Error("理解状态无效");
      if (i >= 0 && input.status && input.status !== terms[i].status) throw Error("请通过复述回顾记录理解状态");
      const old: Term = i >= 0 ? terms[i] : { id: randomUUID(), name: input.name, role: "领域背景", reuse: "通用", status: "未接触", note: "", source: "手动建卡", links: "", updatedAt: "" };
      const saved = { ...old, updatedAt: new Date().toISOString() };
      for (const key of ["name","role","reuse","note","source","links","mechanism","example","nextAction","explanationSource"] as const) { if (input[key] !== undefined) { if (typeof input[key] !== "string" || input[key].length > 5000) throw Error("卡片字段格式无效"); saved[key] = input[key].trim(); } }
      if (i >= 0) terms[i] = saved; else terms.push(saved); return { terms, saved };
    }));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}

export const POST=withToolObservation({source:"术语笔记与复述",scene:"paper",conversation:false},observedPOST);
