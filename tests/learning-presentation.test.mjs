import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewGroups, recordUnavailable } from '../src/lib/learning/presentation.ts';
test('review combines one observation and dependent strategies without duplicate candidates', () => {
 const state = { profiles: [{id:'p',dimension:'background',status:'pending'}], memories: [{id:'m',status:'pending',basis:[{id:'p',version:1}]}], observations:[{id:'o1',profileIds:['p'],candidateIds:['m']},{id:'o2',profileIds:['p'],candidateIds:['m']}] };
 const groups = reviewGroups(state); assert.equal(groups.length,1); assert.equal(groups[0].memories.length,1);
 state.profiles[0].status='active'; assert.equal(reviewGroups(state)[0].profiles.length,1);
 state.memories[0].status='active'; assert.deepEqual(reviewGroups(state),[]);
});
test('legacy manual proposals remain reviewable and deleted event references are ignored', () => {
 const groups=reviewGroups({profiles:[],memories:[{id:'manual',status:'pending'},{id:'done',status:'active'}],observations:[{id:'gone',profileIds:['deleted'],candidateIds:[]}]});
 assert.equal(groups.length,1); assert.equal(groups[0].memories[0].id,'manual');
});
test('current list excludes expired strategies and stale profile dependencies without hiding them from history', () => {
 const state={profiles:[{id:'p',status:'active',version:2}]};
 assert.equal(recordUnavailable({status:'active',expiresAt:'2020-01-01'},state,Date.parse('2026-01-01')),'已过期');
 assert.equal(recordUnavailable({status:'active',basis:[{id:'p',version:1}]},state,0),'依据待核对');
 assert.equal(recordUnavailable({status:'active',basis:[{id:'p',version:2}]},state,0),null);
 assert.equal(recordUnavailable({status:'active',dimension:'goal'},state,0),null);
});
