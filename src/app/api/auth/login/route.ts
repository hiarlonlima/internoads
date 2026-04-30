import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { buildOAuthUrl } from "@/lib/facebook";

const STATE_COOKIE = "oauth_state";

export async function GET() {
  // Gera CSRF state aleatório, salva em cookie, e redireciona pra Meta
  const state = crypto.randomBytes(32).toString("hex");

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutos
    path: "/",
  });

  return NextResponse.redirect(buildOAuthUrl(state));
}
