/**
 * Connection check: `npm run check:slate -- "Fall 2026"`
 *
 * Calls the pipeline query once and reports what came back, so you can fix
 * column names in config before connecting Claude. Prints no student data.
 */

import { loadConfig } from './config.js';
import { SlateClient, redact } from './slate-client.js';
import { normalize, todayIn, countAsOf } from './pipeline.js';

const term = process.argv[2];
const cfg = loadConfig();
const client = new SlateClient({ ...cfg, fetchImpl: undefined });
const p = cfg.pipeline;

const params = p.termParam && term ? { [p.termParam]: term } : {};
console.log(`Calling ${redact(client.buildUrl(p.url, params))}`);
const res = await client.run(p.url, params, { fresh: true });
console.log(`OK: ${res.rows.length} rows`);

if (!res.rows.length) {
  console.log('The query returned no rows. Check its filters (and the term parameter, if used).');
  process.exit(0);
}

const columns = new Set(res.rows.flatMap((r) => Object.keys(r)));
console.log(`Columns returned: ${[...columns].join(', ')}`);

const expected: [string, string][] = [
  ['term', p.columns.term],
  ...Object.entries(p.dimensions).map(([d, c]) => [`dimension ${d}`, c] as [string, string]),
  ...p.stages.map((s) => [`stage ${s.key}`, s.column] as [string, string]),
  ...(p.cancelColumn ? [['cancel', p.cancelColumn] as [string, string]] : []),
];
let missing = 0;
for (const [what, col] of expected) {
  if (!columns.has(col)) {
    missing++;
    console.log(`  MISSING  ${what}: no column "${col}"`);
  }
}
if (!missing) console.log('All configured columns are present.');

const pii = [...columns].filter((c) => /name|email|phone|birth|dob|ssn|address|ref|slate_id|person/i.test(c));
if (pii.length) console.log(`WARNING: columns that look like personal data: ${pii.join(', ')}. The pipeline query only needs dates and grouping fields.`);

const records = normalize(res.rows, p);
const terms = [...new Set(records.map((r) => r.term))];
console.log(`Terms: ${terms.join(', ')}`);
if (term) {
  const f = countAsOf(records.filter((r) => r.term.toLowerCase() === term.toLowerCase()), p.stages, todayIn('America/Chicago'));
  console.log(`${term} today:`, f.stages.map((s) => `${s.label}=${s.count}`).join('  '));
}
