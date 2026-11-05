export interface PanelBox { x:number; y:number; w:number; h:number }
export interface PanelViewport { width:number; height:number }
export function defaultPanel(view:PanelViewport,width=520,height=720):PanelBox {
  const w=Math.min(width,Math.max(1,view.width-16)),h=Math.min(height,Math.max(1,view.height-16));
  return {x:Math.max(8,view.width-w-20),y:Math.max(8,Math.min(76,view.height-h-8)),w,h};
}
export function clampPanel(value:unknown,view:PanelViewport):PanelBox {
  const b=value as PanelBox;
  if(!b||![b.x,b.y,b.w,b.h].every(n=>typeof n==='number'&&Number.isFinite(n))||b.w<=0||b.h<=0)return defaultPanel(view);
  const w=Math.min(Math.max(320,b.w),Math.max(1,view.width-16)),h=Math.min(Math.max(240,b.h),Math.max(1,view.height-16));
  return {x:Math.max(8,Math.min(b.x,view.width-w-8)),y:Math.max(8,Math.min(b.y,view.height-h-8)),w,h};
}
export function resizePanel(b:PanelBox,dx:number,dy:number,view:PanelViewport):PanelBox {
  return clampPanel({...b,w:Math.min(view.width-b.x-8,Math.max(320,b.w+dx)),h:Math.min(view.height-b.y-8,Math.max(240,b.h+dy))},view);
}
