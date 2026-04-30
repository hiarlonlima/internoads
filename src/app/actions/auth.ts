"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { hashPassword, validatePassword } from "@/lib/password";

export async function setPasswordAction(formData: FormData) {
  const session = await getSession();
  if (!session) return { ok: false, error: "Não autenticado" };

  const password = formData.get("password")?.toString() ?? "";
  const confirm = formData.get("confirm")?.toString() ?? "";
  const email = formData.get("email")?.toString().trim().toLowerCase() ?? "";

  if (!email || !email.includes("@")) {
    return { ok: false, error: "Email inválido" };
  }

  if (password !== confirm) {
    return { ok: false, error: "As senhas não coincidem" };
  }

  const validation = validatePassword(password);
  if (!validation.valid) {
    return { ok: false, error: validation.reason };
  }

  // Verifica se outro user já usa esse email (improvável mas possível se múltiplos
  // usuários por Facebook — não nosso caso atual, mas defesa em profundidade)
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== session.userId) {
    return {
      ok: false,
      error: "Esse email já está em uso por outra conta",
    };
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.update({
    where: { id: session.userId },
    data: { email, passwordHash },
  });

  revalidatePath("/");
  return { ok: true };
}

// loginWithPasswordAction migrado pra /api/auth/login-password (route handler)
// porque server action + redirect + cookie nem sempre persiste em produção.
