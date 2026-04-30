import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionOnResponse } from "@/lib/session";
import { verifyPassword } from "@/lib/password";

/**
 * Login com email + senha. Route handler (não server action) pra garantir
 * que o cookie de sessão seja setado na response (mais confiável em produção).
 */
export async function POST(req: Request) {
  const formData = await req.formData();
  const email =
    formData.get("email")?.toString().trim().toLowerCase() ?? "";
  const password = formData.get("password")?.toString() ?? "";

  if (!email || !password) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("Email e senha são obrigatórios")}`,
        req.url,
      ),
      { status: 303 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    // Mensagem genérica pra não revelar se email existe
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("Email ou senha inválidos")}`,
        req.url,
      ),
      { status: 303 },
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("Email ou senha inválidos")}`,
        req.url,
      ),
      { status: 303 },
    );
  }

  // Sucesso: redireciona pra / com cookie de sessão na response
  const response = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  return setSessionOnResponse(user.id, response);
}
