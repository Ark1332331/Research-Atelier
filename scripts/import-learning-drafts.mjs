// Explicit import into the controlled review inbox, never into the active profile.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mutateLearning, addProposal } from '../src/lib/learning/store.ts';
const root = process.argv[2];
if (!root) throw new Error('Usage: node --experimental-strip-types scripts/import-learning-drafts.mjs <documents-directory>');
const names = ['user_model_draft.md', 'project_state.md', 'workflow_v2_design_draft.md', 'workflow_design_notes.md'];
const documents = await Promise.all(names.map(async name => {
  const content = await readFile(path.join(root, name), 'utf8');
  return { name, content, hash: createHash('sha256').update(content).digest('hex') };
}));
const profile = documents[0];
const candidates = profile.content.split(/(?=^### )/m).filter(section => /^### 0\./.test(section)).map(section => {
  const title = section.split('\n')[0].replace(/^### /, '');
  const effect = section.match(/^影响[：:](.+)$/m)?.[1];
  const evidence = section.match(/^证据[：:](.+)$/m)?.[1];
  if (!effect || !evidence || /^0\.(16|29) /.test(title)) return null;
  const scene = /代码|Python|库方法|TDD|神经网络/.test(title) ? 'code' : /复现|实验|环境/.test(title) ? 'repro' : /论文|术语/.test(title) ? 'paper' : 'general';
  return { key: `draft:${title.split(' ')[0]}`, kind: 'workflow', text: effect.slice(0, 2000), scene, projectId: null, quote: evidence.slice(0, 4000),
    source: `${profile.name} / ${title} / SHA256 ${profile.hash} / 历史材料，当前待确认` };
}).filter(Boolean);
const report = await mutateLearning(state => {
  const before = state.memories.length;
  for (const p of candidates) addProposal(state, p);
  return { added: state.memories.length - before, candidates: candidates.length, documents: documents.map(({ name, hash }) => ({ name, hash })) };
});
console.log(JSON.stringify(report, null, 2));
