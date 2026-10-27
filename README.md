# Slate Enrollment MCP Server (v2)

This server gives Claude **real-time, read-only enrollment pipeline data** from Greenville University's Slate instance (`apply.greenville.edu`). With it, Claude can answer questions and build dashboards such as:

- "Where are we on Fall 2027 deposits today versus this day last year?"
- "Break down admits and deposits by program, with last year alongside."
- "Chart weekly net deposits for Fall 2027 against Fall 2026."
- "Build a dashboard of the Fall 2027 funnel for First-Year students from Illinois."

## What changed from v1

v1 called a generic `/manage/query/run?cmd=query&q=<name>` endpoint with an `X-API-Key` header. Slate doesn't work that way. In Slate, each query is published as its **own web service** with its own URL (`...?id=<guid>&cmd=service&output=json&h=<token>`), and access is granted per query. v2 is rebuilt around that model:

| | v1 | v2 |
|---|---|---|
| Slate access | Generic endpoint by query name, so it never worked | Exact per-query service URLs copied from Slate |
| Auth | Basic auth plus an invented API-key header | "Username" Web Service grantee (Basic auth) and the `h` token |
| Data pulled | Full student records with names, emails and demographics | One lean query of **milestone dates and grouping fields only**, with no PII |
| As-of / YoY | Not supported | Any as-of date is rebuilt from milestone dates, including same day last year |
| Slate load | One call per question | 60-second cache, in-flight dedupe, and a local 200-calls-per-5-minutes cap (Slate allows 300) |
| Safety | None | Calls only the configured Slate host, runs only allowlisted queries, rejects unknown params and filters, optional small-cell suppression |
| Transport | stdio | stdio, plus Streamable HTTP with a bearer token for a shared server |
| Tests | None | 31 end-to-end checks against a fake Slate service, over both transports |

## Tools

| Tool | Purpose |
|---|---|
| `describe_pipeline` | Lists stages, dimensions, terms and common values. Claude calls this first. |
| `enrollment_snapshot` | Funnel counts for a term as of any date, with conversion rates and filters. |
| `enrollment_compare` | Same-day year-over-year comparison by stage, with change and % change. |
| `enrollment_breakdown` | Funnel by program, student type, state, sport, etc., optionally with the prior year. |
| `enrollment_pace` | Daily or weekly cumulative curve for one stage against the prior year. Good for pace charts. |
| `list_slate_queries` / `run_slate_query` | Run extra Slate queries you've allowlisted in the config, such as visit registrations. |

All tools are read-only. No tool returns an individual student.

## Setup

1. **Slate side.** Build the pipeline query and grant the service account. Follow [docs/SLATE_SETUP.md](docs/SLATE_SETUP.md); it takes about 30–60 minutes for a Slate admin.

2. **Install:**

   ```bash
   npm install
   npm run build
   cp config/slate.config.example.json config/slate.config.json   # paste your query URLs
   cp .env.example .env                                           # service account credentials
   ```

3. **Check:**

   ```bash
   npm run check:slate -- "Fall 2027"
   ```

### Connect Claude

**Claude Desktop (one machine, stdio).** Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "slate": {
      "command": "node",
      "args": ["C:/path/to/slate-mcp/dist/index.js"],
      "env": {
        "SLATE_CONFIG": "C:/path/to/slate-mcp/config/slate.config.json",
        "SLATE_USERNAME": "svc-claude-mcp",
        "SLATE_PASSWORD": "…"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add slate --env SLATE_CONFIG=/path/config/slate.config.json \
  --env SLATE_USERNAME=svc-claude-mcp --env SLATE_PASSWORD=… \
  -- node /path/to/slate-mcp/dist/index.js
```

**Shared server (enrollment team).** This keeps the Slate credentials on one GU server instead of everyone's laptop:

```bash
MCP_AUTH_TOKEN=$(openssl rand -hex 32) PORT=8787 npm run start:http
```

This serves `http://127.0.0.1:8787/mcp`, which requires `Authorization: Bearer <token>`, plus a health check at `/healthz`. Put it behind HTTPS (IIS reverse proxy, nginx, or a Cloudflare Tunnel) before exposing it. Rolling it out as a claude.ai custom connector for the whole team means adding OAuth in front, for example through an identity-aware proxy tied to your Microsoft/Google sign-in. That is the recommended next step once the numbers are validated.

## Configuration reference

`config/slate.config.json`:

- `baseUrl`: `https://apply.greenville.edu`. The server refuses to call any other host.
- `cacheSeconds`: how long a Slate pull is reused (default 60). "Real time" means at most this old. Pass `fresh: true` on any tool to re-query immediately.
- `suppressBelow`: report counts from 1 to N-1 as `<N`. Use 5 or 10 if summaries will be shared beyond enrollment staff.
- `pipeline.stages`: an ordered list of `{key, label, column, netOfCancels}`. Change these to match GU's funnel definitions.
- `pipeline.dimensions`: maps a dimension name to a query column. Every dimension can be used as a filter and as a breakdown.
- `pipeline.cancelColumn`: the withdraw/cancel/melt date, used for net counts.
- `queries`: extra allowlisted Slate queries, each with typed parameters, `maxRows` and `dropColumns`.

Secrets come only from the environment: `SLATE_USERNAME`, `SLATE_PASSWORD`, `MCP_AUTH_TOKEN`, and optionally `SLATE_PIPELINE_URL`.

## Data governance

- The pipeline query exports **no direct identifiers**, only dates and grouping fields. `check:slate` warns if PII-looking columns show up.
- Tool results enter the model's context. Use a Claude plan with commercial data terms, and agree with the Registrar and IR on which dimensions are appropriate. Small programs combined with state and sport can become identifying; use `suppressBelow` if needed.
- The service account should be a grantee on these queries only, with no other Slate permissions.

## Development

```bash
npm run typecheck
npm test        # fake Slate + real MCP client over stdio and HTTP
npm run dev     # run from source
```
