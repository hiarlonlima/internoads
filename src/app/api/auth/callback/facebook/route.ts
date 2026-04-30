import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getUserInfo,
} from "@/lib/facebook";
import { encrypt } from "@/lib/crypto";
import { setSessionOnResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const STATE_COOKIE = "oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    const desc = errorDescription ?? error;
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(desc)}`, req.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/login?error=missing_params", req.url),
    );
  }

  // Verifica CSRF state (lê via cookies() — leitura é segura)
  const cookieStore = await cookies();
  const storedState = cookieStore.get(STATE_COOKIE)?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_state", req.url),
    );
  }

  try {
    // 1. Troca o code por short-lived token (~1h)
    const shortLived = await exchangeCodeForToken(code);

    // 2. Troca short-lived por long-lived (~60 dias)
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);

    // 3. Busca info do usuário
    const userInfo = await getUserInfo(longLived.access_token);

    // 4. Upsert do usuário
    const user = await prisma.user.upsert({
      where: { facebookUserId: userInfo.id },
      create: {
        facebookUserId: userInfo.id,
        name: userInfo.name,
        email: userInfo.email,
        picture: userInfo.picture?.data?.url,
      },
      update: {
        name: userInfo.name,
        email: userInfo.email,
        picture: userInfo.picture?.data?.url,
      },
    });

    // 5. Salva token criptografado
    const expiresInSec = longLived.expires_in ?? 60 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    const encryptedToken = encrypt(longLived.access_token);

    await prisma.token.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        accessTokenEncrypted: encryptedToken,
        expiresAt,
      },
      update: {
        accessTokenEncrypted: encryptedToken,
        expiresAt,
      },
    });

    // 6. Cria response com TODAS modificações de cookie (set + delete) na
    // mesma response — não mistura cookieStore com response.cookies.
    const response = NextResponse.redirect(new URL("/", req.url));
    response.cookies.delete(STATE_COOKIE);
    return setSessionOnResponse(user.id, response);
  } catch (err) {
    console.error("OAuth callback error:", err);
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, req.url),
    );
  }
}
