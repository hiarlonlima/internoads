import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";

// Nome único do cookie pra evitar conflito com cookies que Vercel ou outras
// libs possam setar com nome genérico "session".
export const SESSION_COOKIE = "iads_session";
const SESSION_DURATION_DAYS = 30;

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET não está definida");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * SESSION_DURATION_DAYS,
  path: "/",
};

/** Gera o JWT da sessão (sem setar cookie). */
export async function generateSessionToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(getSecret());
}

/** Cria sessão setando o cookie via cookies() (Server Actions). */
export async function createSession(userId: string): Promise<void> {
  const token = await generateSessionToken(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
}

/** Cria sessão setando o cookie direto na response (Route Handlers).
 * Usa SÓ o método header raw — `response.cookies.set` do Next.js 16 em redirects
 * 303 estava se comportando inconsistentemente em produção Vercel.
 */
export async function setSessionOnResponse(
  userId: string,
  response: NextResponse,
): Promise<NextResponse> {
  const token = await generateSessionToken(userId);
  const maxAgeSec = SESSION_COOKIE_OPTIONS.maxAge;
  const secureFlag = SESSION_COOKIE_OPTIONS.secure ? "; Secure" : "";
  const rawCookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secureFlag}; SameSite=Lax; Max-Age=${maxAgeSec}`;
  response.headers.append("Set-Cookie", rawCookie);
  console.log(
    `[session] set cookie pra user ${userId} via Set-Cookie header raw`,
  );
  return response;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    console.log("[session] read: NO cookie present");
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") {
      console.log("[session] read: cookie present but payload invalid");
      return null;
    }
    return { userId: payload.userId };
  } catch (err) {
    console.log(
      "[session] read: cookie present but JWT verify failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
