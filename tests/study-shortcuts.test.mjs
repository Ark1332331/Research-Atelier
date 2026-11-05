import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const directory=await mkdtemp(path.join(os.tmpdir(),'ra-shortcuts-'));
process.env.RA_DATA_DIR=directory;
after(()=>rm(directory,{recursive:true,force:true}));
const {GET,PUT}=await import('../src/app/api/study-shortcuts/route.ts');
const save=body=>PUT(new Request('http://localhost/api/study-shortcuts',{method:'PUT',body:JSON.stringify(body)}));
test('defaults, custom order, edits and disabled items survive reload, including an intentionally empty list',async()=>{
 const initial=await (await GET()).json();assert.deepEqual(initial.shortcuts.map(s=>s.title),['解题','是什么','为什么']);
 const custom={id:'custom',title:'举个例子',prompt:'请用一个具体例子解释选中内容。',enabled:true};
 const shortcuts=[custom,{...initial.shortcuts[0],enabled:false,prompt:'先给提示，再给推导。'}];
 assert.equal((await save({shortcuts,revision:initial.revision})).status,200);
 let saved=await (await GET()).json();assert.deepEqual(saved.shortcuts,shortcuts);assert.equal(saved.revision,1);
 assert.equal((await save({shortcuts:[],revision:0})).status,409);
 assert.deepEqual((await (await GET()).json()).shortcuts,shortcuts);
 assert.equal((await save({shortcuts:[],revision:1})).status,200);
 saved=await (await GET()).json();assert.deepEqual(saved.shortcuts,[]);
});
test('invalid templates never replace saved settings',async()=>{
 const item={id:'a',title:'解题',prompt:'解释。',enabled:true};
 for(const shortcuts of [[{...item,title:' '}],[{...item,prompt:''}],[{...item,prompt:'x'.repeat(2001)}],[item,item],[{...item,enabled:'yes'}],Array.from({length:13},(_,i)=>({...item,id:String(i)}))]){
  assert.equal((await save({shortcuts,revision:2})).status,400);
 }
 assert.deepEqual((await (await GET()).json()).shortcuts,[]);
});
