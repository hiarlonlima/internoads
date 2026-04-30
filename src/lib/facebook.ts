// Helpers pra interagir com Graph API e Facebook OAuth (Login for Business + User Access Token)

export const GRAPH_API_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não está definida em .env.local`);
  return value;
}

export function buildOAuthUrl(state: string): string {
  // Login for Business: scopes vêm da Login Configuration (config_id), não de `scope`.
  const url = new URL(OAUTH_DIALOG);
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("redirect_uri", requireEnv("FACEBOOK_REDIRECT_URI"));
  url.searchParams.set("config_id", requireEnv("FACEBOOK_CONFIG_ID"));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export async function exchangeCodeForToken(
  code: string,
): Promise<FacebookTokenResponse> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  url.searchParams.set("redirect_uri", requireEnv("FACEBOOK_REDIRECT_URI"));
  url.searchParams.set("code", code);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha ao trocar code por token: ${res.status} ${body}`);
  }
  return res.json();
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<FacebookTokenResponse> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha ao gerar long-lived token: ${res.status} ${body}`);
  }
  return res.json();
}

export interface FacebookUserInfo {
  id: string;
  name: string;
  email?: string;
  picture?: {
    data: {
      url: string;
    };
  };
}

export async function getUserInfo(
  accessToken: string,
): Promise<FacebookUserInfo> {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "id,name,email,picture.type(large)");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha ao buscar /me: ${res.status} ${body}`);
  }
  return res.json();
}
