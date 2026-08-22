import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";
const url="/media/ark/Data/devpy/projects/allinone/workflow-app/public/papers/nsr.pdf";
const doc=await getDocument({url}).promise;
const page=await doc.getPage(1);
const WIDTH=1100;               // 模拟全屏容器宽
const base=page.getViewport({scale:1});
const scale=WIDTH/base.width;
const vp=page.getViewport({scale});
const tc=await page.getTextContent();
const W=Math.ceil(vp.width),H=Math.ceil(vp.height);
const canvas=createCanvas(W,H),ctx=canvas.getContext("2d");
await page.render({canvasContext:ctx,viewport:vp}).promise;
// getPageItems
const items=[];
for(const raw of tc.items){
  if(typeof raw!=="object"||raw===null||!("str" in raw)||!raw.str?.trim())continue;
  const it=raw;
  const [px,py]=vp.convertToViewportPoint(it.transform[4],it.transform[5]);
  const fs=Math.abs(it.transform[3])*vp.scale;
  const ar=tc.styles?.[it.fontName??""]?.ascent??0.75;
  items.push({x:px,y:py-fs*ar,w:it.width*vp.scale,h:fs,fs,baseline:py,text:it.str});
}
console.log("vp.width",vp.width.toFixed(1),"items",items.length);
// detectParagraphs — paste logic
const XGAP=40;
const rows=[];
for(const it of items.slice().sort((a,b)=>a.baseline-b.baseline)){
  const r=rows.find(row=>Math.abs(it.baseline-row.baseline)<Math.max(row.h,it.fs)*0.5&&(it.x+it.w>row.x-XGAP)&&(it.x<row.xMax+XGAP));
  if(r){r.x=Math.min(r.x,it.x);r.xMax=Math.max(r.xMax,it.x+it.w);r.h=Math.max(r.h,it.fs);r.texts.push(it.text);}
  else rows.push({baseline:it.baseline,x:it.x,xMax:it.x+it.w,h:it.fs,texts:[it.text]});
}
const pageW=Math.max(...items.map(i=>i.x+i.w));
const freq={};for(const r of rows){const k=Math.round(r.h);freq[k]=(freq[k]||0)+1;}
const bodyH=+Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0]||12;
const bodyBand=h=>h>=bodyH*0.82&&h<=bodyH*1.22;
const leftFreq={};for(const r of rows)if(bodyBand(r.h)){const k=Math.round(r.x);leftFreq[k]=(leftFreq[k]||0)+1;}
const leftMargin=+Object.entries(leftFreq).sort((a,b)=>b[1]-a[1])[0][0]||0;
let bodyTop=-Infinity;
for(const r of rows)if(bodyTop===-Infinity&&Math.abs(r.x-leftMargin)<18&&bodyBand(r.h))bodyTop=r.baseline;
if(bodyTop===-Infinity)bodyTop=0;
const colMid=(leftMargin+pageW)/2;
console.log("bodyH",bodyH,"leftMargin",leftMargin,"pageW",pageW.toFixed(0),"colMid",colMid.toFixed(0));
const ok=r=>{const t=r.texts.join(" ").trim();if(!t)return false;if(/^\d{1,2}$/.test(t)&&r.baseline<r.h*3)return false;if(r.baseline<bodyTop-2)return false;if(r.h<bodyH*0.88)return false;return true;};
const cols=[[],[]];
for(const r of rows.filter(ok)) cols[(r.x+(r.xMax-r.x)/2)<colMid?0:1].push(r);
// draw ok lines as dots at line x
ctx.fillStyle="#e83";
for(const c of cols){for(const r of c){ctx.beginPath();ctx.arc(r.x+(r.xMax-r.x)/2, r.baseline-r.h/2,4,0,Math.PI*2);ctx.fill();}}
fs.writeFileSync("./repro.png",canvas.toBuffer("image/png"));
// print first 25 ok rows with col
let i=0;
for(const c of cols){console.log("COL", c[0]&&((c[0].x+(c[0].xMax-c[0].x)/2)<colMid?0:1));for(const r of c){if(i++>24)break;console.log(`  x=${r.x.toFixed(0).padStart(4)} xmax=${r.xMax.toFixed(0).padStart(4)} cx=${((r.x+r.xMax)/2).toFixed(0).padStart(4)} h=${r.h.toFixed(0)}  ${r.texts.join(" ").slice(0,30)}`);}}
