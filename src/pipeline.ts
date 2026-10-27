/**
 * Enrollment pipeline analytics.
 *
 * The Slate "pipeline" query returns one row per application with milestone
 * dates (submitted, admitted, deposited, ...) and a few grouping columns
 * (student type, program, state, ...). No names, emails or IDs are needed.
 *
 * Because every milestone carries a date, any "as of" view can be rebuilt
 * from a single pull: counts as of today, as of the same day last year,
 * daily/weekly pace curves, and breakdowns by any dimension.
 */

import type { AppConfig, Stage } from './config.js';
import type { SlateRow } from './slate-client.js';

export interface AppRecord {
  term: string;
  dims: Record<string, string>;
  stageDates: Record<string, string | null>;
  cancelDate: string | null;
}

export type Filters = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------- dates

/** Normalize Slate date/datetime values to YYYY-MM-DD. Returns null for blanks or unparseable values. */
export function toDay(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function todayIn(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function shiftYears(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = y + years;
  const lastDay = new Date(Date.UTC(target, m, 0)).getUTCDate(); // handles Feb 29
  return `${target}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  const dt = new Date(day + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** "Fall 2026" -> "Fall 2025"; "2026FA" -> "2025FA". */
export function priorTerm(term: string): string {
  const m = /(\d{4})/.exec(term);
  if (!m) throw new Error(`Can't infer the prior-year term from "${term}". Pass compare_term explicitly.`);
  return term.replace(m[1], String(Number(m[1]) - 1));
}

// ---------------------------------------------------------------- records

export function normalize(rows: SlateRow[], cfg: AppConfig['pipeline']): AppRecord[] {
  return rows.map((r) => {
    const dims: Record<string, string> = {};
    for (const [dim, col] of Object.entries(cfg.dimensions)) {
      const v = r[col];
      dims[dim] = v === null || v === undefined || String(v).trim() === '' ? '(blank)' : String(v).trim();
    }
    const stageDates: Record<string, string | null> = {};
    for (const s of cfg.stages) stageDates[s.key] = toDay(r[s.column]);
    return {
      term: String(r[cfg.columns.term] ?? '').trim(),
      dims,
      stageDates,
      cancelDate: cfg.cancelColumn ? toDay(r[cfg.cancelColumn]) : null,
    };
  });
}

export function applyFilters(records: AppRecord[], filters: Filters, knownDims: string[]): AppRecord[] {
  const active = Object.entries(filters).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0));
  for (const [k] of active) {
    if (!knownDims.includes(k)) throw new Error(`Unknown filter "${k}". Available dimensions: ${knownDims.join(', ') || '(none configured)'}.`);
  }
  if (!active.length) return records;
  const wanted = active.map(([k, v]) => [k, new Set((Array.isArray(v) ? v : [v as string]).map((x) => x.toLowerCase()))] as const);
  return records.filter((rec) => wanted.every(([k, set]) => set.has((rec.dims[k] ?? '').toLowerCase())));
}

// ---------------------------------------------------------------- counting

export interface StageCount {
  stage: string;
  label: string;
  count: number;
}

export interface FunnelCounts {
  asOf: string;
  stages: StageCount[];
  cancelled: number;
}

function reached(rec: AppRecord, stage: Stage, asOf: string): boolean {
  const d = rec.stageDates[stage.key];
  if (!d || d > asOf) return false;
  if (stage.netOfCancels && rec.cancelDate && rec.cancelDate <= asOf) return false;
  return true;
}

export function countAsOf(records: AppRecord[], stages: Stage[], asOf: string): FunnelCounts {
  const counts = stages.map((s) => ({ stage: s.key, label: s.label, count: 0 }));
  let cancelled = 0;
  for (const rec of records) {
    stages.forEach((s, i) => {
      if (reached(rec, s, asOf)) counts[i].count++;
    });
    if (rec.cancelDate && rec.cancelDate <= asOf && stages.some((s) => (rec.stageDates[s.key] ?? '9999') <= asOf)) cancelled++;
  }
  return { asOf, stages: counts, cancelled };
}

export function conversions(f: FunnelCounts): { from: string; to: string; rate: number | null }[] {
  const out: { from: string; to: string; rate: number | null }[] = [];
  for (let i = 1; i < f.stages.length; i++) {
    const a = f.stages[i - 1];
    const b = f.stages[i];
    out.push({ from: a.stage, to: b.stage, rate: a.count ? round(b.count / a.count, 4) : null });
  }
  return out;
}

export function compareFunnels(current: FunnelCounts, prior: FunnelCounts) {
  return current.stages.map((c, i) => {
    const p = prior.stages[i];
    const delta = c.count - p.count;
    return {
      stage: c.stage,
      label: c.label,
      current: c.count,
      prior: p.count,
      change: delta,
      pctChange: p.count ? round(delta / p.count, 4) : null,
    };
  });
}

export function breakdown(records: AppRecord[], stages: Stage[], dimension: string, asOf: string, top: number) {
  const groups = new Map<string, AppRecord[]>();
  for (const r of records) {
    const k = r.dims[dimension] ?? '(blank)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  let rows = [...groups.entries()].map(([value, recs]) => {
    const f = countAsOf(recs, stages, asOf);
    return { value, counts: Object.fromEntries(f.stages.map((s) => [s.stage, s.count])) as Record<string, number> };
  });
  // Sort by the deepest stage first so the biggest yield drivers lead.
  const order = [...stages].reverse().map((s) => s.key);
  rows.sort((a, b) => {
    for (const k of order) if (b.counts[k] !== a.counts[k]) return b.counts[k] - a.counts[k];
    return a.value.localeCompare(b.value);
  });
  if (rows.length > top) {
    const kept = rows.slice(0, top);
    const rest = rows.slice(top);
    const other: Record<string, number> = {};
    for (const s of stages) other[s.key] = rest.reduce((n, r) => n + r.counts[s.key], 0);
    rows = [...kept, { value: `(other: ${rest.length} values)`, counts: other }];
  }
  return rows;
}

export function paceSeries(records: AppRecord[], stage: Stage, start: string, end: string, intervalDays: number) {
  const points: { date: string; count: number }[] = [];
  // Pre-sort reach dates for a single linear pass.
  const dates = records
    .map((r) => r.stageDates[stage.key])
    .filter((d): d is string => !!d)
    .sort();
  const cancels = stage.netOfCancels
    ? records
        .filter((r) => r.stageDates[stage.key] && r.cancelDate)
        .map((r) => r.cancelDate as string)
        .sort()
    : [];
  let i = 0;
  let j = 0;
  for (let day = start; day <= end; day = addDays(day, intervalDays)) {
    while (i < dates.length && dates[i] <= day) i++;
    while (j < cancels.length && cancels[j] <= day) j++;
    points.push({ date: day, count: i - j });
  }
  if (points.length && points[points.length - 1].date !== end) {
    while (i < dates.length && dates[i] <= end) i++;
    while (j < cancels.length && cancels[j] <= end) j++;
    points.push({ date: end, count: i - j });
  }
  return points;
}

// ---------------------------------------------------------------- output helpers

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Small-cell suppression for counts shown to the model. */
export function suppress(n: number, threshold: number): number | string {
  return threshold > 0 && n > 0 && n < threshold ? `<${threshold}` : n;
}

export function distinctValues(records: AppRecord[], dim: string, limit = 50) {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.dims[dim], (counts.get(r.dims[dim]) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  return { values: sorted.slice(0, limit), total: sorted.length };
}
