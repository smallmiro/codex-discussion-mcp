import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { DiscussionError } from './errors.js';
import { record, type PublicMessage } from './protocol.js';

export function publicItem(value: unknown, turnId: string, complete = true): PublicMessage | undefined {
  const item = record(value);
  if (typeof item.id !== 'string') return;
  const base = { id: item.id, turnId, complete };
  if (item.type === 'agentMessage' && typeof item.text === 'string') {
    return { ...base, role: 'assistant', text: item.text };
  }
  if (item.type === 'userMessage' && Array.isArray(item.content)) {
    const text = item.content.map(record).filter(input => input.type === 'text' && typeof input.text === 'string').map(input => input.text).join('\n');
    return { ...base, role: 'user', text };
  }
  if (item.type === 'plan' && typeof item.text === 'string') return { ...base, role: 'progress', text: item.text };
  if (['commandExecution', 'webSearch', 'fileChange', 'mcpToolCall'].includes(String(item.type))) {
    return { ...base, role: 'progress', text: `${item.type}: ${String(item.status ?? (complete ? 'completed' : 'inProgress'))}` };
  }
  // Reasoning and unknown item types are intentionally not projected into public results.
}

const cursorSchema = z.object({
  instance: z.string(), discussionId: z.string(), turnId: z.string(),
  kind: z.enum(['live', 'history']),
  sourceCursor: z.string().optional(),
  offset: z.number().int().min(0), textOffset: z.number().int().min(0),
});
export type ReadCursor = z.infer<typeof cursorSchema>;

export class Cursors {
  private readonly instance = randomUUID();

  encode(cursor: Omit<ReadCursor, 'instance'>): string {
    return Buffer.from(JSON.stringify({ ...cursor, instance: this.instance })).toString('base64url');
  }

  decode(raw: string | undefined, discussionId: string, turnId?: string): ReadCursor | undefined {
    if (!raw) return;
    try {
      if (raw.length > 16_384) throw new Error('too long');
      const cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
      if (cursor.instance !== this.instance || cursor.discussionId !== discussionId || (turnId && cursor.turnId !== turnId)) throw new Error('wrong context');
      return cursor;
    } catch {
      throw new DiscussionError('INVALID_CURSOR', 'Invalid or expired cursor. Retry without a cursor for this discussion and turn.');
    }
  }

  page(messages: PublicMessage[], cursor: Omit<ReadCursor, 'instance'>, limit: number, nextSourceCursor?: string | null) {
    let { offset, textOffset } = cursor;
    if (offset > messages.length || (messages[offset] && textOffset > messages[offset]!.text.length)) {
      throw new DiscussionError('INVALID_CURSOR', 'Cursor is outside the available message page. Retry without a cursor.');
    }
    const page: Array<PublicMessage & { textOffset: number }> = [];
    let characters = 0;
    while (offset < messages.length && page.length < limit && characters < 64_000) {
      const item = messages[offset]!;
      const text = item.text.slice(textOffset, textOffset + Math.min(8000, 64_000 - characters));
      page.push({ ...item, text, textOffset });
      characters += text.length;
      textOffset += text.length;
      if (textOffset >= item.text.length) { offset++; textOffset = 0; }
    }
    const nextCursor = offset < messages.length
      ? this.encode({ ...cursor, offset, textOffset })
      : nextSourceCursor
        ? this.encode({ ...cursor, sourceCursor: nextSourceCursor, offset: 0, textOffset: 0 })
        : null;
    return { messages: page, nextCursor };
  }
}
