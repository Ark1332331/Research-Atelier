import test from 'node:test';
import assert from 'node:assert/strict';
import {watchAnswerProgress} from '../src/lib/answer-deadline.ts';

test('first-text timeout differs from a stalled partial answer; empty/repeated frames do not renew it',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const first=new AbortController(),a=watchAnswerProgress(first);
 a.progress('');t.mock.timers.tick(179999);assert.equal(first.signal.aborted,false);
 t.mock.timers.tick(1);assert.equal(first.signal.reason.name,'TimeoutError');assert.match(first.signal.reason.message,/180 秒内未返回正文/);
 const idle=new AbortController(),b=watchAnswerProgress(idle);b.progress('已输出');
 t.mock.timers.tick(60000);b.progress('已输出');b.progress('');
 t.mock.timers.tick(30000);assert.equal(idle.signal.aborted,true);assert.match(idle.signal.reason.message,/输出中断.*90 秒/);
 a.dispose();b.dispose();
});

test('each concurrent answer owns its deadline and completion/stop clears its timer',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const active=new AbortController(),stalled=new AbortController();
 const a=watchAnswerProgress(active),b=watchAnswerProgress(stalled);
 for(let i=0;i<5;i++){t.mock.timers.tick(60000);a.progress('回答'+i);}
 assert.equal(stalled.signal.aborted,true);assert.equal(active.signal.aborted,false);
 a.dispose();t.mock.timers.tick(1000000);assert.equal(active.signal.aborted,false);
 const stopped=new AbortController(),c=watchAnswerProgress(stopped);stopped.abort(new DOMException('用户停止','AbortError'));
 c.progress('过期更新');t.mock.timers.tick(1000000);assert.equal(stopped.signal.reason.name,'AbortError');
 b.dispose();c.dispose();
});
