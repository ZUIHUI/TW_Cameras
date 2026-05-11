import { config, missingEnv } from "./config.js";
import { fetchJson, UpstreamError } from "./http.js";

interface TdxTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

let tokenCache: { token: string; expiresAt: number } | undefined;

export async function getTdxToken(): Promise<string> {
  const missing = missingEnv(["tdxClientId", "tdxClientSecret"]);
  if (missing.length) {
    throw new UpstreamError(`Missing TDX credentials: ${missing.join(", ")}`, 500);
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.tdxClientId,
    client_secret: config.tdxClientSecret
  });

  const token = await fetchJson<TdxTokenResponse>(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    },
    15000
  );

  tokenCache = {
    token: token.access_token,
    expiresAt: Date.now() + Math.max(token.expires_in - 300, 60) * 1000
  };

  return tokenCache.token;
}

export async function tdxGet<T>(resourcePath: string, params: Record<string, string> = {}): Promise<T> {
  const token = await getTdxToken();
  const path = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
  const url = new URL(`https://tdx.transportdata.tw/api/basic/v2${path}`);

  url.searchParams.set("$format", "JSON");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return fetchJson<T>(
    url.toString(),
    {
      headers: {
        authorization: `Bearer ${token}`,
        "accept-encoding": "br,gzip"
      }
    },
    20000
  );
}
