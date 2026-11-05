/** Scroll inside the reader/window, keeping its toolbar and the page itself in place. */
export function scrollReadingSource(target:HTMLElement|Range){
  const element=target instanceof HTMLElement?target:target.startContainer.parentElement;
  if(!element)return;
  let contained=false;
  for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
    const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect(),rect=target.getBoundingClientRect();
    const vertical=/(auto|scroll)/.test(style.overflowY)&&parent.scrollHeight>parent.clientHeight;
    const horizontal=/(auto|scroll)/.test(style.overflowX)&&parent.scrollWidth>parent.clientWidth;
    if(vertical||horizontal){
      contained=true;
      const top=vertical&&(rect.top<bounds.top||rect.bottom>bounds.bottom)?parent.scrollTop+rect.top-bounds.top-parent.clientHeight/2+Math.min(rect.height,parent.clientHeight)/2:parent.scrollTop;
      const left=horizontal&&(rect.left<bounds.left||rect.right>bounds.right)?parent.scrollLeft+rect.left-bounds.left-parent.clientWidth/2+Math.min(rect.width,parent.clientWidth)/2:parent.scrollLeft;
      parent.scrollTo({top,left,behavior:'instant'});
    }
  }
  if(!contained&&!element.closest('.full-reader,.floating-panel'))element.scrollIntoView({block:'nearest'});
}
