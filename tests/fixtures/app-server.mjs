import { createInterface } from 'node:readline';

let initialized = false;
let notified = false;
const waiting = new Map();
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
  } else if (method === 'config/read') {
    reply(id, { config: { mcp_servers: { 'discussion.recursive': { command: 'recursive' }, other: { command: 'other' } } }, origins: {} });
  } else {
    send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));
