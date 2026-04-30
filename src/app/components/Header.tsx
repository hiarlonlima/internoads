import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold tracking-tight">Interno ADS</h1>
          <nav className="flex items-center gap-1">
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/comparar">Comparar</NavLink>
            <NavLink href="/contas">Contas</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <NavLink href="/set-password">Senha</NavLink>
          <Link
            href="/api/auth/logout"
            className="text-sm text-zinc-400 hover:text-zinc-100"
          >
            Sair
          </Link>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-md transition-colors"
    >
      {children}
    </Link>
  );
}
