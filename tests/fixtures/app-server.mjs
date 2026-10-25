import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

let initialized = false;
let notified = false;
const waiting = new Map();
const requests = [];
const stateFile = process.argv.find(arg => arg.startsWith('--state-file='))?.slice('--state-file='.length);
const threads = stateFile && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const save = () => { if (stateFile) writeFileSync(stateFile, JSON.stringify(threads)); };
const notify = (method, params) => send({ method, params });
const alpha = { id: 'picker-alpha', model: 'alpha', displayName: 'Alpha', description: 'Everyday coding', hidden: false, isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Faster' }, { reasoningEffort: 'high', description: 'Deeper' }] };
const beta = { id: 'picker-beta', model: 'beta', displayName: 'Beta', description: 'Harder coding', hidden: false, isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }, { reasoningEffort: 'new-future-effort', description: 'Future option' }] };
function complete(thread, turn, status = 'completed', text = 'Codex answer') {
  const item = { id: `assistant-${turn.id}`, type: 'agentMessage', text, phase: 'final_answer' };
  turn.items.push(item);
  turn.status = status;
  turn.error = status === 'failed' ? { message: 'Fixture inference failed', codexErrorInfo: 'other', additionalDetails: null } : null;
  thread.status = { type: 'idle' };
  notify('item/completed', { threadId: thread.id, turnId: turn.id, item });
  notify('turn/completed', { threadId: thread.id, turn });
  save();
}
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (id, result) => send({ id, result });

createInterface({ input: process.stdin }).on('line', async line => {
  const message = JSON.parse(line);
  if (!message.method) {
    const original = waiting.get(message.id);
    if (original !== undefined) {
      waiting.delete(message.id);
      reply(original, message.result ?? message.error);
    }
    return;
  }
  const { id, method, params = {} } = message;
  requests.push({ method, params });
  if (method === 'initialize') {
    setTimeout(() => { initialized = true; reply(id, { userAgent: 'fixture' }); }, 5);
  } else if (method === 'initialized') {
    notified = initialized;
  } else if (!initialized || !notified) {
    send({ id, error: { code: -32000, message: 'Not initialized' } });
  } else if (method === 'test/echo') {
    setTimeout(() => reply(id, params), params.delay ?? 0);
  } else if (method === 'test/split') {
    const bytes = Buffer.from(JSON.stringify({ id, result: { text: '한글🙂' } }) + '\n');
    const split = bytes.indexOf(Buffer.from('한')) + 1;
    process.stdout.write(bytes.subarray(0, split));
    setTimeout(() => process.stdout.write(bytes.subarray(split)), 5);
  } else if (method === 'test/exit') {
    process.exit(2);
  } else if (method === 'test/invalid') {
    process.stdout.write('not JSON\n');
  } else if (method === 'test/oversized') {
    process.stdout.write('x'.repeat(8192));
  } else if (method === 'test/hang') {
    // Intentionally unanswered to exercise deadlines.
  } else if (method === 'test/serverRequest') {
    waiting.set('server-request', id);
    send({ id: 'server-request', method: params.method, params: { threadId: 'thread-1', turnId: 'turn-1' } });
  } else if (method === 'test/notify') {
    send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'hello' } });
    reply(id, {});
  } else if (method === 'test/requests') {
    reply(id, requests);
  } else if (method === 'model/list') {
    reply(id, { data: params.cursor ? [beta] : [alpha], nextCursor: params.cursor ? null : 'page-2' });
  } else if (method === 'thread/start') {
    const threadId = `thread-${Object.keys(threads).length + 1}`;
    const thread = { id: threadId, cwd: params.cwd, model: params.model, reasoningEffort: null, modelProvider: 'fixture', status: { type: 'idle' }, turns: [] };
    threads[threadId] = thread;
    save();
    reply(id, { thread: { ...thread, turns: [] }, model: thread.model, reasoningEffort: thread.reasoningEffort, cwd: thread.cwd });
  } else if (method === 'thread/read' || method === 'thread/resume') {
    const thread = threads[params.threadId];
    if (!thread) { send({ id, error: { code: -32001, message: 'Thread not found' } }); return; }
    reply(id, { thread: { ...thread, turns: [] }, model: thread.model, reasoningEffort: thread.reasoningEffort, cwd: thread.cwd });
  } else if (method === 'turn/start') {
    const thread = threads[params.threadId];
    const text = params.input[0].text;
    const turn = { id: `turn-${thread.turns.length + 1}`, status: 'inProgress', error: null, items: [{ id: `user-${thread.turns.length + 1}`, type: 'userMessage', content: params.input }] };
    thread.turns.push(turn);
    thread.model = params.model;
    thread.reasoningEffort = params.effort;
    thread.status = { type: 'active', activeFlags: [] };
    notify('turn/started', { threadId: thread.id, turn: { ...turn, items: [] } });
    if (text.startsWith('early')) complete(thread, turn);
    reply(id, { turn: { id: turn.id, status: 'inProgress', items: [] } });
    if (text.startsWith('auto')) setTimeout(() => complete(thread, turn), 25);
    if (text.startsWith('fail')) setTimeout(() => complete(thread, turn, 'failed'), 10);
    if (text.startsWith('partial')) setTimeout(() => {
      notify('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: `assistant-${turn.id}`, delta: 'partial answer' });
    }, 10);
    save();
  } else if (method === 'test/complete') {
    const thread = threads[params.threadId];
    complete(thread, thread.turns.at(-1), params.status, params.text);
    reply(id, {});
  } else if (method === 'test/event') {
    notify(params.method, params.params);
    reply(id, {});
  } else if (method === 'turn/interrupt') {
    const thread = threads[params.threadId];
    const turn = thread.turns.find(turn => turn.id === params.turnId);
    if (turn && turn.status === 'inProgress') complete(thread, turn, 'interrupted', 'Interrupted');
    reply(id, {});
  } else if (method === 'thread/turns/list') {
    const thread = threads[params.threadId];
    const start = Number(params.cursor ?? 0);
    const turns = thread.turns.toReversed();
    const data = turns.slice(start, start + (params.limit ?? 100)).map(turn => ({ ...turn, items: [] }));
    reply(id, { data, nextCursor: start + data.length < turns.length ? String(start + data.length) : null });
  } else if (method === 'thread/items/list') {
    const thread = threads[params.threadId];
    const turn = thread.turns.find(turn => turn.id === params.turnId);
    const entries = [...(turn?.items ?? []), { id: 'secret', type: 'reasoning', content: ['private reasoning'], summary: ['private'] }].map(item => ({ turnId: params.turnId, item }));
    const start = Number(params.cursor ?? 0);
    const data = entries.slice(start, start + (params.limit ?? 50));
    reply(id, { data, nextCursor: start + data.length < entries.length ? String(start + data.length) : null });
  } else if (method === 'config/read') {
    reply(id, { config: { mcp_servers: { 'discussion.recursive': { command: 'recursive' }, other: { command: 'other' } } }, origins: {} });
  } else {
    send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));
