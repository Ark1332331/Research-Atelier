import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({nodes:[],notes:[],threads:[],entries:[],projects:[],groups:[],papers:[]})}));
 await page.goto(process.env.READER_TEST_URL??'http://localhost:3000');
 await page.getByRole('button',{name:'学习',exact:true}).click({timeout:4000});
 await page.getByRole('heading',{name:'学习资料',exact:true}).waitFor();
 assert.ok(await page.getByRole('button',{name:'新建资料库',exact:true}).isEnabled());
 console.log('PASS study entry and empty library');
}finally{await browser.close();}
