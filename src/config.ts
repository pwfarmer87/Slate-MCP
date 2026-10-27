/**
 * Configuration loading.
 *
 * Non-secret settings (which Slate queries to call, how their columns map to
 * funnel stages and dashboard dimensions) live in a JSON config file.
 * Secrets (the Slate service-account username/password) come only from
 * environment variables.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const StageSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'stage keys must be snake_case'),
  label: z.string(),
  /** Column holding the date the record reached this stage. Empty/null = not reached. */
  column: z.string(),
  /** If true, records that later hit the cancel column are subtracted (net counts). */
  netOfCancels: z.boolean().default(false),
});

const ParamSchema = z.object({
  type: z.enum(['varchar', 'int', 'real', 'date', 'datetime', 'bit', 'uniqueidentifier']).default('varchar'),
  description: z.string().default(''),
  required: z.boolean().default(false),
});

const RegisteredQuerySchema = z.object({
  description: z.string(),
  /** Full web-service URL copied from Slate (includes id=, cmd=service, output=json, h=). */
  url: z.string(),
  params: z.record(z.string(), ParamSchema).default({}),
  maxRows: z.number().int().positive().default(500),
  /** Columns that are never returned to the model even if the query exports them. */
  dropColumns: z.array(z.string()).default([]),
});

const ConfigSchema = z.object({
  baseUrl: z.string().url(),
  cacheSeconds: z.number().int().min(0).default(60),
  requestTimeoutSeconds: z.number().int().positive().default(60),
  /** Small-cell suppression: counts between 1 and this value are reported as "<N". 0 = off. */
  suppressBelow: z.number().int().min(0).default(0),
  pipeline: z.object({
    url: z.string(),
    /** Name of the @parameter the Slate query uses to filter by term. Null = query returns all terms. */
    termParam: z.string().nullable().default('term'),
    columns: z.object({
      term: z.string().default('term'),
    }).default({ term: 'term' }),
    /** dashboard dimension name -> query column */
    dimensions: z.record(z.string(), z.string()).default({}),
    stages: z.array(StageSchema).min(1),
    /** Column holding the cancel / withdraw / melt date. Optional. */
    cancelColumn: z.string().nullable().default(null),
  }),
  queries: z.record(z.string(), RegisteredQuerySchema).default({}),
});

export type Stage = z.infer<typeof StageSchema>;
export type RegisteredQuery = z.infer<typeof RegisteredQuerySchema>;
export type AppConfig = z.infer<typeof ConfigSchema> & {
  username: string;
  password: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const path = resolve(env.SLATE_CONFIG ?? 'config/slate.config.json');
  if (!existsSync(path)) {
    throw new Error(
      `Slate config not found at ${path}. Copy config/slate.config.example.json to ` +
        `config/slate.config.json (or set SLATE_CONFIG) and fill in your query URLs.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${path}: ${(err as Error).message}`);
  }

  // Allow the pipeline URL to come from the environment so the config file can be committed.
  if (env.SLATE_PIPELINE_URL && raw && typeof raw === 'object') {
    const r = raw as { pipeline?: Record<string, unknown> };
    r.pipeline = { ...(r.pipeline ?? {}), url: env.SLATE_PIPELINE_URL };
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid Slate config in ${path}:\n${issues}`);
  }

  const username = env.SLATE_USERNAME ?? '';
  const password = env.SLATE_PASSWORD ?? '';
  if (!username || !password) {
    throw new Error(
      'SLATE_USERNAME and SLATE_PASSWORD are required (the Slate user granted Web Service access to your queries).',
    );
  }

  const cfg = { ...parsed.data, baseUrl: parsed.data.baseUrl.replace(/\/+$/, ''), username, password };

  const stageKeys = new Set<string>();
  for (const s of cfg.pipeline.stages) {
    if (stageKeys.has(s.key)) throw new Error(`Duplicate stage key "${s.key}" in pipeline.stages`);
    stageKeys.add(s.key);
  }
  return cfg;
}
