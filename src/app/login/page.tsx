import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { loginWithPasswordAction } from "@/app/actions/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/");

  const params = await searchParams;
  const error = params.error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Interno ADS</h1>
          <p className="text-zinc-400 mt-2 text-sm">
            Dashboard interno de campanhas Meta
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
            {decodeURIComponent(error)}
          </div>
        )}

        {/* Login email + senha */}
        <form
          action={loginWithPasswordAction}
          className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 space-y-4"
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
              autoComplete="email"
              placeholder="seu@email.com"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs text-zinc-500 uppercase tracking-wider mb-1"
            >
              Senha
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="sua senha"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            Entrar
          </button>
        </form>

        {/* Divisor */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-zinc-950 px-2 text-zinc-500">ou</span>
          </div>
        </div>

        {/* Login Facebook */}
        <Link
          href="/api/auth/login"
          className="flex items-center justify-center gap-3 w-full bg-[#1877F2] hover:bg-[#166FE5] text-white font-medium px-6 py-3 rounded-lg transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 12.073z" />
          </svg>
          Continuar com Facebook
        </Link>

        <p className="text-xs text-zinc-500 text-center">
          Primeira vez aqui? Logue com Facebook pra criar sua conta. Depois
          defina uma senha em <strong>Configurações</strong> pra usar
          email/senha.
        </p>
      </div>
    </div>
  );
}
