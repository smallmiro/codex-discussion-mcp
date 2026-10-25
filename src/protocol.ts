export interface Notification {
  method: string;
  params: Record<string, unknown>;
}

export interface RpcClient {
  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
  onNotification(listener: (message: Notification) => void): () => void;
  onDisconnect(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}

export interface Selection {
  model: string;
  effort: string;
}

export type TurnStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted' | 'connectionLost';

export interface PublicMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant' | 'progress';
  text: string;
  complete: boolean;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
