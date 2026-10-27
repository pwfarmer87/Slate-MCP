#!/usr/bin/env node
/**
 * Entry point.
 *
 *   node dist/index.js          -> stdio (Claude Desktop / Claude Code on one machine)
 *   node dist/index.js --http   -> Streamable HTTP on $PORT (default 8787) at /mcp,
 *                                  protected by a bearer token (MCP_AUTH_TOKEN).
 *                                  Put it behind HTTPS (IIS/nginx/Cloudflare) before
 *                                  exposing it beyond localhost.
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { loadConfig } from './config.js';
import { SlateClient } from './slate-client.js';
import { createServer, VERSION } from './server.js';

async function main() {
  const cfg = loadConfig();
  const client = new SlateClient({
    baseUrl: cfg.baseUrl,
    username: cfg.username,
    password: cfg.password,
    cacheSeconds: cfg.cacheSeconds,
    requestTimeoutSeconds: cfg.requestTimeoutSeconds,
  });

  if (!process.argv.includes('--http')) {
    const server = createServer(cfg, client);
    await server.connect(new StdioServerTransport());
    console.error(`slate-enrollment MCP ${VERSION} (stdio) -> ${cfg.baseUrl}`);
    return;
  }

  const token = process.env.MCP_AUTH_TOKEN ?? '';
  if (token.length < 32) {
    throw new Error('HTTP mode requires MCP_AUTH_TOKEN (at least 32 random characters).');
  }
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';

  const authorized = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? '';
    const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((resolveBody, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 1_000_000) {
          reject(new Error('Request too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  };

  const http = createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/healthz') return send(res, 200, { ok: true, version: VERSION });
    if (path !== '/mcp') return send(res, 404, { error: 'not found' });
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });

    try {
      const body = await readBody(req);
      // Stateless: a fresh MCP server per request; the Slate client (and its cache) is shared.
      const server = createServer(cfg, client);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });

  http.listen(port, host, () => console.error(`slate-enrollment MCP ${VERSION} (http) on http://${host}:${port}/mcp -> ${cfg.baseUrl}`));
}

main().catch((err) => {
  console.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
