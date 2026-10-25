import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DiscussionService } from './discussions.js';
import { errorResult } from './errors.js';
import { ModelCatalog } from './models.js';
import { version } from './version.js';

const identifier = z.string().min(1).max(256);
const message = z.string().min(1).max(1_000_000).refine(value => !!value.trim(), 'message cannot be blank');
const selection = {
  model: z.string().min(1).max(256).optional().describe('Exact model value returned by models_list. Choose based on the question complexity and model description.'),
  effort: z.string().min(1).max(100).optional().describe('One of the selected model supportedReasoningEfforts. Reasoning efforts differ between models.'),
};

async function safe(action: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const structuredContent = await action() as Record<string, unknown>;
    return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
  } catch (error) {
    const structuredContent = { error: errorResult(error) };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
  }
}

export function createServer(service: DiscussionService, catalog: ModelCatalog) {
  const server = new McpServer({ name: 'codex-discussion', version }, {
    instructions: 'Discuss with Codex as an independent coding partner. First call models_list to discover models and supported effort levels. Choose model and effort based on complexity. discussion_start/reply return immediately; call discussion_read repeatedly until a terminal status. Supply all context Codex needs; your own conversation is not shared automatically. Use an absolute cwd for the project. Codex discussions are read-only.',
  });
  server.registerTool('models_list', {
    title: 'Discover Codex models and effort levels',
    description: 'Call first to fetch the current Codex model catalog with descriptions, default model, default effort and supported effort descriptions. No inference is run. Catalog entries do not guarantee account/provider inference access.',
    inputSchema: z.object({ includeHidden: z.boolean().optional().describe('Include models hidden from the default picker.') }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }, input => safe(() => catalog.list(input.includeHidden)));

  server.registerTool('discussion_start', {
    title: 'Start a discussion with Codex',
    description: 'Start an independent read-only Codex conversation. Call models_list first, then select model and effort for the question complexity. Supply the question, relevant context and optional absolute project cwd. Returns discussionId and turnId immediately; read output using discussion_read.',
    inputSchema: z.object({ message, cwd: z.string().min(1).max(4096).optional().describe('Absolute project directory. Defaults to --cwd or the MCP process working directory.'), ...selection }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, input => safe(() => service.start(input)));

  server.registerTool('discussion_reply', {
    title: 'Continue a Codex discussion',
    description: 'Send a follow-up, objection or additional evidence to an existing discussion. Finish or cancel the active turn first. Model and effort can change on each reply. Omitted choices inherit; changing model without effort uses the new model default. Returns immediately; use discussion_read.',
    inputSchema: z.object({ discussionId: identifier, message, ...selection }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, input => safe(() => service.reply(input)));

  server.registerTool('discussion_read', {
    title: 'Read Codex output or wait for progress',
    description: 'Read the latest or specified turn. Poll with waitMs up to 20000 until completed, failed, interrupted or connectionLost; new output can return before completion. Follow nextCursor for more message chunks. During generation, read again without a cursor for updated text. Persisted historical per-turn model/effort may be unavailable; threadDefaults are reported separately.',
    inputSchema: z.object({
      discussionId: identifier, turnId: identifier.optional(), cursor: z.string().min(1).max(16_384).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      waitMs: z.number().int().min(0).max(20_000).optional(),
    }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, (input, context) => safe(() => service.read(input, context.mcpReq.signal)));

  server.registerTool('discussion_cancel', {
    title: 'Interrupt a Codex turn',
    description: 'Request interruption of exactly the specified turn. An accepted cancellation request is distinct from the final interrupted status; confirm with discussion_read. Completed older turns are returned without interrupting newer work.',
    inputSchema: z.object({ discussionId: identifier, turnId: identifier }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, input => safe(() => service.cancel(input)));
  return server;
}
