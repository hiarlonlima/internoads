import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Debug: testa cookie HttpOnly setado num redirect 303 (mesmo padrão do
 * login email/senha). Acessa este endpoint e ele:
 *   1. Lê o cookie redirect_test (se já existir, mostra valor)
 *   2. Seta um novo redirect_test
 *   3. Redireciona pra /api/debug/redirect-cookie-check
 */
export async function GET() {
  const cookieStore = await cookies();
  const existing = cookieStore.get("redirect_test")?.value;

  // Se já existe (visita após primeiro hit), mostra o valor atual
  if (existing) {
    return NextResponse.json({
      step: "second_visit_after_redirect",
      cookieRead: existing,
      message: "✓ Cookie persistiu através do redirect 303",
    });
  }

  // Primeira visita: seta cookie + redirect 303 pra mesma URL
  const value = `redirect-${Date.now()}`;
  const response = new NextResponse(null, { status: 303 });
  response.headers.set("Location", "/api/debug/redirect-cookie");
  response.headers.append(
    "Set-Cookie",
    `redirect_test=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
  );
  return response;
}
