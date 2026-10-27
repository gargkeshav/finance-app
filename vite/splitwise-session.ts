import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { headerNames, parseCurl, type ParsedCurl } from "../src/adapters/curl-capture.ts";

const sessionPath = "/__splitwise/session";
const proxyPrefix = "/splitwise-api/";
const upstreamOrigin = "https://secure.splitwise.com";
const maxSessionBody = 1024 * 1024;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage, limit = Number.POSITIVE_INFINITY): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isOwnOrigin(origin: string | undefined, server: ViteDevServer): boolean {
  if (!origin) return true;
  const resolved = server.resolvedUrls;
  const ownOrigins = [
    ...(resolved?.local ?? []),
    ...(resolved?.network ?? []),
    ...(server.config.server.origin ? [server.config.server.origin] : []),
  ].map((url) => {
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  });
  return ownOrigins.includes(origin);
}

function splitSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,\s=]+=[^;,]*)/).map((part) => part.trim()).filter(Boolean);
}

function mergeSetCookies(current: string, setCookies: string[]): string {
  const cookies = new Map<string, string>();
  for (const pair of current.split(";")) {
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  for (const cookie of setCookies) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const expires = /(?:^|;)\s*max-age\s*=\s*0(?:;|$)/i.test(cookie);
    if (expires) cookies.delete(name);
    else cookies.set(name, value);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function getSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  return withGetSetCookie.getSetCookie?.() ?? splitSetCookie(headers.get("set-cookie") ?? "");
}

function sendUpstreamResponse(response: ServerResponse, upstream: Response): void {
  response.statusCode = upstream.status;
  response.statusMessage = upstream.statusText;
  for (const [name, value] of upstream.headers) {
    const lowerName = name.toLowerCase();
    if (lowerName === "set-cookie" || lowerName === "content-length" ||
        lowerName === "content-encoding" || lowerName === "transfer-encoding") continue;
    response.setHeader(name, value);
  }
}

export function splitwiseSession(): Plugin {
  let session: ParsedCurl | null = null;
  return {
    name: "finance-splitwise-session",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = request.url ?? "/";
        const pathname = new URL(requestUrl, "http://localhost").pathname;
        const isSessionRequest = pathname === sessionPath;
        const isProxyRequest = pathname.startsWith(proxyPrefix);
        if (!isSessionRequest && !isProxyRequest) {
          next();
          return;
        }

        if (!isOwnOrigin(request.headers.origin, server)) {
          sendJson(response, 403, { error: "Request origin is not allowed." });
          return;
        }
        if (request.headers["x-finance-app"] !== "1") {
          sendJson(response, 403, { error: "Request is not allowed." });
          return;
        }

        if (isSessionRequest) {
          if (request.method === "GET") {
            sendJson(response, 200, { connected: Boolean(session), headerNames: session ? headerNames(session) : [] });
            return;
          }
          if (request.method === "DELETE") {
            session = null;
            response.statusCode = 204;
            response.end();
            return;
          }
          if (request.method !== "POST") {
            sendJson(response, 405, { error: "Method not allowed." });
            return;
          }
          try {
            const body = await readBody(request, maxSessionBody);
            const payload = JSON.parse(new TextDecoder().decode(body)) as { text?: unknown };
            if (typeof payload.text !== "string" || !payload.text.trim()) {
              sendJson(response, 400, { error: "Paste a request copied as cURL." });
              return;
            }
            session = parseCurl(payload.text);
            sendJson(response, 200, { connected: true, headerNames: headerNames(session) });
          } catch (error) {
            sendJson(response, 400, {
              error: error instanceof Error ? error.message : "The copied cURL could not be read.",
            });
          }
          return;
        }

        const route = new URL(requestUrl, "http://localhost");
        if (route.pathname !== "/splitwise-api/api/v3.0" &&
            !route.pathname.startsWith("/splitwise-api/api/v3.0/")) {
          sendJson(response, 404, { error: "Splitwise API path not found." });
          return;
        }
        if (!session) {
          sendJson(response, 401, { error: "Splitwise session is not connected." });
          return;
        }

        const target = new URL(`${route.pathname.slice("/splitwise-api".length)}${route.search}`, upstreamOrigin);
        const headers = new Headers();
        for (const [name, value] of Object.entries(session.headers)) {
          const lowerName = name.toLowerCase();
          if (["host", "content-length", "accept-encoding", "content-type", "cookie", "origin", "referer"].includes(lowerName)) continue;
          headers.set(name, value);
        }
        headers.set("Origin", upstreamOrigin);
        headers.set("Referer", `${upstreamOrigin}/`);
        if (session.cookies) headers.set("Cookie", session.cookies);
        const contentType = request.headers["content-type"];
        if (typeof contentType === "string") headers.set("Content-Type", contentType);
        const method = request.method ?? "GET";
        const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request);

        try {
          const upstream = await fetch(target, {
            method,
            headers,
            body: body === undefined ? undefined : new Uint8Array(body),
          });
          const setCookies = getSetCookies(upstream.headers);
          if (session && setCookies.length) session.cookies = mergeSetCookies(session.cookies, setCookies);
          sendUpstreamResponse(response, upstream);
          response.end(new Uint8Array(await upstream.arrayBuffer()));
        } catch {
          sendJson(response, 502, { error: "The Splitwise request could not be completed." });
        }
      });
    },
  };
}
