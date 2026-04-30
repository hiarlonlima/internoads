import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { GRAPH_API_VERSION } from "@/lib/facebook";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "no session" }, { status: 401 });

  const tokenRecord = await prisma.token.findUnique({
    where: { userId: session.userId },
  });
  if (!tokenRecord)
    return NextResponse.json({ error: "no token saved" }, { status: 404 });

  const accessToken = decrypt(tokenRecord.accessTokenEncrypted);

  // 1. /me — testa se token é válido
  const meUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/me`);
  meUrl.searchParams.set("fields", "id,name");
  meUrl.searchParams.set("access_token", accessToken);
  const meRes = await fetch(meUrl, { cache: "no-store" });
  const me = await meRes.json();

  // 2. /me/permissions — lista permissões granted vs declined
  const permsUrl = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/permissions`,
  );
  permsUrl.searchParams.set("access_token", accessToken);
  const permsRes = await fetch(permsUrl, { cache: "no-store" });
  const perms = await permsRes.json();

  // 3. debug_token — info detalhada do token (scopes, expiração, etc)
  const debugUrl = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token`,
  );
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set(
    "access_token",
    `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`,
  );
  const debugRes = await fetch(debugUrl, { cache: "no-store" });
  const debug = await debugRes.json();

  return NextResponse.json({
    me,
    permissions: perms,
    debug_token: debug,
  });
}
