import {configuredModelKey,fetchModel} from './model-config.ts';
export interface ImportRequest {
  items: { name: string; context: string; original: string; sourceUrl?: string; targetGroup?: string }[];
  groups?: string[];
  targetGroup?: string;
  action: 'import' | 'continue' | 'clarify';
  question?: string;
}

type HistoryMessage = { role: string; content: string };
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const invalid = () => new Error('AI 未能可靠整理导入请求，请补充论文名称后重试；尚未根据此结果导入论文。');

type LinkedRow = { name: string; sourceUrl: string; original: string; group?: string };

/** Only restore metadata from an exact linked title or copied source row, never a fuzzy title search. */
function linkedRows(text: string): LinkedRow[] {
  const rows: LinkedRow[] = [];
  let heading: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const link = line.match(/^\|\s*\[([^\]]+)\]\((https?:\/\/(?:[^\s()]+|\([^()]*\))+)\)\s*\|/i);
    if (link) {
      rows.push({ name: link[1], sourceUrl: link[2], original: line, ...(heading ? { group: heading } : {}) });
    } else if (!line.startsWith('|')) {
      heading = line.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
    }
  }
  return rows;
}

/** Validate model output before any search or import side effect is permitted. */
export function normalizeImportRequest(payload: unknown, text: string, history: HistoryMessage[] = []): ImportRequest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid();
  const data = payload as Record<string, unknown>;
  if (!['import', 'continue', 'clarify'].includes(String(data.action)) || !Array.isArray(data.items)) throw invalid();
  if (data.items.length > 100) throw new Error('一次最多整理 100 篇论文，请分批导入。');
  const action = data.action as ImportRequest['action'];
  if ((action === 'import') !== (data.items.length > 0)) throw invalid();

  const source = [text, ...history.filter(message => message.role === 'user').map(message => message.content)];
  const grounding = source.map(normalized);
  const present = (value: string) => Boolean(normalized(value)) && grounding.some(message => message.includes(normalized(value)));
  const rowsByMessage = source.map(linkedRows);
  const urls = new Set(source.flatMap(message => message.match(/https?:\/\/[^\s<>"\]\)]+/gi) ?? []));
  for (const rows of rowsByMessage) for (const row of rows) urls.add(row.sourceUrl);
  const groupingRequested = source.some(message => /分组|文件夹|\bgroups?\b|\bgrouping\b/i.test(message));
  const classificationRequested = source.some(message => /(?:分类|类别|标题|heading|categor\w*|sections?)[\s\S]{0,50}(?:分组|groups?)|(?:分组|groups?)[\s\S]{0,50}(?:分类|类别|标题|heading|categor\w*|sections?)/i.test(message));
  const groupName = (value: unknown): string => {
    if (typeof value !== 'string') throw invalid();
    const group = value.trim();
    // Spaced slashes in a descriptive label are logical separators, not directory separators.
    if (!group || group.length > 60 || /[<>:"\\|?*\u0000-\u001f]/.test(group) || /^\.+$/.test(group) || /^[\/~]/.test(group) || /\/$/.test(group) || /(?:^|\/)\s*\.{1,2}\s*(?:\/|$)/.test(group) || /\S\/\S/.test(group)) {
      throw new Error('目标分组应为 1–60 字符的名称，不能使用文件路径。');
    }
    if (!source.some(message => message.includes(group))) throw new Error('目标分组必须来自用户明确提供的名称，请确认分组后重试。');
    return group;
  };
  const result: ImportRequest = { action, items: [] };
  const groups = new Set<string>();
  if (data.groups !== undefined) {
    if (!Array.isArray(data.groups) || data.groups.length > 100) throw invalid();
    if (data.groups.length && !groupingRequested) throw new Error('只有用户明确要求分组时才能创建分组。');
    for (const group of data.groups) groups.add(groupName(group));
  }
  const seen = new Map<string, ImportRequest['items'][number]>();
  for (const entry of data.items) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || typeof entry.context !== 'string' || typeof entry.original !== 'string') throw invalid();
    const name = entry.name.trim(), context = entry.context.trim(), original = entry.original.trim();
    if (!name || name.length > 500) throw new Error('整理后的单篇论文名称或标识应为 1–500 字符。');
    if (!present(name) || !original || !present(original)) throw new Error('AI 整理出的论文名称或原文片段未出现在用户输入中，请补充原始标题后重试。');
    const matchingRows = rowsByMessage.map(rows => rows.filter(row => normalized(row.name) === normalized(name) || row.original === original)).find(rows => rows.length > 0) ?? [];
    const row = matchingRows.length === 1 ? matchingRows[0] : undefined;
    let sourceUrl: string | undefined;
    if (entry.sourceUrl !== undefined && entry.sourceUrl !== null && entry.sourceUrl !== '') {
      if (typeof entry.sourceUrl !== 'string' || !/^https?:\/\//i.test(entry.sourceUrl) || !urls.has(entry.sourceUrl) || (row && row.sourceUrl !== entry.sourceUrl)) {
        throw new Error('论文来源链接 URL 必须与用户原文中该篇论文的 HTTP(S) 链接完全一致。');
      }
      try { new URL(entry.sourceUrl); } catch { throw new Error('论文来源链接 URL 无效。'); }
      sourceUrl = entry.sourceUrl;
    } else if (row) {
      sourceUrl = row.sourceUrl;
    }
    let targetGroup: string | undefined;
    if (entry.targetGroup !== undefined && entry.targetGroup !== null && entry.targetGroup !== '') {
      if (!groupingRequested) throw new Error('只有用户明确要求分组时才能指定论文分组。');
      targetGroup = groupName(entry.targetGroup);
    }
    if (classificationRequested && row?.group) targetGroup = groupName(row.group);
    if (targetGroup) groups.add(targetGroup);
    const identity = normalized(name);
    const previous = seen.get(identity);
    if (previous) {
      if ((previous.sourceUrl && sourceUrl && previous.sourceUrl !== sourceUrl) || (previous.targetGroup && targetGroup && previous.targetGroup !== targetGroup)) throw new Error('同一论文的来源链接或分组存在冲突，请确认后重试。');
      if (sourceUrl) previous.sourceUrl = sourceUrl;
      if (targetGroup) previous.targetGroup = targetGroup;
      if (context && context !== previous.context) previous.context = [previous.context, context].filter(Boolean).join('\n');
      if (original !== previous.original) previous.original += '\n' + original;
    } else {
      const item = { name, context, original, ...(sourceUrl ? { sourceUrl } : {}), ...(targetGroup ? { targetGroup } : {}) };
      seen.set(identity, item);
      result.items.push(item);
    }
  }
  if (groups.size) result.groups = [...groups];

  if (data.targetGroup !== undefined && data.targetGroup !== null && data.targetGroup !== '') {
    result.targetGroup = groupName(data.targetGroup);
  }
  if (action === 'clarify') {
    if (typeof data.question !== 'string' || !data.question.trim() || data.question.length > 1000) throw invalid();
    result.question = data.question.trim();
  }
  return result;
}

const instructions = `你是论文导入请求的前置整理器。只理解用户请求并返回 JSON，不检索、不下载、不生成论文元数据或链接。
返回结构：{"action":"import|continue|clarify","items":[{"name":"用户实际提供的论文名称、简称、DOI 或 arXiv 编号","context":"用于后续核验的说明","original":"对应用户原文短片段","sourceUrl":"该行用户提供的原始 HTTP(S) 链接（可省略）","targetGroup":"该篇所属的用户明确指定分组（可省略）"}],"groups":["用户要求创建的全部分组名称（可省略）"],"targetGroup":"用户明确指定的全局论文库分组（可省略）","question":"需要澄清时的问题（可省略）"}。
规则：
1. 根据语义而不是编号拆分独立论文。中文注释、研究内容、方法步骤放在 context。单篇请求也返回一个条目。每篇只保留简洁检索名称，不把中文说明拼入 name。
2. 嵌套列表可能是同一论文的组成部分，例如平台、数据集、评测基准、导航模型、关键帧选取或视觉 token 合并。这些子项应留在该论文 context，除非用户明确要求把它们也作为独立论文导入。不要看到英文名称或重新从 1 开始编号就新增论文。
3. name 必须直接来自当前用户输入，或与当前请求相关的历史用户消息。保留原有简称，不扩写为推测的完整标题，不纠正为另一篇论文，不编造作者、年份、DOI、URL。original 复制对应用户原文的短片段，不必重复全部说明。context 可概括原注释，但不能新增事实。
4. 用户说“都导入进 UAV 文件夹”“放到「UAV」分组”时，全局 targetGroup 是原文中的 UAV。用户要求“根据分类创建分组并对应导入”时，groups 必须包含全部分类标题，每个 items[].targetGroup 必须保留其所属标题原文（包括空格和 /），不要将多个分类合并成一个全局分组。这里文件夹指论文库分组，不是磁盘路径。没有明确分组要求就省略 groups 和所有 targetGroup；不得仅因出现主题或表格标题推测分组，也不得把文件路径截成最后一级名称。
5. 新的或补充后的明确论文请求用 action=import。用户只要求继续已有任务或重试，用 action=continue 且 items=[]。无法确定具体论文或导入意图时用 action=clarify、items=[] 并提出简短中文 question。不要因只给了简称而自行扩写；简称也可以检索。
6. Markdown 表格中的每个独立论文行必须保留为一个条目；[论文名称](链接) 中的链接必须原样复制到该条目的 sourceUrl，不能丢弃、改写、替换或编造链接。网页、GitHub、模型卡链接也须原样保留，后续流程会核验是否为论文。name 保留链接文字，original 尽量复制完整对应行，不能将其他行的链接混入。
7. 最多 100 个条目，每个 name 最多 500 字符，重复论文只列一次。不得遗漏顶层独立论文。每个 targetGroup 最多 60 字符。只输出 JSON 对象。`;

/** A separate model pass keeps long annotated input out of tool-call planning. */
export async function preprocessImportRequest(text: string, history: HistoryMessage[] = []): Promise<ImportRequest> {
  const key = await configuredModelKey();
  if (!key) throw new Error('尚未配置模型，无法整理导入请求。');
  const recent = history.filter(message => ['user', 'assistant'].includes(message.role)).slice(-12);
  let payload: unknown;
  try {
    const response = await fetchModel({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: 'deepseek-chat', temperature: 0, max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: instructions }, ...recent, { role: 'user', content: text }],
      }),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (!choice || choice.finish_reason === 'length' || typeof choice.message?.content !== 'string') throw invalid();
    payload = JSON.parse(choice.message.content);
  } catch {
    throw new Error('AI 前置整理请求失败或返回内容不完整，请稍后重试；尚未根据此结果导入论文。');
  }
  return normalizeImportRequest(payload, text, recent);
}
