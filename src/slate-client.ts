/**
 * Slate query web-service client.
 *
 * Slate has no general-purpose data API. Each query you build in Slate's
 * Query Builder can be exposed as its own web service, with its own URL:
 *
 *   https://apply.greenville.edu/manage/query/run?id=<query guid>&cmd=service&output=json&h=<token>
 *
 * Access is controlled by the grantees on that query (Edit Permissions ->
 * Add Grantee -> Web Service). We use a "Username" grantee, so every call also
 * carries HTTP Basic credentials for a dedicated service account.
 *
 * Query @parameters are passed as extra query-string arguments
 * (e.g. &term=Fall%202026).
 */

export interface SlateClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  cacheSeconds: number;
  requestTimeoutSeconds: number;
  fetchImpl?: typeof fetch;
}

export type SlateRow = Record<string, unknown>;

export interface SlateResult {
  rows: SlateRow[];
  fetchedAt: Date;
  fromCache: boolean;
}

/** Reserved by Slate; callers may not override these. */
const RESERVED_PARAMS = new Set(['callback', 'base', 'run', 'query', 'user', 'identity', 'id', 'h', 'output', 'cmd']);

/** Slate allows 300 web-service requests per database per 5 minutes. Stay well under it. */
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 200;

export class SlateError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SlateError';
  }
}

export class SlateClient {
  private readonly origin: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { at: number; rows: SlateRow[] }>();
  private readonly inFlight = new Map<string, Promise<SlateRow[]>>();
  private readonly callTimes: number[] = [];

  constructor(private readonly opts: SlateClientOptions) {
    this.origin = new URL(opts.baseUrl).origin;
    this.authHeader = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Build the final request URL from a Slate service URL plus parameters.
   * Refuses to call anything outside the configured Slate host so a bad
   * config can never send the service-account credentials elsewhere.
   */
  buildUrl(serviceUrl: string, params: Record<string, string | number | boolean | undefined> = {}): URL {
    const url = new URL(serviceUrl, this.origin + '/');
    if (url.origin !== this.origin) {
      throw new SlateError(`Refusing to call ${url.origin}: only ${this.origin} is allowed.`);
    }
    if (!url.pathname.startsWith('/manage/')) {
      throw new SlateError(`Unexpected Slate service path ${url.pathname}; expected a /manage/... query URL.`);
    }
    if (!url.searchParams.get('output')) url.searchParams.set('output', 'json');
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === '') continue;
      if (RESERVED_PARAMS.has(k.toLowerCase())) throw new SlateError(`"${k}" is a reserved Slate parameter.`);
      url.searchParams.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    return url;
  }

  async run(
    serviceUrl: string,
    params: Record<string, string | number | boolean | undefined> = {},
    { fresh = false }: { fresh?: boolean } = {},
  ): Promise<SlateResult> {
    const url = this.buildUrl(serviceUrl, params);
    const key = url.toString();
    const now = Date.now();
    const cached = this.cache.get(key);
    if (!fresh && cached && now - cached.at < this.opts.cacheSeconds * 1000) {
      return { rows: cached.rows, fetchedAt: new Date(cached.at), fromCache: true };
    }

    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.fetchRows(url).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    const rows = await pending;
    const at = Date.now();
    this.cache.set(key, { at, rows });
    return { rows, fetchedAt: new Date(at), fromCache: false };
  }

  private reserveCall(): void {
    const now = Date.now();
    while (this.callTimes.length && now - this.callTimes[0] > RATE_WINDOW_MS) this.callTimes.shift();
    if (this.callTimes.length >= RATE_LIMIT) {
      throw new SlateError(
        'Local safety limit reached (200 Slate web-service calls in 5 minutes). Slate caps each database at 300; wait a few minutes.',
      );
    }
    this.callTimes.push(now);
  }

  private async fetchRows(url: URL): Promise<SlateRow[]> {
    this.reserveCall();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.requestTimeoutSeconds * 1000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      const reason = (err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message;
      throw new SlateError(`Slate request ${reason} (${redact(url)}).`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new SlateError(
        `Slate rejected the credentials (${res.status}). Check that the service account is a Web Service grantee on this query and that SLATE_USERNAME/SLATE_PASSWORD are right.`,
        res.status,
      );
    }
    if (res.status === 429) throw new SlateError('Slate web-service rate limit reached (300 calls / 5 min). Try again shortly.', 429);
    if (!res.ok) throw new SlateError(`Slate returned ${res.status} for ${redact(url)}: ${text.slice(0, 300)}`, res.status);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      const hint = /<html|<!doctype/i.test(text)
        ? ' It returned an HTML page, which usually means a login redirect or a URL without cmd=service.'
        : '';
      throw new SlateError(`Slate did not return JSON.${hint} Set the query's service type to JSON.`);
    }
    return extractRows(body);
  }
}

/** Slate JSON services return {"row": [...]} (a single row may come back as an object). */
export function extractRows(body: unknown): SlateRow[] {
  if (body === null || body === undefined) return [];
  if (Array.isArray(body)) return body as SlateRow[];
  if (typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const k of ['row', 'rows', 'data', 'results']) {
      if (k in b) {
        const v = b[k];
        if (Array.isArray(v)) return v as SlateRow[];
        if (v && typeof v === 'object') return [v as SlateRow];
        return [];
      }
    }
  }
  throw new SlateError('Unrecognized Slate JSON shape (expected {"row": [...]}).');
}

/** Hide the h= token when a URL shows up in an error message. */
export function redact(url: URL): string {
  const u = new URL(url.toString());
  if (u.searchParams.has('h')) u.searchParams.set('h', '***');
  return u.toString();
}
