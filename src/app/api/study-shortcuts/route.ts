import {readLocalArray,mutateLocalArray} from '@/lib/local-json';
import {DEFAULT_STUDY_SHORTCUTS,validateStudyShortcuts,type StudyShortcutSettings} from '@/lib/study-shortcuts';
export const runtime='nodejs';
const FILE='study-shortcuts.json';
class Conflict extends Error {}
export async function GET(){
  try{
    const settings=(await readLocalArray<StudyShortcutSettings>(FILE))[0]??{revision:0,shortcuts:DEFAULT_STUDY_SHORTCUTS};
    return Response.json(settings,{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'快捷指令加载失败，请重试'},{status:500});}
}
export async function PUT(request:Request){
  try{
    const body=await request.json();const shortcuts=validateStudyShortcuts(body.shortcuts);
    if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('设置版本无效，请重新打开');
    const settings=await mutateLocalArray<StudyShortcutSettings,StudyShortcutSettings>(FILE,items=>{
      if((items[0]?.revision??0)!==body.revision)throw new Conflict('快捷指令已在其他窗口修改，请重新打开设置后再编辑');
      const next={revision:body.revision+1,shortcuts};items.splice(0,items.length,next);return next;
    });return Response.json(settings);
  }catch(e){return Response.json({error:e instanceof Error?e.message:'快捷指令保存失败'},{status:e instanceof Conflict?409:400});}
}
