import {pathToFileURL} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.STUDY_TEST_URL??'http://localhost:3132';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const content=await readFile(new URL('../fixtures/practice01-import.md',import.meta.url),'utf8');
  const node={id:'numbering-fixture',parentId:null,kind:'document',name:'Practice1.md',order:0};
  await page.route('**/api/study-library',r=>r.fulfill({json:{nodes:[node]}}));
  await page.route('**/api/study-library/document?*',r=>r.fulfill({json:{node,content,links:{}}}));
  await page.route('**/api/reading-memory',r=>r.fulfill({json:{threads:[]}}));
  await page.route('**/api/reading-notes',r=>r.fulfill({json:{notes:[]}}));
  await page.route('**/api/reading-collection*',r=>r.fulfill({json:{entries:[]}}));
  await page.goto(base+'/study/numbering-fixture');await page.locator('.study-markdown li').first().waitFor();
  const list=page.locator('.study-markdown ol > li');
  assert.deepEqual(await list.evaluateAll(items=>items.map(li=>li.value)),[1,2,3,4,1,2,3,4,5,6,7,8,9,10,1,2,3,4,5]);
  assert.ok(await list.evaluateAll(items=>items.every(li=>{const marker=getComputedStyle(li,'::marker'),text=getComputedStyle(li);return marker.fontSize===text.fontSize&&marker.color===text.color;})));
  assert.ok(await list.first().evaluate(li=>{
    const top=label=>{const walker=document.createTreeWalker(li,NodeFilter.SHOW_TEXT);let text;while((text=walker.nextNode())){const offset=text.textContent.indexOf(label);if(offset>=0){const range=document.createRange();range.setStart(text,offset);range.setEnd(text,offset+3);return range.getBoundingClientRect().top;}}return NaN;};
    return top('(2)')>top('(1)')+10;
  }),'subquestions must appear on separate lines');
  await mkdir('.build-cache/numbering-qa',{recursive:true});await page.screenshot({path:'.build-cache/numbering-qa/practice1.png'});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  console.log('PASS Practice1 exact numbers, legible markers, separate subquestions, mobile width');

  // Read-only audit of the documents already in this library, including saved
  // highlight anchors. Never import, edit, or delete the user's stored materials.
  if(process.env.STUDY_AUDIT_EXISTING==='1') {
    const audit=await browser.newPage({viewport:{width:1440,height:1100}});
    const {nodes}=await(await audit.request.get(base+'/api/study-library')).json();
    const {threads=[]}=await(await audit.request.get(base+'/api/reading-memory')).json();
    let count=0,anchors=0,unmatched=0;
    for(const doc of nodes.filter(n=>n.kind==='document')) {
      const before=await(await audit.request.get(base+'/api/study-library/document?id='+doc.id)).json();
      await audit.goto(base+'/study/'+doc.id);await audit.locator('.study-markdown').waitFor();
      const items=await audit.locator('.study-markdown ol > li').evaluateAll(items=>items.map(li=>({value:li.getAttribute('value'),font:getComputedStyle(li).fontSize,markerFont:getComputedStyle(li,'::marker').fontSize})));
      assert.ok(items.every(item=>item.value!==null&&item.font===item.markerFont),doc.name+' retains all ordered markers');
      const sourceKey=await audit.locator('[data-reading-source]').first().getAttribute('data-reading-source');
      const saved=threads.filter(t=>t.anchor.scope==='/study/'+doc.id&&t.anchor.sourceKey===sourceKey);
      for(const thread of saved) {
        const matches=await audit.locator('[data-reading-source]').first().evaluate((root,a)=>root.textContent.slice(a.start,a.end)===a.text,thread.anchor);
        if(doc.name==='01.md') assert.ok(matches,doc.name+' retains saved highlight '+thread.id);
        if(matches) anchors++; else unmatched++;
      }
      const after=await(await audit.request.get(base+'/api/study-library/document?id='+doc.id)).json();
      assert.equal(after.content,before.content);count++;
    }
    console.log(`PASS existing library: ${count} documents, ${anchors} matching saved anchors, original content unchanged; ${unmatched} other anchors need baseline comparison`);
  }
} finally {await browser.close();}
