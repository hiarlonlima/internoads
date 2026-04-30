import { prisma } from "@/lib/prisma";
import { setSessionOnResponse } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import { relativeRedirect } from "@/lib/redirect";

/**
 * Login com email + senha. Route handler com redirect RELATIVO pra evitar
 * problema de Vercel routing (cookie setado na alias mas redirect indo pro
 * deployment URL hash, perdendo o cookie).
 */
export async function POST(req: Request) {
  const formData = await req.formData();
  const email =
    formData.get("email")?.toString().trim().toLowerCase() ?? "";
  const password = formData.get("password")?.toString() ?? "";

  if (!email || !password) {
    return relativeRedirect(
      `/login?error=${encodeURIComponent("Email e senha são obrigatórios")}`,
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return relativeRedirect(
      `/login?error=${encodeURIComponent("Email ou senha inválidos")}`,
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return relativeRedirect(
      `/login?error=${encodeURIComponent("Email ou senha inválidos")}`,
    );
  }

  // Sucesso: redireciona pra / com cookie de sessão
  const response = relativeRedirect("/");
  return setSessionOnResponse(user.id, response);
}
