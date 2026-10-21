const string = { type: 'string', minLength: 1 };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = items => ({ type: 'array', items });
const strings = array(string);
const run = { runFile: string };
const source = object({ url: string, title: string, versionDate: string, readAt: string,
  access: { enum: ['public-free'] }, limits: string }, ['url', 'title', 'versionDate', 'readAt', 'access', 'limits']);
const candidate = object({ id: string, question: string, why: string, hypothesis: string,
  counterEvidence: string, firstQuestion: string, sources: { ...array(source), minItems: 1 } },
['id', 'question', 'why', 'hypothesis', 'counterEvidence', 'firstQuestion', 'sources']);
const tool = (name, description, inputSchema, readOnlyHint = false) => ({ name, description, inputSchema,
  annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: !readOnlyHint } });

export const TOOLS = [
  tool('discussion_doctor', '检查安装配置、Windows、Node、Python/uv与Jev文件；不打开浏览器或调用模型。', object({}), true),
  tool('discussion_init', '在搜索前登记研究开始时间。工作区来自安装配置；null轮数表示无预设上限。', object({
    maxRounds: { type: ['integer', 'null'], minimum: 1, maximum: 30 }, context: { type: 'string' }, stopCriteria: strings,
    discussionStyle: { enum: ['delta', 'expanded'] }, answerBudgetCharacters: { type: 'integer', minimum: 100, maximum: 5000 } })),
  tool('discussion_select', '保存主持实际读取的免费公开来源、候选、选择依据与首问；工具本身不搜索、不编造来源。',
    object({ ...run, candidates: { ...array(candidate), minItems: 1 }, selectedId: string, reason: string }, ['runFile', 'candidates', 'selectedId', 'reason'])),
  tool('discussion_start', '创建专用Chrome Copilot新对话并绑定；Chrome Allow与Microsoft登录由用户完成。只start一次。', object(run, ['runFile'])),
  tool('discussion_ask', '精确提交一个问题，短等待后返回；pending自动后台采集，严禁再次ask同一轮。追问必须基于最新回答。', object({ ...run,
    question: { ...string, maxLength: 20000 }, analysis: { type: 'string' }, expectedProgress: { type: 'string' },
    basedOnRound: { type: 'integer', minimum: 1 }, discussionStyle: { enum: ['delta', 'expanded'] } }, ['runFile', 'question'])),
  tool('discussion_result', '读取实际回答；等待最多20秒。pending只继续result，后台采集不会生成或发送新问题。进程重开可恢复原runFile。', object({ ...run,
    waitMs: { type: 'integer', minimum: 0, maximum: 20000 } }, ['runFile'])),
  tool('discussion_control', '暂停/恢复/检查、恢复未发送草稿、提交核验草稿或关闭本次专用标签页。已有发送标记的未知消息禁止重发。', object({ ...run,
    action: { enum: ['status', 'pause', 'resume', 'bind', 'recover-draft', 'submit', 'close'] },
    browser: { type: 'boolean' }, reason: { type: 'string' } }, ['runFile', 'action'])),
  tool('discussion_evidence', '追加主张核验与纠正，保留原答。verified仅用于已实际核验来源；推导用inference。', object({ ...run,
    updates: { ...array(object({ claim: string, finding: string, status: { enum: ['verified', 'disputed', 'inference', 'unverified'] },
      sources: strings }, ['claim', 'finding', 'status'])), minItems: 1 } }, ['runFile', 'updates'])),
  tool('discussion_finish', '无pending时记录主持结论、分歧、证据局限和停止依据，自动导出完整问答、分阶段计时及一致性清单。', object({ ...run,
    summary: string, stopReason: string, agreements: strings, disagreements: strings, openQuestions: strings, limitations: strings }, ['runFile', 'summary', 'stopReason'])),
  tool('discussion_verify', '验证已完成研究全部产物指纹；不打开网页或改写原记录。', object(run, ['runFile']), true),
  tool('discussion_artifact', '读取研究产物，按Unicode字符分页；nextOffset非null时继续读取，不将截取段当完整记录。', object({ ...run,
    artifact: { enum: ['report', 'transcript', 'timing', 'topics', 'evidence', 'manifest'] },
    offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 48000 } }, ['runFile', 'artifact']), true)
];

// Small validator for the JSON Schema subset in the closed, bundled tool
// catalog. Domain and path checks also run in the shared execution service.
export function validateArguments(value, schema, location = 'arguments') {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${location} 不是允许的选项。`);
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
  const matches = type => type === 'null' ? value === null : type === 'integer' ? Number.isInteger(value) :
    type === 'array' ? Array.isArray(value) : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : typeof value === type;
  if (types.length && !types.some(matches)) throw new Error(`${location} 类型无效。`);
  if (value === null) return;
  if (typeof value === 'number' && ((schema.minimum != null && value < schema.minimum) || (schema.maximum != null && value > schema.maximum))) throw new Error(`${location} 超出允许范围。`);
  if (typeof value === 'string' && ((schema.minLength != null && value.trim().length < schema.minLength) || (schema.maxLength != null && value.length > schema.maxLength))) throw new Error(`${location} 长度无效。`);
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) throw new Error(`${location} 列表不能为空。`);
    for (const item of value) validateArguments(item, schema.items, `${location}[]`);
  } else if (value && typeof value === 'object' && schema.properties) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${location}.${key} 必填。`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key) && schema.additionalProperties === false) throw new Error(`${location} 包含未定义字段。`);
      if (Object.hasOwn(schema.properties, key)) validateArguments(item, schema.properties[key], `${location}.${key}`);
    }
  }
}
