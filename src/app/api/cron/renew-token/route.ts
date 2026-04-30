import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import { exchangeForLongLivedToken } from "@/lib/facebook";

// 60s pra processar todos os tokens (geralmente são poucos — 1 por usuário)
export const maxDuration = 60;

/**
 * Cron job: renova long-lived tokens da Meta antes de expirarem.
 * Vercel chama com Authorization: Bearer ${CRON_SECRET}.
 *
 * Roda 1x por semana via vercel.json. Como tokens duram 60 dias, isso garante
 * renovação ~8 vezes durante a vida útil do token original.
 */
export async function GET(req: Request) {
  // Autenticação: Vercel Cron envia o secret como Bearer token
  const authHeader = req.headers.get("authorization");
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expectedAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await prisma.token.findMany({});

  const results: Array<{
    userId: string;
    ok: boolean;
    error?: string;
    newExpiresAt?: string;
  }> = [];

  for (const token of tokens) {
    try {
      const currentToken = decrypt(token.accessTokenEncrypted);
      const response = await exchangeForLongLivedToken(currentToken);

      const newAccessToken = response.access_token;
      const expiresInSec = response.expires_in ?? 60 * 24 * 60 * 60;
      const newExpiresAt = new Date(Date.now() + expiresInSec * 1000);

      await prisma.token.update({
        where: { id: token.id },
        data: {
          accessTokenEncrypted: encrypt(newAccessToken),
          expiresAt: newExpiresAt,
        },
      });

      results.push({
        userId: token.userId,
        ok: true,
        newExpiresAt: newExpiresAt.toISOString(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "unknown error";
      console.error(`Token renewal failed for user ${token.userId}:`, err);
      results.push({
        userId: token.userId,
        ok: false,
        error: errorMsg,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: tokens.length,
    successCount: results.filter((r) => r.ok).length,
    failureCount: results.filter((r) => !r.ok).length,
    results,
  });
}
