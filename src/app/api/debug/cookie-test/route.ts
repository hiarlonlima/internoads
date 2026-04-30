import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Debug: testa se cookies estão sendo setados/lidos em produção.
 * Visite GET → seta um cookie de teste.
 * Visite GET de novo → deve retornar o cookie lido.
 */
export async function GET() {
  const cookieStore = await cookies();
  const existing = cookieStore.get("test_cookie")?.value;

  // Cria response com cookie setado de 3 formas diferentes
  const response = NextResponse.json({
    method: "GET /api/debug/cookie-test",
    nodeEnv: process.env.NODE_ENV,
    cookieRead: existing ?? "NOT_PRESENT",
    setCookieMethods: [
      "1. response.cookies.set()",
      "2. response.headers.append('Set-Cookie', raw)",
    ],
    instructions:
      "Visite essa URL, depois recarregue. Se o cookieRead mostrar o valor da primeira vez, cookies funcionam. Se NOT_PRESENT, há um bug.",
  });

  // Método 1: API do NextResponse
  response.cookies.set("test_cookie", `set-at-${Date.now()}`, {
    httpOnly: false, // não-httpOnly pra você ver no JS document.cookie também
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 5, // 5 minutos
    path: "/",
  });

  // Método 2: header Set-Cookie raw como redundância
  const rawCookie = `test_cookie_raw=raw-${Date.now()}; Path=/; SameSite=Lax; Max-Age=300${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
  response.headers.append("Set-Cookie", rawCookie);

  return response;
}
