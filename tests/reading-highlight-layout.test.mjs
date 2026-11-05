import test from 'node:test';
import assert from 'node:assert/strict';
import {joinHighlightBoxes} from '../src/lib/reading-highlight-layout.ts';
import {validateAnchor,buildReadingMessages} from '../src/lib/reading-memory.ts';

test('joins text and a taller inline formula without painting the next line or column',()=>{
 const boxes=joinHighlightBoxes([
  {left:0,top:10,width:60,height:20},
  {left:62,top:7,width:40,height:28},
  {left:105,top:10,width:80,height:20},
  {left:0,top:50,width:60,height:20},
  {left:300,top:10,width:60,height:20},
 ]);
 assert.equal(boxes.length,3);
 assert.deepEqual(boxes.find(b=>b.top===7),{left:0,top:7,width:185,height:28});
});
test('preserves anchor offsets while retaining a single TeX representation for the question',()=>{
 const anchor={scope:'/study/one',sourceKey:'source',label:'题目',text:'x2x^2x2',context:'公式',start:8,end:16,quoteMarkdown:'$x^2$'};
 assert.deepEqual(validateAnchor(anchor),anchor);
 assert.equal(JSON.parse(buildReadingMessages({anchor,messages:[]},'解释')[1].content).选中,'$x^2$');
 assert.throws(()=>validateAnchor({...anchor,quoteMarkdown:'x'.repeat(24001)}));
 assert.throws(()=>validateAnchor({...anchor,quoteMarkdown:{}}));
});
