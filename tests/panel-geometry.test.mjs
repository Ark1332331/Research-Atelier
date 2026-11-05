import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPanel, defaultPanel, resizePanel } from '../src/lib/panel-geometry.ts';
test('panels stay entirely on screen after dragging and viewport shrink',()=>{
  const b=clampPanel({x:-800,y:1200,w:1100,h:900},{width:800,height:600});
  assert.ok(b.x>=8&&b.y>=8&&b.x+b.w<=792&&b.y+b.h<=592);
  const small=clampPanel(b,{width:390,height:844});assert.equal(small.w,374);assert.equal(small.x,8);
});
test('corrupt stored geometry falls back to a usable window',()=>{
  for(const bad of [null,{}, {x:NaN,y:0,w:500,h:500},{x:0,y:0,w:-1,h:0}])assert.deepEqual(clampPanel(bad,{width:1440,height:900}),defaultPanel({width:1440,height:900}));
});
test('resize honors minimum sizes and right/bottom edges',()=>{
  const viewport={width:1000,height:800};const b={x:500,y:100,w:400,h:500};
  const large=resizePanel(b,1000,1000,viewport);assert.equal(large.w,492);assert.equal(large.h,692);
  const tiny=resizePanel(b,-1000,-1000,viewport);assert.equal(tiny.w,320);assert.equal(tiny.h,240);
});
