/**
 * End-to-end test: a fake Slate web service + a real MCP client talking to
 * this server over stdio and over HTTP. Run with `npm test`.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ---------------------------------------------------------------- fake Slate

const ROWS = [
  // Fall 2026 (current cycle)
  { term: 'Fall 2026', student_type: 'First-Year', program: 'Nursing', state: 'IL', submitted_date: '2025-10-01T09:15:00', completed_date: '10/10/2025', admit_date: '2025-11-01', deposit_date: '2026-01-15', enrolled_date: '', withdrawn_date: '' },
  { term: 'Fall 2026', student_type: 'First-Year', program: 'Business', state: 'MO', submitted_date: '2025-11-01', completed_date: '2025-11-05', admit_date: '2025-12-01', deposit_date: '2026-02-01', enrolled_date: null, withdrawn_date: '2026-03-01' },
  { term: 'Fall 2026', student_type: 'Transfer', program: 'Nursing', state: 'IL', submitted_date: '2026-01-10', completed_date: null, admit_date: null, deposit_date: null, enrolled_date: null, withdrawn_date: null },
  { term: 'Fall 2026', student_type: 'First-Year', program: 'Music', state: 'IL', submitted_date: '2026-09-01', completed_date: null, admit_date: null, deposit_date: null, enrolled_date: null, withdrawn_date: null },
  // Fall 2025 (prior cycle)
  { term: 'Fall 2025', student_type: 'First-Year', program: 'Nursing', state: 'IL', submitted_date: '2024-10-01', completed_date: '2024-10-05', admit_date: '2024-10-20', deposit_date: '2025-03-01', enrolled_date: '2025-08-25', withdrawn_date: null },
  { term: 'Fall 2025', student_type: 'Transfer', program: 'Business', state: 'IN', submitted_date: '2025-02-01', completed_date: '2025-02-03', admit_date: '2025-02-10', deposit_date: null, enrolled_date: null, withdrawn_date: null },
];

let slateCalls = 0;
const fakeSlate = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const auth = req.headers.authorization ?? '';
  if (auth !== 'Basic ' + Buffer.from('svc:secret').toString('base64')) {
    res.writeHead(401).end('unauthorized');
    return;
  }
  slateCalls++;
  if (url.pathname === '/manage/query/run' && url.searchParams.get('id') === 'pipe' && url.searchParams.get('h') === 'tok') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ row: ROWS }));
    return;
  }
  if (url.pathname === '/manage/query/run' && url.searchParams.get('id') === 'visits') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ row: [{ event_date: url.searchParams.get('start'), event_type: 'Visit Day', registrations: 14, secret_col: 'x' }] }),
    );
    return;
  }
  res.writeHead(404).end('nope');
});
await new Promise<void>((r) => fakeSlate.listen(0, '127.0.0.1', r));
const slatePort = (fakeSlate.address() as { port: number }).port;
const base = `http://127.0.0.1:${slatePort}`;

const dir = mkdtempSync(join(tmpdir(), 'slate-mcp-test-'));
const configPath = join(dir, 'slate.config.json');
writeFileSync(
  configPath,
  JSON.stringify({
    baseUrl: base,
    cacheSeconds: 60,
    pipeline: {
      url: `${base}/manage/query/run?id=pipe&cmd=service&output=json&h=tok`,
      termParam: null,
      dimensions: { student_type: 'student_type', program: 'program', state: 'state' },
      stages: [
        { key: 'submitted', label: 'Submitted', column: 'submitted_date' },
        { key: 'completed', label: 'Completed', column: 'completed_date' },
        { key: 'admitted', label: 'Admitted', column: 'admit_date' },
        { key: 'deposited', label: 'Deposited (net)', column: 'deposit_date', netOfCancels: true },
        { key: 'enrolled', label: 'Enrolled', column: 'enrolled_date', netOfCancels: true },
      ],
      cancelColumn: 'withdrawn_date',
    },
    queries: {
      visit_registrations: {
        description: 'Visit registrations',
        url: '/manage/query/run?id=visits&cmd=service&output=json&h=v',
        params: { start: { type: 'date', required: true }, end: { type: 'date' } },
        dropColumns: ['secret_col'],
      },
    },
  }),
);

const env = { ...process.env, SLATE_CONFIG: configPath, SLATE_USERNAME: 'svc', SLATE_PASSWORD: 'secret' } as Record<string, string>;
const root = resolve(import.meta.dirname, '..');

const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { isError: !!r.isError, text: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) };
};

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

async function suite(client: Client, mode: string) {
  console.log(`\n[${mode}]`);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check('tools registered', () =>
    assert.deepEqual(tools, [
      'describe_pipeline',
      'enrollment_breakdown',
      'enrollment_compare',
      'enrollment_pace',
      'enrollment_snapshot',
      'list_slate_queries',
      'run_slate_query',
    ]),
  );

  const d = await call(client, 'describe_pipeline', {});
  check('describe lists terms and dimensions', () => {
    assert.deepEqual(d.json.terms.map((t: { term: string }) => t.term).sort(), ['Fall 2025', 'Fall 2026']);
    assert.ok(d.json.dimensions.program.values.includes('Nursing'));
  });

  const s = await call(client, 'enrollment_snapshot', { term: 'Fall 2026', as_of: '2026-06-01' });
  const counts = Object.fromEntries(s.json.stages.map((x: { stage: string; count: number }) => [x.stage, x.count]));
  check('snapshot counts (mixed date formats, net of cancels, future dates excluded)', () =>
    assert.deepEqual(counts, { submitted: 3, completed: 2, admitted: 2, deposited: 1, enrolled: 0 }),
  );
  check('snapshot cancels and conversion', () => {
    assert.equal(s.json.cancelledOrWithdrawn, 1);
    assert.equal(s.json.conversion[0].rate, 0.6667);
  });

  const filtered = await call(client, 'enrollment_snapshot', { term: 'fall 2026', as_of: '2026-06-01', filters: { program: 'Nursing' } });
  check('filters + case-insensitive term', () => assert.equal(filtered.json.stages[0].count, 2));

  const c = await call(client, 'enrollment_compare', { term: 'Fall 2026', as_of: '2026-06-01' });
  check('same-day YoY comparison', () => {
    assert.equal(c.json.comparison.term, 'Fall 2025');
    assert.equal(c.json.comparison.asOf, '2025-06-01');
    const sub = c.json.stages.find((x: { stage: string }) => x.stage === 'submitted');
    assert.deepEqual([sub.current, sub.prior, sub.change, sub.pctChange], [3, 2, 1, 0.5]);
    const enr = c.json.stages.find((x: { stage: string }) => x.stage === 'enrolled');
    assert.equal(enr.prior, 0); // enrolled 2025-08-25, after 2025-06-01
  });

  const b = await call(client, 'enrollment_breakdown', { term: 'Fall 2026', dimension: 'program', as_of: '2026-06-01', include_prior_year: true });
  check('breakdown sorted by deepest stage, with prior year', () => {
    assert.equal(b.json.rows[0].program, 'Nursing');
    assert.equal(b.json.rows[0].submitted, 2);
    assert.equal(b.json.rows[0].prior_year.deposited, 1);
  });

  const pace = await call(client, 'enrollment_pace', { term: 'Fall 2026', stage: 'deposited', start: '2026-01-01', end: '2026-03-31', interval: 'week' });
  check('pace curve with prior year', () => {
    const last = pace.json.series.at(-1);
    assert.equal(last.date, '2026-03-31');
    assert.equal(last['Fall 2026'], 1); // 2 deposits, 1 withdrawn
    assert.equal(last['Fall 2025 (same day)'], 1);
    const feb2 = pace.json.series.find((p: { date: string }) => p.date >= '2026-02-01' && p.date < '2026-03-01');
    assert.equal(feb2['Fall 2026'], 2);
  });

  const bad = await call(client, 'enrollment_snapshot', { term: 'Spring 2030' });
  check('unknown term gives helpful error', () => {
    assert.ok(bad.isError);
    assert.match(bad.text, /Fall 2025, Fall 2026/);
  });

  const badFilter = await call(client, 'enrollment_snapshot', { term: 'Fall 2026', filters: { ssn: 'x' } });
  check('unknown filter rejected', () => assert.ok(badFilter.isError));

  const q = await call(client, 'run_slate_query', { name: 'visit_registrations', params: { start: '2026-10-01' } });
  check('registered query runs and drops configured columns', () => {
    assert.equal(q.json.rows[0].registrations, 14);
    assert.equal(q.json.rows[0].event_date, '2026-10-01');
    assert.equal('secret_col' in q.json.rows[0], false);
  });

  const qMissing = await call(client, 'run_slate_query', { name: 'visit_registrations', params: {} });
  check('required parameter enforced', () => assert.ok(qMissing.isError));

  const qExtra = await call(client, 'run_slate_query', { name: 'visit_registrations', params: { start: '2026-10-01', id: 'other' } });
  check('cannot smuggle reserved/unknown params', () => assert.ok(qExtra.isError));
}

// ---------------------------------------------------------------- stdio

{
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', join(root, 'src/index.ts')], env, cwd: root, stderr: 'pipe' });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport);
  slateCalls = 0;
  await suite(client, 'stdio');
  check('cache keeps Slate calls low', () => assert.ok(slateCalls <= 3, `slate calls: ${slateCalls}`));
  await client.close();
}

// ---------------------------------------------------------------- http

{
  const token = 'x'.repeat(40);
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'src/index.ts'), '--http'], {
    env: { ...env, MCP_AUTH_TOKEN: token, PORT: String(port) },
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((r, j) => {
    child.stderr.on('data', (d) => /\(http\) on/.test(String(d)) && r());
    child.on('exit', (code) => j(new Error(`http server exited ${code}`)));
  });
  try {
    const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' });
    check('http rejects missing token', () => assert.equal(unauth.status, 401));

    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    await suite(client, 'http');
    await client.close();
  } finally {
    child.kill();
  }
}

// ---------------------------------------------------------------- client safety

{
  const { SlateClient } = await import('../src/slate-client.js');
  const sc = new SlateClient({ baseUrl: 'https://apply.greenville.edu', username: 'u', password: 'p', cacheSeconds: 0, requestTimeoutSeconds: 5 });
  console.log('\n[client]');
  check('refuses other hosts', () => assert.throws(() => sc.buildUrl('https://evil.example.com/manage/query/run?id=1')));
  check('relative URLs resolve to Slate host', () =>
    assert.equal(sc.buildUrl('/manage/query/run?id=1&h=2').host, 'apply.greenville.edu'),
  );
  check('defaults output=json', () => assert.equal(sc.buildUrl('/manage/query/run?id=1').searchParams.get('output'), 'json'));
}

fakeSlate.close();
console.log(`\n${passed} checks passed`);
process.exit(0);
