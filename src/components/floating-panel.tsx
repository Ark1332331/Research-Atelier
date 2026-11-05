"use client";
import {useCallback,useEffect,useId,useRef,useState,type ReactNode,type PointerEvent} from 'react';
import {clampPanel,defaultPanel,resizePanel,type PanelBox} from '@/lib/panel-geometry';

const stack=new Map<string,number>();let nextLayer=1100;
const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
export default function FloatingPanel({open,onClose,title,subtitle,storageKey,children,footer,className='',width=520,closeLabel='关闭窗口',offset=0,focusToken=0,actions,docked=false}:{
  open:boolean;onClose:()=>void;title:string;subtitle?:string;storageKey:string;children:ReactNode;footer?:ReactNode;className?:string;width?:number;closeLabel?:string;
  offset?:number;focusToken?:number;actions?:ReactNode;docked?:boolean;
}) {
  const id=useId(),panel=useRef<HTMLElement>(null),previousFocus=useRef<HTMLElement|null>(null);
  const [box,setBox]=useState<PanelBox|null>(null),[expanded,setExpanded]=useState(false),[collapsed,setCollapsed]=useState(false),[layer,setLayer]=useState(1100),[mobile,setMobile]=useState(false);
  const drag=useRef<{kind:'move'|'resize';x:number;y:number;box:PanelBox}|null>(null);
  const current=useRef<PanelBox|null>(null),closeRef=useRef(onClose);useEffect(()=>{closeRef.current=onClose;},[onClose]);
  const raise=useCallback(()=>{const z=++nextLayer;stack.set(id,z);setLayer(z);},[id]);
  const change=useCallback((next:PanelBox)=>{current.current=next;setBox(next);},[]);
  const geometryKey=docked?`study-canvas:${storageKey}`:storageKey;
  const bounds=useCallback(()=>docked?{width:panel.current?.parentElement?.clientWidth??0,height:panel.current?.parentElement?.clientHeight??0}:viewport(),[docked]);
  const initialBox=useCallback(()=>{
    const view=bounds();
    return docked?clampPanel({x:8+offset/2,y:8+offset*4/9,w:view.width-48,h:view.height-56},view):defaultPanel(view,width);
  },[bounds,docked,offset,width]);
  const save=useCallback(()=>{if(current.current)try{localStorage.setItem(geometryKey,JSON.stringify(current.current));}catch{/* window remains usable without storage */}},[geometryKey]);
  useEffect(()=>{
    let gone=false,initialized=false,previous=bounds();let saved:unknown;try{saved=JSON.parse(localStorage.getItem(geometryKey)||'null');}catch{}
    const resize=()=>{
      if(gone)return;setMobile(window.innerWidth<=640);const view=bounds();if(view.width<=0||view.height<=0)return;
      if(!initialized){const fallback=initialBox();change(clampPanel(saved??(docked?fallback:{...fallback,x:fallback.x-offset,y:fallback.y+offset}),view));initialized=true;}
      else if(current.current){const box=current.current;change(clampPanel(docked&&previous.width>0&&previous.height>0?{x:box.x*view.width/previous.width,y:box.y*view.height/previous.height,w:box.w*view.width/previous.width,h:box.h*view.height/previous.height}:box,view));}
      previous=view;
    };
    queueMicrotask(resize);
    const observer=new ResizeObserver(resize);if(docked&&panel.current?.parentElement)observer.observe(panel.current.parentElement);
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    return()=>{gone=true;observer.disconnect();window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};
  },[geometryKey,change,offset,docked,bounds,initialBox]);
  useEffect(()=>{
    if(!open){stack.delete(id);return;}
    let gone=false;previousFocus.current=document.activeElement as HTMLElement;
    queueMicrotask(()=>{if(!gone){raise();if(focusToken)setCollapsed(false);if(!panel.current?.contains(document.activeElement))panel.current?.focus({preventScroll:true});}});
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&!e.defaultPrevented&&!document.querySelector('dialog[open]')&&stack.get(id)===Math.max(...stack.values())){e.preventDefault();e.stopImmediatePropagation();closeRef.current();}};
    document.addEventListener('keydown',key,true);
    return()=>{gone=true;stack.delete(id);document.removeEventListener('keydown',key,true);if(previousFocus.current?.isConnected)previousFocus.current.focus({preventScroll:true});};
  },[open,id,raise,focusToken,docked]);
  function start(e:PointerEvent<HTMLElement>,kind:'move'|'resize') {
    if(e.button!==0||mobile||expanded||!box)return;
    e.preventDefault();raise();drag.current={kind,x:e.clientX,y:e.clientY,box};e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:PointerEvent<HTMLElement>) {
    const d=drag.current;if(!d)return;
    change(d.kind==='move'?clampPanel({...d.box,x:d.box.x+e.clientX-d.x,y:d.box.y+e.clientY-d.y},bounds()):resizePanel(d.box,e.clientX-d.x,e.clientY-d.y,bounds()));
  }
  function end(){drag.current=null;save();}
  const geometry=mobile||expanded?{left:8,top:8,width:docked?'calc(100% - 16px)':'calc(100vw - 16px)',height:docked?'calc(100% - 16px)':'calc(100dvh - 16px)'}:box?{left:box.x,top:box.y,width:box.w,height:box.h}:undefined;
  return <aside ref={panel} hidden={!open} className={`floating-panel ${className}${collapsed?' is-collapsed':''}${docked?' is-docked':''}`} role="dialog" aria-label={title} tabIndex={-1} style={{...geometry,zIndex:layer,visibility:box?'visible':'hidden',...(collapsed?{height:'auto',bottom:'auto'}:{})}} onFocusCapture={()=>{if(open&&stack.get(id)!==Math.max(...stack.values()))raise();}} onPointerDownCapture={()=>{if(stack.get(id)!==Math.max(...stack.values()))raise();}}>
    <header className="floating-panel-head">
      <div className="floating-panel-drag" tabIndex={mobile?-1:0} aria-label={`移动${title}，可使用方向键`} onPointerDown={e=>start(e,'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={()=>{setExpanded(v=>!v);setCollapsed(false);}} onKeyDown={e=>{if(!box||mobile||expanded||!e.key.startsWith('Arrow'))return;e.preventDefault();change(clampPanel({...box,x:box.x+(e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0),y:box.y+(e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0)},bounds()));save();}}>
        <h2>{title}</h2>{subtitle&&<small>{subtitle}</small>}
      </div>
      <div className="floating-panel-controls">
        {actions}
        <button type="button" aria-label={collapsed?'展开窗口':'收起窗口'} title={collapsed?'展开窗口':'收起窗口'} onClick={()=>setCollapsed(v=>!v)}>{collapsed?'＋':'−'}</button>
        {!mobile&&<><button type="button" aria-label={expanded?'还原窗口':'放大窗口'} title={expanded?'还原窗口':'放大窗口'} onClick={()=>{setExpanded(v=>!v);setCollapsed(false);}}>{expanded?'❐':'□'}</button><button type="button" aria-label="重置窗口位置" title="重置位置与大小" onClick={()=>{change(initialBox());setExpanded(false);setCollapsed(false);save();}}>↺</button></>}
        <button type="button" aria-label={closeLabel} title={closeLabel} onClick={onClose}>×</button>
      </div>
    </header>
    <div className="floating-panel-content" hidden={collapsed}>{children}</div>
    {footer&&<footer className="floating-panel-footer" hidden={collapsed}>{footer}</footer>}
    {!mobile&&!expanded&&!collapsed&&<button type="button" className="floating-panel-resize" aria-label={`调整${title}大小，可使用方向键`} title="拖动调整大小" onPointerDown={e=>start(e,'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={e=>{if(!box||!e.key.startsWith('Arrow'))return;e.preventDefault();change(resizePanel(box,e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0,e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0,bounds()));save();}}>◢</button>}
  </aside>;
}
