export class DiscussionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DiscussionError';
  }
}

export function errorResult(error: unknown) {
  if (error instanceof DiscussionError) {
    return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  return { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
}
