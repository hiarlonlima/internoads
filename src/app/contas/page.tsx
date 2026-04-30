import { redirect } from "next/navigation";
import Image from "next/image";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Header } from "@/app/components/Header";

const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: "Ativa",
  2: "Desabilitada",
  3: "Não resolvida",
  7: "Pendente de verificação",
  8: "Em revisão",
  9: "Em conformidade",
  100: "Pendente de fechamento",
  101: "Fechada",
  201: "Qualquer ativa",
  202: "Qualquer fechada",
};

export default async function ContasPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { token: true },
  });
  if (!user) redirect("/login");

  const businessManagers = await prisma.businessManager.findMany({
    where: { userId: user.id },
    include: {
      adAccounts: { orderBy: { name: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  const totalAccounts = businessManagers.reduce(
    (sum, bm) => sum + bm.adAccounts.length,
    0,
  );

  const lastSync = businessManagers.reduce<Date | null>((latest, bm) => {
    if (!latest || bm.syncedAt > latest) return bm.syncedAt;
    return latest;
  }, null);

  const daysUntilExpiry = user.token
    ? Math.floor(
        (user.token.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {/* User card */}
        <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
          <div className="flex items-center gap-4">
            {user.picture && (
              <Image
                src={user.picture}
                alt={user.name}
                width={56}
                height={56}
                className="rounded-full"
                unoptimized
              />
            )}
            <div className="flex-1">
              <p className="text-lg font-semibold">{user.name}</p>
              {user.email && (
                <p className="text-sm text-zinc-400">{user.email}</p>
              )}
            </div>
            {daysUntilExpiry !== null && (
              <div className="text-right text-xs text-zinc-500">
                Token Meta: <br />
                <span className="text-zinc-300 font-medium">
                  {daysUntilExpiry}d restantes
                </span>
              </div>
            )}
          </div>
        </div>

        {/* BMs e contas */}
        <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Business Managers e contas</h2>
            <p className="text-sm text-zinc-400">
              {businessManagers.length} BMs · {totalAccounts} contas
              {lastSync && (
                <>
                  {" · "}
                  <span className="text-zinc-500">
                    última sync:{" "}
                    {lastSync.toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </>
              )}
            </p>
          </div>

          {businessManagers.length === 0 ? (
            <p className="text-sm text-zinc-500 italic">
              Nenhuma BM sincronizada ainda. Volte ao Dashboard e clique em
              Sincronizar.
            </p>
          ) : (
            <div className="space-y-4">
              {businessManagers.map((bm) => (
                <div
                  key={bm.id}
                  className="border border-zinc-800 rounded-lg overflow-hidden"
                >
                  <div className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{bm.name}</p>
                      <p className="text-xs text-zinc-500 font-mono">
                        ID: {bm.metaBusinessId}
                      </p>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {bm.adAccounts.length}{" "}
                      {bm.adAccounts.length === 1 ? "conta" : "contas"}
                    </span>
                  </div>
                  {bm.adAccounts.length > 0 && (
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-950 text-zinc-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium">
                            Conta
                          </th>
                          <th className="text-left px-4 py-2 font-medium">
                            ID
                          </th>
                          <th className="text-left px-4 py-2 font-medium">
                            Status
                          </th>
                          <th className="text-left px-4 py-2 font-medium">
                            Moeda
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {bm.adAccounts.map((acc) => (
                          <tr
                            key={acc.id}
                            className="border-t border-zinc-800 hover:bg-zinc-900/50"
                          >
                            <td className="px-4 py-2">{acc.name}</td>
                            <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                              {acc.metaAccountId}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={
                                  acc.accountStatus === 1
                                    ? "text-emerald-400"
                                    : "text-zinc-500"
                                }
                              >
                                {ACCOUNT_STATUS_LABEL[acc.accountStatus] ??
                                  `Status ${acc.accountStatus}`}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-zinc-400">
                              {acc.currency}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
