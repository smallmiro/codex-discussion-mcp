import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const infer = process.argv.includes('--inference');
const project = await mkdtemp(join(tmpdir(), 'codex-discussion-smoke-'));
const newClient = () => new Client({ name: 'codex-discussion-live-smoke', version: '1.0.0' }, { capabilities: {} });
let client = newClient();
const newTransport = () => new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/index.js', import.meta.url)), '--cwd', project],
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
  stderr: 'pipe',
});
let active;
try {
  const transport = newTransport();
  transport.stderr?.on('data', chunk => process.stderr.write(chunk));
  await client.connect(transport);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.structuredContent));
    return result.structuredContent;
  };
  const listed = await call('models_list', {});
  assert.ok(listed.models.length > 0);
  console.log(JSON.stringify({ step: 'models', count: listed.models.length, models: listed.models.map(model => ({ model: model.model, defaultEffort: model.defaultReasoningEffort, efforts: model.supportedReasoningEfforts.map(option => option.reasoningEffort) })), inferenceRun: infer }));
  if (infer) {
    const model = listed.models.find(model => model.isDefault) ?? listed.models[0];
    const effort = model.supportedReasoningEfforts.find(option => option.reasoningEffort === 'low')?.reasoningEffort ?? model.defaultReasoningEffort;
    const wait = async ids => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const read = await call('discussion_read', { discussionId: ids.discussionId, turnId: ids.turnId, waitMs: 1000 });
        if (read.status !== 'inProgress') {
          assert.equal(read.status, 'completed', JSON.stringify(read));
          assert.ok(read.messages.some(message => message.role === 'assistant' && message.text.trim()));
          console.log(JSON.stringify({ step: 'turn-completed', discussionId: read.discussionId, turnId: read.turnId, model: read.model, effort: read.effort, messages: read.messages.filter(message => message.role === 'assistant') }));
          return read;
        }
      }
      throw new Error('Live inference exceeded 180 seconds.');
    };
    active = await call('discussion_start', { message: '짧은 연결 테스트입니다. 도구나 파일을 사용하지 말고 정확히 MCP 연결 확인 이라고만 답하세요.', model: model.model, effort, cwd: project });
    console.log(JSON.stringify({ step: 'turn-started', ...active }));
    await wait(active);
    const nextModel = listed.models.find(candidate => candidate.model !== model.model && /fast|affordable|efficient/i.test(candidate.description)) ?? model;
    active = await call('discussion_reply', {
      discussionId: active.discussionId,
      message: '이 대화의 직전 답변을 그대로 한 번 더 적어주세요. 도구나 파일을 사용하지 마세요.',
      model: nextModel.model, effort: nextModel.defaultReasoningEffort,
    });
    await wait(active);
    await client.close();
    client = newClient();
    const resumedTransport = newTransport();
    resumedTransport.stderr?.on('data', chunk => process.stderr.write(chunk));
    await client.connect(resumedTransport);
    const history = await call('discussion_read', { discussionId: active.discussionId, turnId: active.turnId });
    assert.equal(history.status, 'completed');
    assert.ok(history.messages.some(message => message.role === 'assistant' && message.text.trim()));
    assert.equal(history.threadDefaults.model, nextModel.model);
    console.log(JSON.stringify({ step: 'history-resumed', discussionId: history.discussionId, turnId: history.turnId, threadDefaults: history.threadDefaults }));
  }
} finally {
  if (active) {
    try { await client.callTool({ name: 'discussion_cancel', arguments: { discussionId: active.discussionId, turnId: active.turnId } }); } catch { /* Connection may already be lost. */ }
  }
  await client.close();
  await rm(project, { recursive: true, force: true });
}
