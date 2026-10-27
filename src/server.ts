/**
 * MCP tool definitions.
 *
 * Everything is read-only. The model can only reach queries that are listed
 * in the config file; it never builds URLs or SQL.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig, Stage } from './config.js';
import { SlateClient } from './slate-client.js';
import {
  AppRecord,
  Filters,
  addDays,
  applyFilters,
  breakdown,
  compareFunnels,
  conversions,
  countAsOf,
  distinctValues,
  normalize,
  paceSeries,
  priorTerm,
  shiftYears,
  suppress,
  toDay,
  todayIn,
} from './pipeline.js';

export const VERSION = '2.0.0';

export function createServer(cfg: AppConfig, client: SlateClient, timeZone = process.env.SLATE_TIMEZONE ?? 'America/Chicago') {
  const server = new McpServer(
    { name: 'slate-enrollment', version: VERSION },
    {
      instructions:
        'Read-only, real-time enrollment pipeline data from Greenville University\'s Slate instance. ' +
        'Start with describe_pipeline to learn the available terms, stages and dimensions. ' +
        'Counts are rebuilt from milestone dates, so any as_of date (including same-day-last-year) is supported. ' +
        'Data is aggregate only; there are no tools that return individual students.',
    },
  );

  const p = cfg.pipeline;
  const dims = Object.keys(p.dimensions);
  const stageKeys = p.stages.map((s) => s.key) as [string, ...string[]];
  const sup = (n: number) => suppress(n, cfg.suppressBelow);

  // ------------------------------------------------------------ data access

  async function loadTerm(term: string, fresh: boolean) {
    const params = p.termParam ? { [p.termParam]: term } : {};
    const res = await client.run(p.url, params, { fresh });
    const all = normalize(res.rows, p);
    const wanted = term.trim().toLowerCase();
    const records = all.filter((r) => r.term.toLowerCase() === wanted);
    if (!records.length) {
      const terms = [...new Set(all.map((r) => r.term))].filter(Boolean).sort();
      throw new Error(
        `No applications found for term "${term}".` + (terms.length ? ` Terms in the Slate query: ${terms.join(', ')}.` : ''),
      );
    }
    return { records, fetchedAt: res.fetchedAt, fromCache: res.fromCache };
  }

  function meta(fetchedAt: Date, fromCache: boolean) {
    return {
      source: `Slate live query (${new URL(cfg.baseUrl).host})`,
      pulledAt: fetchedAt.toISOString(),
      cached: fromCache,
      cacheSeconds: cfg.cacheSeconds,
      ...(cfg.suppressBelow > 0 ? { note: `Counts below ${cfg.suppressBelow} are suppressed.` } : {}),
    };
  }

  const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const fail = (err: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: (err as Error).message }] });

  function resolveAsOf(asOf?: string) {
    if (!asOf) return todayIn(timeZone);
    const d = toDay(asOf);
    if (!d) throw new Error(`as_of "${asOf}" is not a date. Use YYYY-MM-DD.`);
    return d;
  }

  function stageByKey(key: string): Stage {
    const s = p.stages.find((x) => x.key === key);
    if (!s) throw new Error(`Unknown stage "${key}". Stages: ${stageKeys.join(', ')}`);
    return s;
  }

  function formatFunnel(records: AppRecord[], asOf: string) {
    const f = countAsOf(records, p.stages, asOf);
    return {
      asOf,
      stages: f.stages.map((s) => ({ ...s, count: sup(s.count) })),
      ...(p.cancelColumn ? { cancelledOrWithdrawn: sup(f.cancelled) } : {}),
      conversion: cfg.suppressBelow > 0 ? undefined : conversions(f),
      _raw: f,
    };
  }

  // ------------------------------------------------------------ shared schemas

  const filterShape = Object.fromEntries(
    dims.map((d) => [d, z.union([z.string(), z.array(z.string())]).optional().describe(`Filter by ${d} (exact value, or list of values)`)]),
  );
  const filtersSchema = z.object(filterShape).strict().optional().describe('Optional dimension filters, e.g. {"student_type": "First-Year"}');
  const termSchema = z.string().describe('Entry term exactly as Slate labels it, e.g. "Fall 2026"');
  const asOfSchema = z.string().optional().describe('Count as of this date (YYYY-MM-DD). Defaults to today.');
  const freshSchema = z.boolean().optional().describe(`Bypass the ${cfg.cacheSeconds}s cache and re-query Slate now.`);
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  // ------------------------------------------------------------ tools

  server.registerTool(
    'describe_pipeline',
    {
      title: 'Describe enrollment pipeline',
      description:
        'List the funnel stages, the dimensions available for filters/breakdowns, the terms present in Slate and the most common values of each dimension. Call this first.',
      inputSchema: { term: termSchema.optional().describe('Needed only if the Slate query is filtered by a term parameter') },
      annotations: readOnly,
    },
    async ({ term }) => {
      try {
        if (p.termParam && !term) {
          return ok({
            stages: p.stages.map((s) => ({ key: s.key, label: s.label, net_of_cancels: s.netOfCancels })),
            dimensions: dims,
            note: 'This Slate query is filtered per term; pass a term (e.g. "Fall 2026") to see dimension values.',
          });
        }
        const params = p.termParam && term ? { [p.termParam]: term } : {};
        const res = await client.run(p.url, params);
        const all = normalize(res.rows, p);
        const terms = [...new Set(all.map((r) => r.term))].filter(Boolean);
        return ok({
          stages: p.stages.map((s) => ({ key: s.key, label: s.label, net_of_cancels: s.netOfCancels })),
          dimensions: Object.fromEntries(dims.map((d) => [d, distinctValues(all, d, 25)])),
          terms: terms.map((t) => ({ term: t, applications: sup(all.filter((r) => r.term === t).length) })),
          today: todayIn(timeZone),
          registeredQueries: Object.keys(cfg.queries),
          ...meta(res.fetchedAt, res.fromCache),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'enrollment_snapshot',
    {
      title: 'Enrollment funnel snapshot',
      description:
        'Funnel counts for one entry term as of a date (default today): every stage plus stage-to-stage conversion. Use filters to narrow to a student type, program, state, etc.',
      inputSchema: { term: termSchema, as_of: asOfSchema, filters: filtersSchema, fresh: freshSchema },
      annotations: readOnly,
    },
    async ({ term, as_of, filters, fresh }) => {
      try {
        const asOf = resolveAsOf(as_of);
        const data = await loadTerm(term, !!fresh);
        const recs = applyFilters(data.records, (filters ?? {}) as Filters, dims);
        const { _raw, ...funnel } = formatFunnel(recs, asOf);
        return ok({ term, filters: filters ?? {}, ...funnel, ...meta(data.fetchedAt, data.fromCache) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'enrollment_compare',
    {
      title: 'Year-over-year funnel comparison',
      description:
        'Compare a term against a prior term on the same calendar day (default: same term last year, as of one year before as_of). Returns counts, change and % change per stage.',
      inputSchema: {
        term: termSchema,
        compare_term: z.string().optional().describe('Term to compare against. Defaults to the same season one year earlier.'),
        as_of: asOfSchema,
        compare_as_of: z.string().optional().describe('As-of date for the comparison term. Defaults to as_of minus one year.'),
        filters: filtersSchema,
        fresh: freshSchema,
      },
      annotations: readOnly,
    },
    async ({ term, compare_term, as_of, compare_as_of, filters, fresh }) => {
      try {
        const asOf = resolveAsOf(as_of);
        const cmpTerm = compare_term ?? priorTerm(term);
        const cmpAsOf = compare_as_of ? resolveAsOf(compare_as_of) : shiftYears(asOf, -1);
        const [cur, prev] = await Promise.all([loadTerm(term, !!fresh), loadTerm(cmpTerm, !!fresh)]);
        const f = (filters ?? {}) as Filters;
        const a = countAsOf(applyFilters(cur.records, f, dims), p.stages, asOf);
        const b = countAsOf(applyFilters(prev.records, f, dims), p.stages, cmpAsOf);
        const rows = compareFunnels(a, b).map((r) => ({
          ...r,
          current: sup(r.current),
          prior: sup(r.prior),
          change: cfg.suppressBelow > 0 && (r.current < cfg.suppressBelow || r.prior < cfg.suppressBelow) ? null : r.change,
          pctChange: cfg.suppressBelow > 0 && (r.current < cfg.suppressBelow || r.prior < cfg.suppressBelow) ? null : r.pctChange,
        }));
        return ok({
          current: { term, asOf },
          comparison: { term: cmpTerm, asOf: cmpAsOf },
          filters: filters ?? {},
          stages: rows,
          ...meta(cur.fetchedAt, cur.fromCache && prev.fromCache),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'enrollment_breakdown',
    {
      title: 'Funnel breakdown by dimension',
      description:
        'Funnel counts for a term split by one dimension (e.g. program, student_type, state). Rows are sorted by the deepest stage. Optionally include the same breakdown for the prior year on the same day.',
      inputSchema: {
        term: termSchema,
        dimension: (dims.length ? z.enum(dims as [string, ...string[]]) : z.string()).describe('Dimension to group by'),
        as_of: asOfSchema,
        filters: filtersSchema,
        top: z.number().int().min(1).max(200).optional().describe('Show the top N values and roll the rest into "other" (default 25)'),
        include_prior_year: z.boolean().optional().describe('Also return the prior-year term on the same day for each value'),
        fresh: freshSchema,
      },
      annotations: readOnly,
    },
    async ({ term, dimension, as_of, filters, top, include_prior_year, fresh }) => {
      try {
        if (!dims.includes(dimension)) throw new Error(`Unknown dimension "${dimension}". Available: ${dims.join(', ')}`);
        const asOf = resolveAsOf(as_of);
        const f = (filters ?? {}) as Filters;
        const data = await loadTerm(term, !!fresh);
        const rows = breakdown(applyFilters(data.records, f, dims), p.stages, dimension, asOf, top ?? 25);

        let priorIndex: Map<string, Record<string, number>> | undefined;
        let prior: { term: string; asOf: string } | undefined;
        if (include_prior_year) {
          prior = { term: priorTerm(term), asOf: shiftYears(asOf, -1) };
          const prev = await loadTerm(prior.term, !!fresh);
          const prevRows = breakdown(applyFilters(prev.records, f, dims), p.stages, dimension, prior.asOf, 10_000);
          priorIndex = new Map(prevRows.map((r) => [r.value, r.counts]));
        }

        return ok({
          term,
          asOf,
          dimension,
          filters: filters ?? {},
          ...(prior ? { priorYear: prior } : {}),
          stages: p.stages.map((s) => s.key),
          rows: rows.map((r) => ({
            [dimension]: r.value,
            ...Object.fromEntries(Object.entries(r.counts).map(([k, v]) => [k, sup(v)])),
            ...(priorIndex
              ? {
                  prior_year: Object.fromEntries(
                    p.stages.map((s) => [s.key, sup(priorIndex!.get(r.value)?.[s.key] ?? 0)]),
                  ),
                }
              : {}),
          })),
          ...meta(data.fetchedAt, data.fromCache),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'enrollment_pace',
    {
      title: 'Cumulative pace curve',
      description:
        'Cumulative count for one stage over time (daily or weekly), with the prior-year term on the same calendar days for a pace-vs-last-year chart.',
      inputSchema: {
        term: termSchema,
        stage: z.enum(stageKeys).describe('Stage to track, e.g. "deposited"'),
        start: z.string().optional().describe('First date (YYYY-MM-DD). Defaults to 180 days before end.'),
        end: z.string().optional().describe('Last date (YYYY-MM-DD). Defaults to today.'),
        interval: z.enum(['day', 'week']).optional().describe('Point spacing (default week)'),
        compare_term: z.string().optional().describe('Comparison term (default: same term last year). Use "none" to skip.'),
        filters: filtersSchema,
        fresh: freshSchema,
      },
      annotations: readOnly,
    },
    async ({ term, stage, start, end, interval, compare_term, filters, fresh }) => {
      try {
        const st = stageByKey(stage);
        const endDay = resolveAsOf(end);
        const startDay = start ? resolveAsOf(start) : addDays(endDay, -180);
        if (startDay > endDay) throw new Error('start must be on or before end.');
        const step = (interval ?? 'week') === 'day' ? 1 : 7;
        if (step === 1 && addDays(startDay, 400) < endDay) throw new Error('Daily series are limited to 400 days; use interval "week".');
        const f = (filters ?? {}) as Filters;

        const cur = await loadTerm(term, !!fresh);
        const curSeries = paceSeries(applyFilters(cur.records, f, dims), st, startDay, endDay, step);

        let prior: { term: string; points: { date: string; count: number }[] } | undefined;
        if (compare_term !== 'none') {
          const cmpTerm = compare_term ?? priorTerm(term);
          const prev = await loadTerm(cmpTerm, !!fresh);
          prior = {
            term: cmpTerm,
            points: paceSeries(applyFilters(prev.records, f, dims), st, shiftYears(startDay, -1), shiftYears(endDay, -1), step),
          };
        }

        return ok({
          term,
          stage: { key: st.key, label: st.label, netOfCancels: st.netOfCancels },
          interval: step === 1 ? 'day' : 'week',
          filters: filters ?? {},
          series: curSeries.map((pt, i) => ({
            date: pt.date,
            [term]: sup(pt.count),
            ...(prior ? { [`${prior.term} (same day)`]: sup(prior.points[i]?.count ?? 0) } : {}),
          })),
          ...meta(cur.fetchedAt, cur.fromCache),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ------------------------------------------------------------ registered queries

  const queryNames = Object.keys(cfg.queries);
  if (queryNames.length) {
    server.registerTool(
      'list_slate_queries',
      {
        title: 'List additional Slate queries',
        description: 'List the extra Slate web-service queries this server is allowed to run, with their parameters.',
        inputSchema: {},
        annotations: readOnly,
      },
      async () =>
        ok(
          Object.entries(cfg.queries).map(([name, q]) => ({
            name,
            description: q.description,
            params: q.params,
          })),
        ),
    );

    server.registerTool(
      'run_slate_query',
      {
        title: 'Run an approved Slate query',
        description:
          'Run one of the pre-approved Slate queries (see list_slate_queries) and return its rows. Only queries listed in the server config can be run.',
        inputSchema: {
          name: z.enum(queryNames as [string, ...string[]]),
          params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Values for the query parameters'),
          fresh: freshSchema,
        },
        annotations: readOnly,
      },
      async ({ name, params, fresh }) => {
        try {
          const q = cfg.queries[name];
          const given = params ?? {};
          for (const k of Object.keys(given)) {
            if (!(k in q.params)) throw new Error(`Query "${name}" has no parameter "${k}". Parameters: ${Object.keys(q.params).join(', ') || 'none'}.`);
          }
          const cleaned: Record<string, string | number | boolean> = {};
          for (const [k, def] of Object.entries(q.params)) {
            const v = given[k];
            if (v === undefined) {
              if (def.required) throw new Error(`Parameter "${k}" is required.`);
              continue;
            }
            if (def.type === 'date' || def.type === 'datetime') {
              const d = toDay(v);
              if (!d) throw new Error(`Parameter "${k}" must be a date (YYYY-MM-DD).`);
              cleaned[k] = d;
            } else if (def.type === 'int' && !Number.isInteger(Number(v))) {
              throw new Error(`Parameter "${k}" must be an integer.`);
            } else {
              cleaned[k] = v;
            }
          }
          const res = await client.run(q.url, cleaned, { fresh: !!fresh });
          const drop = new Set(q.dropColumns);
          const rows = res.rows.slice(0, q.maxRows).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.has(k))));
          return ok({
            query: name,
            params: cleaned,
            rowCount: res.rows.length,
            ...(res.rows.length > q.maxRows ? { truncatedTo: q.maxRows } : {}),
            rows,
            ...meta(res.fetchedAt, res.fromCache),
          });
        } catch (e) {
          return fail(e);
        }
      },
    );
  }

  return server;
}
