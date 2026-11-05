'use client';
import {useCallback,useLayoutEffect,useMemo,useRef} from 'react';

/** Opening/focusing a window never moves it. Following is enabled only by reader scrolling. */
export function useAnswerScroll(content:string,active:boolean){
  const ref=useRef<HTMLDivElement>(null),follow=useRef(false),beginning=useRef(false),user=useRef(false);
  useLayoutEffect(()=>{
    const root=ref.current;if(!root||!root.getClientRects().length){follow.current=false;return;}
    if(beginning.current){
      const start=root.querySelector<HTMLElement>('[data-answer-start]');
      if(start){beginning.current=false;start.style.minHeight=`${root.clientHeight}px`;const box=start.getBoundingClientRect(),bounds=root.getBoundingClientRect();if(box.top<bounds.top||box.top>bounds.bottom-60)root.scrollTop+=box.top-bounds.top;}
    }else if(active&&follow.current){root.scrollTop=root.scrollHeight-root.clientHeight;}
    if(!active){follow.current=false;user.current=false;}
  },[content,active]);
  const begin=useCallback(()=>{follow.current=false;user.current=false;beginning.current=true;},[]);
  const bind=useCallback((node:HTMLDivElement|null)=>{ref.current=node;},[]);
  const onScroll=useCallback(()=>{const el=ref.current;if(el&&user.current)follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;},[]);
  const onWheel=useCallback((event:{deltaY:number})=>{user.current=true;if(event.deltaY<0)follow.current=false;},[]);
  const onPointerDown=useCallback(()=>{user.current=true;},[]);
  const onKeyDown=useCallback((event:{key:string})=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)){user.current=true;if(['ArrowUp','PageUp','Home'].includes(event.key))follow.current=false;}},[]);
  return useMemo(()=>({bind,begin,onScroll,onWheel,onPointerDown,onKeyDown}),[bind,begin,onScroll,onWheel,onPointerDown,onKeyDown]);
}
