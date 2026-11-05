export interface StudyShortcut { id:string; title:string; prompt:string; enabled:boolean }
export interface StudyShortcutSettings { revision:number; shortcuts:StudyShortcut[] }
export const DEFAULT_STUDY_SHORTCUTS:StudyShortcut[]=[
  {id:'solve',title:'解题',prompt:'请解答选中的题目。先明确已知条件与目标，再说明思路并逐步推导，最后给出答案和检查方法。题目信息不足时请指出缺少的条件，不要自行补造。',enabled:true},
  {id:'what',title:'是什么',prompt:'请解释选中内容是什么：先给出直观含义，再说明定义、符号各自代表什么，以及一个简单例子。结合上下文，区分容易混淆的概念。',enabled:true},
  {id:'why',title:'为什么',prompt:'请解释选中内容为什么成立。明确所需条件、使用的定理或依据，补齐中间推导；若结论不成立，请指出原因。',enabled:true},
];
export function validateStudyShortcuts(value:unknown):StudyShortcut[]{
  if(!Array.isArray(value)||value.length>12)throw Error('最多保存 12 个快捷指令');
  const ids=new Set<string>();
  return value.map(item=>{
    if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)||ids.has(item.id))throw Error('快捷指令标识无效或重复');
    if(typeof item.title!=='string'||!item.title.trim()||item.title.trim().length>20)throw Error('名称须为 1–20 个字符');
    if(typeof item.prompt!=='string'||!item.prompt.trim()||item.prompt.trim().length>2000)throw Error('提问指令须为 1–2000 个字符');
    if(typeof item.enabled!=='boolean')throw Error('启用状态无效');
    ids.add(item.id);return {id:item.id,title:item.title.trim(),prompt:item.prompt.trim(),enabled:item.enabled};
  });
}
