import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(os.tmpdir(),'ra-import-request-'));
process.env.RA_DATA_DIR=dir;
const {normalizeImportRequest,preprocessImportRequest}=await import('../src/lib/paper-import-request.ts');
after(()=>rm(dir,{recursive:true,force:true}));

const originalFetch = globalThis.fetch;
const originalKey = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});
const item = (name, context = '', original = name) => ({ name, context, original });
const imported = (names, targetGroup) => ({ action: 'import', items: names.map(name => item(name)), ...(targetGroup ? { targetGroup } : {}) });

test('AI preprocessing separates 20 papers from nested components and preserves the destination', async () => {
  const names = ['AeroVLA', 'DroneFINE', 'FusionTrack', 'HUGE-Bench', 'SkyReg', 'infogeo', 'AutoFly', 'DroneDINO', 'MMGeo', 'UAVScenes', 'TravelUAV', 'MCR-UOD', 'WeatherPrompt', 'DroneCATS', 'CosFly-VLA', 'OpenFly', 'STEMFly', 'SatNav', 'FlightGPT', 'WorldVLN'];
  const input = names.map((name, index) => `${index + 1}. ${name}：${name === 'TravelUAV' ? '包含 1. OpenUAV 2. Target-oriented UAV VLN Dataset 3. UAV-Need-Help 4. UAV Navigation LLM' : name === 'OpenFly' ? '包括 1.关键帧选取 2.视觉token合并' : '无人机相关研究'}`).join('\n') + '\n都导入进UAV文件夹';
  process.env.DEEPSEEK_API_KEY = 'test-key';
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek-chat');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.ok(body.max_tokens >= 6000);
    assert.equal(body.messages.at(-1).content, input);
    assert.match(body.messages[0].content, /子项|组成部分/);
    assert.equal(body.tools, undefined);
    const response = imported(names, 'UAV');
    response.items[10] = item('TravelUAV', '包含 OpenUAV、数据集、求助基准和 LLM 导航组件', input.split('\n')[10]);
    response.items[15] = item('OpenFly', '关键帧选取与视觉 token 合并', input.split('\n')[15]);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }] }));
  };
  const result = await preprocessImportRequest(input);
  assert.equal(requests, 1);
  assert.deepEqual(result.items.map(entry => entry.name), names);
  assert.equal(result.targetGroup, 'UAV');
  assert.match(result.items[10].context, /OpenUAV/);
});

test('validates single requests and deduplicates names while retaining annotations', () => {
  const result = normalizeImportRequest({ action: 'import', items: [item('AeroVLA', '第一条'), item('aerovla', '补充说明')], targetGroup: 'UAV' }, '导入 AeroVLA，放到「UAV」分组');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'AeroVLA');
  assert.match(result.items[0].context, /第一条/);
  assert.match(result.items[0].context, /补充说明/);
});

test('grounds names in current or prior user text, never assistant inventions', () => {
  assert.equal(normalizeImportRequest(imported(['CosFly-VLA']), '导入 CosFly–VLA').items[0].name, 'CosFly-VLA');
  assert.equal(normalizeImportRequest(imported(['AeroVLA']), '继续', [{ role: 'user', content: '导入 AeroVLA' }]).items[0].name, 'AeroVLA');
  for (const name of ['AeroVLA: A Completely Invented Full Title', 'https://example.org/paper', 'UnknownPaper']) {
    assert.throws(() => normalizeImportRequest(imported([name]), '导入 AeroVLA', [{ role: 'assistant', content: name }]), /用户|原文/);
  }
});

test('validates continuation and clarification without fabricating import entries', () => {
  assert.deepEqual(normalizeImportRequest({ action: 'continue', items: [] }, '继续'), { action: 'continue', items: [] });
  assert.deepEqual(normalizeImportRequest({ action: 'clarify', items: [], question: '请提供具体论文标题。' }, '导入那个'), { action: 'clarify', items: [], question: '请提供具体论文标题。' });
  assert.throws(() => normalizeImportRequest({ action: 'clarify', items: [] }, '导入那个'), /整理|澄清/);
  assert.throws(() => normalizeImportRequest({ action: 'continue', items: [item('AeroVLA')] }, '继续 AeroVLA'), /整理/);
});

test('rejects invented groups, filesystem paths, and invalid model response shapes', () => {
  for (const group of ['../UAV', 'D:\\papers\\UAV', 'papers/UAV', '..', '...', 'a'.repeat(61)]) {
    assert.throws(() => normalizeImportRequest(imported(['AeroVLA'], group), `导入 AeroVLA 到 ${group} 文件夹`), /分组/);
  }
  assert.throws(() => normalizeImportRequest(imported(['AeroVLA'], 'Invented'), '导入 AeroVLA 到 UAV 文件夹'), /分组/);
  for (const payload of [null, [], {}, { action: 'delete', items: [] }, { action: 'import', items: [] }, { action: 'import', items: [{ name: 'AeroVLA' }] }]) {
    assert.throws(() => normalizeImportRequest(payload, 'AeroVLA'), /整理/);
  }
});

test('rejects oversized lists or names instead of silently losing requested work', () => {
  const names = Array.from({ length: 101 }, (_, index) => `Paper${index}`);
  assert.throws(() => normalizeImportRequest(imported(names), names.join(' ')), /100/);
  assert.throws(() => normalizeImportRequest(imported(['A'.repeat(501)]), 'A'.repeat(501)), /500/);
});

test('fails safely on missing credentials, HTTP failures, invalid JSON, and truncated output', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  await assert.rejects(preprocessImportRequest('导入 AeroVLA'), /尚未配置模型/);
  process.env.DEEPSEEK_API_KEY = 'test-key';
  for (const response of [
    new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] })),
    new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(imported(['AeroVLA'])) } }] })),
  ]) {
    globalThis.fetch = async () => response;
    await assert.rejects(preprocessImportRequest('导入 AeroVLA'), /整理|解析/);
  }
});

const tableGroups = ['无人机 VQA / 感知与相邻评测', '大厂通用空间 / 视频 VLM', 'ICML / 高分辨 / RL / OPD 直接竞争工作'];
const tablePapers = [
  ['Is your VLM Sky-Ready? / Sky-VLM', 'https://openaccess.thecvf.com/content/CVPR2026/html/Zhang_Is_your_VLM_Sky-Ready_A_Comprehensive_Spatial_Intelligence_Benchmark_for_CVPR_2026_paper.html', 0],
  ['PixDLM', 'https://github.com/XIEFOX/PixDLM', 0],
  ['AirCopBench', 'https://github.com/EmbodiedCity/AirCopBench.code', 0],
  ['UAV-MAS / UAVQA-Bench', 'https://arxiv.org/abs/2608.11738', 0],
  ['ReVA', 'https://arxiv.org/abs/2609.35507', 0],
  ['HiSpatial', 'https://www.microsoft.com/en-us/research/publication/hispatial-taming-hierarchical-3d-spatial-understanding-in-vision-language-models/', 1],
  ['Gemini Robotics ER 2', 'https://deepmind.google/models/model-cards/gemini-robotics-er-2/', 1],
  ['Cosmos-Reason2', 'https://docs.nvidia.com/cosmos/latest/reason2/index.html', 1],
  ['WeVisOne-VL', 'https://github.com/Tencent/WeVisOne-VL', 1],
  ['Qwen3-VL / Qwen3.5-VL', 'https://github.com/QwenLM/Qwen3-VL', 1],
  ['UHR-BAT', 'https://proceedings.mlr.press/v306/dang26a.html', 2],
  ['Text Before Vision', 'https://proceedings.mlr.press/v306/wang26u.html', 2],
  ['RS-OPSD', 'https://arxiv.org/abs/2609.38072', 2],
  ['Rift: Answer-invariant Redundancy', 'https://arxiv.org/abs/2609.29029', 2],
  ['CVSBench', 'https://earth-insights.github.io/CVSBench/', 2],
  ['RP-OPSD', 'https://arxiv.org/abs/2607.24447', 2],
];
// Preserves the user's 16 linked rows and the plain first heading; annotations are shortened.
const tableInput = tableGroups.map((group, index) => `${index ? '## ' : ''}${group}\n\n| 论文 / 模型（链接） | 任务 |\n| --- | --- |\n${tablePapers.filter(paper => paper[2] === index).map(([name, url]) => `| [${name}](${url}) | 研究内容 |`).join('\n')}`).join('\n\n');
const classifiedTableInput = tableInput + '\n\n根据这里面的分类创建分组并对应导入';

test('AI table preprocessing preserves all 16 supplied URLs and 5/5/6 heading assignments', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    assert.match(prompt, /sourceUrl/);
    assert.match(prompt, /groups/);
    // AI still extracts the papers; exact source rows repair its omitted links and groups.
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(imported(tablePapers.map(paper => paper[0]))) } }] });
  };
  const result = await preprocessImportRequest(classifiedTableInput);
  assert.equal(result.items.length, 16);
  assert.deepEqual(result.groups, tableGroups);
  assert.equal(result.targetGroup, undefined);
  result.items.forEach((entry, index) => {
    assert.equal(entry.sourceUrl, tablePapers[index][1]);
    assert.equal(entry.targetGroup, tableGroups[tablePapers[index][2]]);
  });
  assert.deepEqual(tableGroups.map(group => result.items.filter(entry => entry.targetGroup === group).length), [5, 5, 6]);
});

test('accepts explicit item destinations and logical slash group names', () => {
  const result = normalizeImportRequest({ action: 'import', groups: tableGroups, items: tablePapers.map(([name, sourceUrl, group]) => ({ ...item(name), sourceUrl, targetGroup: tableGroups[group] })) }, classifiedTableInput);
  assert.deepEqual(result.groups, tableGroups);
  assert.equal(result.items[0].sourceUrl, tablePapers[0][1]);
  assert.equal(normalizeImportRequest(imported(['AeroVLA'], tableGroups[0]), `把 AeroVLA 导入到「${tableGroups[0]}」分组`).targetGroup, tableGroups[0]);
});

test('headings alone preserve URLs without creating inferred topic groups', () => {
  const result = normalizeImportRequest(imported(tablePapers.map(paper => paper[0])), tableInput + '\n请导入这些论文');
  assert.equal(result.groups, undefined);
  assert.ok(result.items.every(entry => entry.targetGroup === undefined));
  assert.equal(result.items[0].sourceUrl, tablePapers[0][1]);
  assert.throws(() => normalizeImportRequest({ ...imported(['PixDLM']), groups: [tableGroups[0]] }, tableInput + '\n请导入这些论文'), /分组/);
});

test('rejects invented or cross-row URLs and unsafe item destinations', () => {
  for (const sourceUrl of ['https://example.org/invented', 'javascript:alert(1)', 'https://github.com/XIEFOX/PixDLM/other', tablePapers[2][1]]) {
    assert.throws(() => normalizeImportRequest({ action: 'import', items: [{ ...item('PixDLM'), sourceUrl }] }, classifiedTableInput), /链接|URL/);
  }
  for (const targetGroup of ['/tmp/UAV', 'C:\\papers', '../UAV', 'UAV / ../Other']) {
    assert.throws(() => normalizeImportRequest({ action: 'import', items: [{ ...item('AeroVLA'), targetGroup }] }, `导入 AeroVLA 到 ${targetGroup} 分组`), /分组/);
  }
  assert.throws(() => normalizeImportRequest({ action: 'import', items: [{ ...item('AeroVLA'), targetGroup: 'Unknown' }] }, '导入 AeroVLA 到 UAV 分组'), /分组/);
});

test('only exact matching source rows can restore omitted URLs', () => {
  const input = '| [AeroVLA Extended](https://example.org/extended) |\n导入 AeroVLA';
  assert.equal(normalizeImportRequest(imported(['AeroVLA']), input).items[0].sourceUrl, undefined);
  const original = '| [AeroVLA Extended](https://example.org/extended) |';
  assert.equal(normalizeImportRequest({ action: 'import', items: [item('AeroVLA', '', original)] }, input).items[0].sourceUrl, 'https://example.org/extended');
});
