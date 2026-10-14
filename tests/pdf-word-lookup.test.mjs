import {test} from 'node:test';import assert from 'node:assert/strict';
import {englishWordAt,wordRangeAtPoint} from '../src/lib/pdf-word-lookup.ts';
test('word lookup identifies the clicked English token, apostrophes and hyphens, without selecting surrounding text',()=>{
 assert.deepEqual(englishWordAt('The point-cloud model',9),{start:4,end:15,text:'point-cloud'});
 assert.equal(englishWordAt("don't panic",3).text,"don't");assert.equal(englishWordAt('机器人 123',2),null);assert.equal(englishWordAt('hello',-1),null);
});
test('click lookup measures a Range without creating a native Selection, and ignores blank page space',()=>{
 const oldNode=globalThis.Node;globalThis.Node={TEXT_NODE:3};
 const textNode={nodeType:3,textContent:'one locomotion test'};let captured;
 const doc={caretPositionFromPoint:()=>({offsetNode:textNode,offset:8}),createRange:()=>({setStart:(node,offset)=>{captured={node,start:offset};},setEnd:(_,offset)=>{captured.end=offset;},getClientRects:()=>[{left:10,right:80,top:20,bottom:40}]})};
 const layer={ownerDocument:doc,contains:n=>n===textNode};
 try{assert.ok(wordRangeAtPoint(layer,30,30));assert.deepEqual([captured.start,captured.end],[4,14]);assert.equal(wordRangeAtPoint(layer,150,100),null);assert.equal(wordRangeAtPoint({...layer,contains:()=>false},30,30),null);}finally{globalThis.Node=oldNode;}
});
test('Chromium caretRange fallback supports click lookup when standard caret position is unavailable',()=>{
 const oldNode=globalThis.Node;globalThis.Node={TEXT_NODE:3};const node={nodeType:3,textContent:'model'};let end;
 const doc={caretRangeFromPoint:()=>({startContainer:node,startOffset:2}),createRange:()=>({setStart:()=>{},setEnd:(_,o)=>{end=o;},getClientRects:()=>[{left:0,right:50,top:0,bottom:20}]})};
 try{assert.ok(wordRangeAtPoint({ownerDocument:doc,contains:()=>true},10,10));assert.equal(end,5);}finally{globalThis.Node=oldNode;}
});
