import * as z from 'zod/v4';
import { DiscussionError } from './errors.js';
import type { RpcClient, Selection } from './protocol.js';

const modelSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string(),
  description: z.string().default(''),
  hidden: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  defaultReasoningEffort: z.string().min(1),
  supportedReasoningEfforts: z.array(z.object({
    reasoningEffort: z.string().min(1), description: z.string().default(''),
  })).min(1),
  inputModalities: z.array(z.string()).optional(),
});
const pageSchema = z.object({ data: z.array(modelSchema), nextCursor: z.string().nullish() });
export type Model = z.infer<typeof modelSchema>;
export interface CatalogResult {
  models: Model[];
  retrievedAt: string;
  accessVerified: false;
}

export class ModelCatalog {
  private cache = new Map<boolean, { result: CatalogResult; expires: number }>();

  constructor(private readonly rpc: Pick<RpcClient, 'request'>) {}

  /** An explicit listing always fetches current catalog metadata; it never invokes inference. */
  async list(includeHidden = false): Promise<CatalogResult> {
    const models: Model[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const raw = await this.rpc.request('model/list', { limit: 100, includeHidden, ...(cursor ? { cursor } : {}) });
      const parsed = pageSchema.safeParse(raw);
      if (!parsed.success) throw new DiscussionError('PROTOCOL_ERROR', 'Codex returned an invalid model catalog or effort definition.');
      for (const model of parsed.data.data) {
        if (!model.supportedReasoningEfforts.some(option => option.reasoningEffort === model.defaultReasoningEffort)) {
          throw new DiscussionError('PROTOCOL_ERROR', `Default effort for ${model.model} is absent from its supported effort list.`);
        }
        if (includeHidden || !model.hidden) models.push(model);
      }
      cursor = parsed.data.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new DiscussionError('PROTOCOL_ERROR', 'Repeated model pagination cursor.');
      if (cursor) seen.add(cursor);
      if (seen.size > 1000 || models.length > 10_000) throw new DiscussionError('PROTOCOL_ERROR', 'Model catalog pagination exceeded the limit.');
    } while (cursor);
    const result: CatalogResult = { models, retrievedAt: new Date().toISOString(), accessVerified: false };
    this.cache.set(includeHidden, { result, expires: Date.now() + 30_000 });
    return result;
  }

  async select(input: Partial<Selection>, previous?: Partial<Selection>): Promise<Selection> {
    let models = this.cached()?.models ?? (await this.list()).models;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const requested = input.model ?? previous?.model;
        const defaults = models.filter(model => model.isDefault && !model.hidden);
        if (!requested && defaults.length !== 1) {
          throw new DiscussionError('MODEL_REQUIRED', 'No unambiguous default model. Call models_list and select an explicit model.');
        }
        const model = requested ? models.find(model => model.model === requested) : defaults[0];
        if (!model) {
          throw new DiscussionError('INVALID_MODEL', `Unknown model ${requested}. Call models_list; choose from: ${models.map(model => model.model).join(', ')}.`, { allowedModels: models.map(model => model.model) });
        }
        const changedModel = previous?.model !== undefined && model.model !== previous.model;
        const effort = input.effort ?? (changedModel ? undefined : previous?.effort) ?? model.defaultReasoningEffort;
        const allowedEfforts = model.supportedReasoningEfforts.map(option => option.reasoningEffort);
        if (!allowedEfforts.includes(effort)) {
          throw new DiscussionError('INVALID_EFFORT', `Effort ${effort} is not supported by ${model.model}. Allowed efforts: ${allowedEfforts.join(', ')}.`, { model: model.model, allowedEfforts });
        }
        return { model: model.model, effort };
      } catch (error) {
        if (attempt || !(error instanceof DiscussionError) || !['INVALID_MODEL', 'INVALID_EFFORT'].includes(error.code)) throw error;
        models = (await this.list(true)).models;
      }
    }
    throw new DiscussionError('INVALID_MODEL', 'Unable to resolve model selection.');
  }

  private cached() {
    for (const includeHidden of [true, false]) {
      const cache = this.cache.get(includeHidden);
      if (cache && cache.expires > Date.now()) return cache.result;
    }
    return undefined;
  }
}
