// MCP OAuth 2.1 helper (server-only). Implements Dynamic Client Registration +
// Authorization Code + PKCE against an MCP server's advertised OAuth server.

import { createHash, randomBytes } from "crypto";

export type OAuthServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
};

export type ProtectedResourceMetadata = {
  authorization_servers?: string[];
  resource?: string;
};

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function makePkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Probes MCP server for `WWW-Authenticate` and its OAuth resource metadata. */
export async function discoverAuthServer(mcpUrl: string): Promise<OAuthServerMetadata> {
  // 1. Try RFC9728 protected resource metadata via well-known path.
  const url = new URL(mcpUrl);
  const prmUrl = `${url.origin}/.well-known/oauth-protected-resource`;
  let authServerBase: string | null = null;

  try {
    const r = await fetch(prmUrl);
    if (r.ok) {
      const prm = (await r.json()) as ProtectedResourceMetadata;
      if (prm.authorization_servers?.[0]) authServerBase = prm.authorization_servers[0];
    }
  } catch {
    /* ignore */
  }

  // 2. Fallback: probe the MCP endpoint and read WWW-Authenticate.
  if (!authServerBase) {
    const probe = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const www = probe.headers.get("www-authenticate") ?? "";
    const m = www.match(/resource_metadata="([^"]+)"/);
    if (m) {
      const r = await fetch(m[1]);
      const prm = (await r.json()) as ProtectedResourceMetadata;
      authServerBase = prm.authorization_servers?.[0] ?? null;
    }
  }

  // 3. Last-resort: assume same origin.
  if (!authServerBase) authServerBase = url.origin;

  // Fetch AS metadata. RFC 8414 says for an issuer with a path, the metadata
  // lives at origin + /.well-known/oauth-authorization-server + path. Some
  // providers (e.g. Robinhood) instead publish it at the origin root. Try both,
  // plus the naive "issuer + /.well-known/..." form.
  const issuerUrl = new URL(authServerBase);
  const candidates = Array.from(new Set([
    // RFC 8414 §3.1: /.well-known inserted between host and issuer path
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === "/" ? "" : issuerUrl.pathname}`,
    // Root-hosted metadata (Robinhood-style)
    `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
    // Naive suffix
    authServerBase.replace(/\/$/, "") + "/.well-known/oauth-authorization-server",
  ]));

  let lastStatus = 0;
  for (const asMetaUrl of candidates) {
    const r = await fetch(asMetaUrl);
    if (r.ok) {
      return (await r.json()) as OAuthServerMetadata;
    }
    lastStatus = r.status;
  }
  throw new Error(
    `OAuth server metadata not found (last HTTP ${lastStatus}). Tried: ${candidates.join(", ")}`,
  );
}


export async function registerClient(
  registration_endpoint: string,
  redirectUri: string,
  clientName: string,
): Promise<{ client_id: string; client_secret?: string; raw: unknown }> {
  const body = {
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  const r = await fetch(registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Dynamic client registration failed (${r.status}): ${await r.text()}`);
  const json = (await r.json()) as { client_id: string; client_secret?: string };
  return { client_id: json.client_id, client_secret: json.client_secret, raw: json };
}

export function buildAuthorizeUrl(params: {
  authorization_endpoint: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  scope?: string;
  resource?: string;
  force_path?: string;
}): string {
  const u = new URL(params.authorization_endpoint);
  if (params.force_path) u.pathname = params.force_path;
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", params.client_id);
  u.searchParams.set("redirect_uri", params.redirect_uri);
  u.searchParams.set("code_challenge", params.code_challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", params.state);
  if (params.scope) u.searchParams.set("scope", params.scope);
  if (params.resource) u.searchParams.set("resource", params.resource);
  return u.toString();
}

export async function exchangeCode(params: {
  token_endpoint: string;
  code: string;
  redirect_uri: string;
  client_id: string;
  client_secret?: string;
  code_verifier: string;
  resource?: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirect_uri,
    client_id: params.client_id,
    code_verifier: params.code_verifier,
  });
  if (params.client_secret) body.set("client_secret", params.client_secret);
  if (params.resource) body.set("resource", params.resource);

  const r = await fetch(params.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Token exchange failed (${r.status}): ${await r.text()}`);
  return (await r.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
}
