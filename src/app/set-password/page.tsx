import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { setPasswordAction } from "@/app/actions/auth";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) redirect("/login");

  const params = await searchParams;
  const error = params.error;
  const ok = params.ok === "1";
  const hasPassword = !!user.passwordHash;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold">
            {hasPassword ? "Atualizar senha" : "Definir senha"}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {hasPassword
              ? "Mude sua senha de acesso ao Interno ADS."
              : "Crie um email e senha pra acessar o Interno ADS de qualquer dispositivo (sem precisar relogar com Facebook toda vez)."}
          </p>
        </div>

        {ok && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-sm text-emerald-300">
            ✓ Senha {hasPassword ? "atualizada" : "definida"} com sucesso!{" "}
            <Link href="/" className="underline">
              Voltar pro dashboard
            </Link>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
            {decodeURIComponent(error)}
          </div>
        )}

        <form
          action={async (formData) => {
            "use server";
            const result = await setPasswordAction(formData);
            if (result.ok) {
              redirect("/set-password?ok=1");
            } else {
              redirect(
                `/set-password?error=${encodeURIComponent(result.error ?? "erro")}`,
              );
            }
          }}
          className="space-y-4 bg-zinc-900 rounded-xl p-6 border border-zinc-800"
        >
          <div>
            <label
              htmlFor="email"
              className="block text-xs text-zinc-500 uppercase tracking-wider mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              defaultValue={user.email ?? ""}
              placeholder="seu@email.com"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs text-zinc-500 uppercase tracking-wider mb-1"
            >
              {hasPassword ? "Nova senha" : "Senha"}
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              minLength={8}
              placeholder="mínimo 8 caracteres"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="confirm"
              className="block text-xs text-zinc-500 uppercase tracking-wider mb-1"
            >
              Confirmar senha
            </label>
            <input
              id="confirm"
              type="password"
              name="confirm"
              required
              minLength={8}
              placeholder="repita a senha"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <Link
              href="/"
              className="text-sm text-zinc-400 hover:text-zinc-100"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
            >
              {hasPassword ? "Atualizar senha" : "Definir senha"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
