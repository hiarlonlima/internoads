import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { syncAction } from "@/app/actions/sync";
import { Header } from "@/app/components/Header";
import { Filters } from "@/app/components/Filters";
import {
  formatCurrency,
  formatNumber,
  formatDecimal,
  formatPercent,
} from "@/lib/format";

// Sync de campanhas + insights pode levar 30-60s (50 contas × 6 períodos)
export const maxDuration = 60;

interface SearchParams {
  period?: string;
  bm?: string;
  account?: string;
  status?: string;
  name?: string;
  sort?: string;
  order?: string;
}

const PERIOD_LABELS: Record<string, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last_7d: "Últimos 7 dias",
  last_14d: "Últimos 14 dias",
  last_30d: "Últimos 30 dias",
  last_90d: "Últimos 90 dias",
};

const SORTABLE_FIELDS = new Set([
  "name",
  "spend",
  "purchases",
  "cpa",
  "messagesInitiated",
  "costPerMessageInitiated",
  "impressions",
  "reach",
  "frequency",
  "cpc",
  "ctr",
  "cpm",
  "purchaseValue",
  "roas",
]);

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const period = params.period ?? "last_30d";
  const periodLabel = PERIOD_LABELS[period] ?? period;
  const bmFilter = params.bm ?? "";
  const accountFilter = params.account ?? "";
  const statusFilter = params.status ?? "all"; // padrão: todas (inclui pausadas)
  const nameFilter = params.name?.trim() ?? "";
  const sortField = params.sort ?? "spend";
  const sortOrder = params.order === "asc" ? "asc" : "desc";

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) redirect("/login");

  // Filter options pra os dropdowns
  const businessManagers = await prisma.businessManager.findMany({
    where: { userId: user.id },
    include: {
      adAccounts: {
        where: { accountStatus: 1 }, // só contas ativas pro filtro
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  // Se BM tá selecionada, mostra só contas dela. Senão, todas.
  const visibleBmsForAccounts = bmFilter
    ? businessManagers.filter((bm) => bm.id === bmFilter)
    : businessManagers;

  const adAccountOptions = visibleBmsForAccounts.flatMap((bm) =>
    bm.adAccounts.map((acc) => ({
      value: acc.id,
      label: acc.name,
    })),
  );

  // Query das campanhas baseada nos filtros.
  // "all" exclui DELETED/ARCHIVED por padrão (irrelevantes pra dashboard).
  const campaigns = await prisma.campaign.findMany({
    where: {
      adAccount: {
        businessManager: { userId: user.id },
        ...(bmFilter && { businessManagerId: bmFilter }),
      },
      ...(accountFilter && { adAccountId: accountFilter }),
      ...(statusFilter === "active"
        ? { status: "ACTIVE" }
        : { status: { notIn: ["DELETED", "ARCHIVED"] } }),
      ...(nameFilter && {
        name: { contains: nameFilter, mode: "insensitive" },
      }),
    },
    include: {
      adAccount: { include: { businessManager: true } },
      insights: {
        where: { period },
        take: 1,
      },
    },
  });

  // Conta quantas campanhas tem insight pro período (pra UI sugerir sync)
  const campaignsWithInsight = campaigns.filter(
    (c) => c.insights.length > 0,
  ).length;
  const noDataForPeriod = campaigns.length > 0 && campaignsWithInsight === 0;

  // Sort em JS (porque sort por insight metric não é trivial em Prisma)
  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const aIns = a.insights[0];
    const bIns = b.insights[0];

    let aVal: number | string;
    let bVal: number | string;

    if (sortField === "name") {
      aVal = a.name;
      bVal = b.name;
    } else {
      aVal = aIns ? Number((aIns as Record<string, unknown>)[sortField]) || 0 : 0;
      bVal = bIns ? Number((bIns as Record<string, unknown>)[sortField]) || 0 : 0;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortOrder === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }
    return sortOrder === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });

  // Stats agregados (já filtrados pelo período + filtros)
  const filteredCampaignIds = sortedCampaigns.map((c) => c.id);
  const aggregate = await prisma.insight.aggregate({
    where: {
      campaignId: { in: filteredCampaignIds },
      period,
    },
    _sum: {
      spend: true,
      purchases: true,
      purchaseValue: true,
      messagesInitiated: true,
      impressions: true,
    },
  });

  const totalSpend = Number(aggregate._sum.spend ?? 0);
  const totalPurchases = aggregate._sum.purchases ?? 0;
  const totalPurchaseValue = Number(aggregate._sum.purchaseValue ?? 0);
  const totalMessages = aggregate._sum.messagesInitiated ?? 0;
  const overallRoas =
    totalSpend > 0 ? totalPurchaseValue / totalSpend : null;
  const overallCpa = totalPurchases > 0 ? totalSpend / totalPurchases : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Stats agregadas */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard
            label={`Spend (${periodLabel})`}
            value={formatCurrency(totalSpend, "BRL", { compact: true })}
          />
          <StatCard
            label="Conversão"
            value={formatCurrency(totalPurchaseValue, "BRL", { compact: true })}
          />
          <StatCard
            label="ROAS"
            value={overallRoas !== null ? formatDecimal(overallRoas, 2) : "—"}
            highlight={overallRoas !== null && overallRoas >= 1}
          />
          <StatCard
            label="Compras"
            value={formatNumber(totalPurchases)}
            sub={overallCpa ? `CPA ${formatCurrency(overallCpa)}` : undefined}
          />
          <StatCard
            label="Mensagens"
            value={formatNumber(totalMessages)}
          />
        </div>

        {noDataForPeriod && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-300">
            Sem dados pro período "{periodLabel}". Clica em{" "}
            <strong>Sincronizar</strong> — vai puxar todos os períodos (hoje,
            ontem, 7d, 14d, 30d, 90d) de uma vez. Depois disso, trocar de
            filtro é instantâneo.
          </div>
        )}

        {/* Filtros + Sync */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 flex items-end justify-between gap-4 flex-wrap">
          <Filters
            businessManagers={businessManagers.map((bm) => ({
              value: bm.id,
              label: bm.name,
            }))}
            adAccounts={adAccountOptions}
            currentValues={{
              period,
              bm: bmFilter,
              account: accountFilter,
              status: statusFilter,
              name: nameFilter,
              sort: params.sort,
              order: params.order,
            }}
          />
          <form action={syncAction}>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm whitespace-nowrap"
            >
              Sincronizar
            </button>
          </form>
        </div>

        {/* Tabela de campanhas */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
            <h2 className="font-semibold">
              Campanhas{" "}
              <span className="text-sm text-zinc-500 font-normal">
                ({sortedCampaigns.length})
              </span>
            </h2>
            <p className="text-xs text-zinc-500">
              {periodLabel} · scroll dentro da tabela
            </p>
          </div>

          {sortedCampaigns.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              Nenhuma campanha encontrada com esses filtros.
              <br />
              Tente ajustar os filtros ou clicar em "Sincronizar".
            </div>
          ) : (
            <div
              className="overflow-auto"
              style={{ maxHeight: "calc(100vh - 360px)" }}
            >
              <table className="w-full text-sm">
                <thead className="bg-zinc-950 text-zinc-500 text-xs uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <SortHeader
                      field="name"
                      label="Campanha"
                      params={params}
                      align="left"
                    />
                    <th className="text-left px-3 py-2 font-medium">BM/Conta</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-right px-3 py-2 font-medium">
                      Orçamento
                    </th>
                    <SortHeader field="spend" label="Spend" params={params} />
                    <SortHeader
                      field="purchases"
                      label="Compras"
                      params={params}
                    />
                    <SortHeader field="cpa" label="CPA" params={params} />
                    <SortHeader
                      field="messagesInitiated"
                      label="Msgs"
                      params={params}
                    />
                    <SortHeader
                      field="costPerMessageInitiated"
                      label="$/Msg"
                      params={params}
                    />
                    <SortHeader
                      field="impressions"
                      label="Impressões"
                      params={params}
                    />
                    <SortHeader field="reach" label="Alcance" params={params} />
                    <SortHeader
                      field="frequency"
                      label="Freq."
                      params={params}
                    />
                    <SortHeader field="cpc" label="CPC" params={params} />
                    <SortHeader field="ctr" label="CTR" params={params} />
                    <SortHeader field="cpm" label="CPM" params={params} />
                    <SortHeader
                      field="purchaseValue"
                      label="Conv. Value"
                      params={params}
                    />
                    <SortHeader field="roas" label="ROAS" params={params} />
                  </tr>
                </thead>
                <tbody>
                  {sortedCampaigns.map((c) => {
                    const ins = c.insights[0];
                    const currency = c.adAccount.currency;
                    const budget = c.dailyBudget
                      ? `${formatCurrency(Number(c.dailyBudget), currency)}/dia`
                      : c.lifetimeBudget
                        ? `${formatCurrency(Number(c.lifetimeBudget), currency)} total`
                        : "—";

                    return (
                      <tr
                        key={c.id}
                        className="border-t border-zinc-800 hover:bg-zinc-900/50"
                      >
                        <td className="px-3 py-2 max-w-xs">
                          <div className="font-medium truncate" title={c.name}>
                            {c.name}
                          </div>
                          {c.objective && (
                            <div className="text-xs text-zinc-500">
                              {c.objective}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="text-zinc-300">
                            {c.adAccount.businessManager.name}
                          </div>
                          <div className="text-zinc-500">
                            {c.adAccount.name}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {budget}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatCurrency(
                            ins ? Number(ins.spend) : null,
                            currency,
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(ins?.purchases ?? null)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(
                            ins?.cpa ? Number(ins.cpa) : null,
                            currency,
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(ins?.messagesInitiated ?? null)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(
                            ins?.costPerMessageInitiated
                              ? Number(ins.costPerMessageInitiated)
                              : null,
                            currency,
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {formatNumber(ins?.impressions ?? null)}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {formatNumber(ins?.reach ?? null)}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {formatDecimal(
                            ins?.frequency ? Number(ins.frequency) : null,
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {formatCurrency(
                            ins?.cpc ? Number(ins.cpc) : null,
                            currency,
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {formatPercent(ins?.ctr ? Number(ins.ctr) : null)}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {formatCurrency(
                            ins?.cpm ? Number(ins.cpm) : null,
                            currency,
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(
                            ins?.purchaseValue
                              ? Number(ins.purchaseValue)
                              : null,
                            currency,
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          <RoasBadge value={ins?.roas ? Number(ins.roas) : null} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p
        className={`text-2xl font-bold mt-1 ${
          highlight ? "text-emerald-400" : ""
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

function SortHeader({
  field,
  label,
  params,
  align = "right",
}: {
  field: string;
  label: string;
  params: SearchParams;
  align?: "left" | "right";
}) {
  const isActive = (params.sort ?? "spend") === field;
  const currentOrder = params.order === "asc" ? "asc" : "desc";
  const nextOrder = isActive && currentOrder === "desc" ? "asc" : "desc";

  if (!SORTABLE_FIELDS.has(field)) {
    return (
      <th
        className={`px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-right"}`}
      >
        {label}
      </th>
    );
  }

  const newParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) newParams.set(k, v);
  }
  newParams.set("sort", field);
  newParams.set("order", nextOrder);

  return (
    <th
      className={`px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-right"}`}
    >
      <Link
        href={`/?${newParams.toString()}`}
        className={`hover:text-zinc-200 ${isActive ? "text-zinc-200" : ""}`}
      >
        {label}
        {isActive && (
          <span className="ml-1">{currentOrder === "asc" ? "↑" : "↓"}</span>
        )}
      </Link>
    </th>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-emerald-500/10 text-emerald-400",
    PAUSED: "bg-amber-500/10 text-amber-400",
    DELETED: "bg-red-500/10 text-red-400",
    ARCHIVED: "bg-zinc-500/10 text-zinc-400",
  };
  const cls = colors[status] ?? "bg-zinc-700/30 text-zinc-400";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function RoasBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-500">—</span>;
  const cls =
    value >= 2
      ? "text-emerald-400"
      : value >= 1
        ? "text-zinc-200"
        : "text-red-400";
  return <span className={cls}>{formatDecimal(value, 2)}</span>;
}
