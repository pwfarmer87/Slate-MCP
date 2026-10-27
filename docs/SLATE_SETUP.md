# Slate setup (apply.greenville.edu)

This server reads from Slate through **query web services**. Slate has no general data API: each query you build can be published as its own JSON endpoint, and access is granted per query. You need one required query (the enrollment pipeline) and, optionally, a few extra aggregate queries.

Requires the Slate **Administrator (All Access)** role to create web-service grantees.

---

## 1. Create a service account

1. In Slate, go to **Database → User Permissions** and add a user such as `svc-claude-mcp`.
2. Give it **no roles or permissions**. It only needs to be a grantee on the queries below.
3. Set a long random password. This goes in `SLATE_PASSWORD` on the server only.

## 2. Build the pipeline query

**Queries / Reports → New Query → Configurable Joins**

- **Base:** Applications
- **Name:** `MCP - Enrollment Pipeline`
- **Folder:** something only admins can see

### Filters

- Entry term is one of the terms to compare. Include the current recruiting cycle and at least the prior year, e.g. Fall 2026, Fall 2027, Spring 2027.
- Exclude test, duplicate and inactive application rounds the way your existing funnel reports do.

Update the term list each cycle, or use a period/round filter that rolls forward on its own.

### Exports

Only dates and grouping fields are exported. No names, emails, Slate IDs or birthdates.

The **export name** must match the column name in `config/slate.config.json`. Rename either side as you like, as long as they match.

| Export name | What it is | How to build it in Configurable Joins |
|---|---|---|
| `term` | Entry term label, e.g. `Fall 2027` | Application → Period / Entry Term |
| `student_type` | First-Year, Transfer, Graduate, Adult/Online… | Application → Round, or your student-type field |
| `program` | Intended program/major | Application → Academic Program (or your major field) |
| `modality` | On-campus / online (optional) | Your modality/campus field |
| `state` | Home state | Join Person → Addresses (Primary) → Region |
| `county` | Home county (optional) | Join Person → Addresses (Primary) → County |
| `sport` | Athletic interest/recruit (optional) | Your athletics field |
| `app_source` | Application source | Application → Source / Application Type |
| `submitted_date` | Date submitted | Application → Submitted Date |
| `completed_date` | Date the file became complete | Your completed date: checklist-complete date, or the first time the app entered your Awaiting Decision bin |
| `admit_date` | First admit decision released | Subquery export: Join Decisions, filter decision code in your admit codes and released = yes, aggregate **Minimum** of Released Date |
| `deposit_date` | Deposit / confirmation date | Subquery export: either the first released Confirmed/Deposited decision, or the minimum date of payments of type Enrollment Deposit |
| `enrolled_date` | Registered / enrolled date | Your SIS-fed enrollment field or registered date. Leave blank until it exists. |
| `withdrawn_date` | Cancel / withdraw / melt date | Subquery export: Join Decisions, filter withdraw/cancel/melt codes, aggregate **Maximum** of Released Date |

Notes:

- Export dates as **dates**. Datetime is fine too; the server keeps only the day.
- Leave a stage blank when the application hasn't reached it. Don't use `0` or `N/A`.
- `deposited` and `enrolled` are counted **net of cancels**: an application with a `withdrawn_date` on or before the as-of date is excluded. This is configurable per stage.
- Every count is rebuilt from these dates, so "as of today vs. the same day last year" needs no snapshot tables. One caveat: decisions that were reversed or deleted in Slate won't show up historically.

### Make it a web service

1. On the query, set **Service Type** to **JSON**.
2. Leave **Parameters** empty. The server filters by term itself, which keeps it to one Slate call per minute, however many questions Claude asks.
3. Select **Edit Permissions → Add Grantee**:
   - Type: **Username**
   - User: `svc-claude-mcp`
   - Access: **Web Service**
4. Select the **JSON** link next to Web Services, then choose the service account. Copy the endpoint URL. It looks like:

   ```
   https://apply.greenville.edu/manage/query/run?id=<guid>&cmd=service&output=json&h=<token>
   ```

5. Paste the URL into `pipeline.url` in `config/slate.config.json`, or into `SLATE_PIPELINE_URL`.

### Larger datasets (optional)

If the query gets slow, add a parameter so Slate filters per term:

```xml
<param id="term" type="varchar" label="Entry term:"/>
```

Then filter on Entry Term = `@term` in the query, and set `"termParam": "term"` in the config. Each term is then a separate Slate call, so comparisons cost two calls instead of one.

## 3. Optional extra queries

For anything outside the application funnel, such as visit registrations, inquiry volume, or housing deposits, build another **aggregate** query and register it under `queries` in the config. Each entry gets:

- a description, which Claude reads to decide when to use it
- the service URL
- typed parameters (passed as `@param` values)
- an optional `dropColumns` list
- a `maxRows` cap

Claude can run only the queries listed there. It never builds URLs or SQL.

## 4. Check the connection

```bash
npm run check:slate -- "Fall 2027"
```

This prints:

- the row count
- which configured columns are missing
- any columns that look like personal data
- today's funnel for the term

It never prints student rows.

## Limits to keep in mind

- Slate allows **300 web-service requests and 300 seconds of processing per 5 minutes** per database. The server caches each pull for `cacheSeconds` (default 60) and stops itself at 200 calls per 5 minutes.
- Web-service queries run against live production data. A heavy query competes with your staff's work, so keep exports lean.
