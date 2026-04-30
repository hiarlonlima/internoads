import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Header } from "@/app/components/Header";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/format";

interface SearchParams {
  period?: string;
  name?: string;
  accounts?: string | string[];
  rankBy?: string;
  objective?: string;
}

// Mapeamento de objectives da Meta pra labels amigáveis
const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: "Vendas / Compras",
  OUTCOME_LEADS: "Leads",
  OUTCOME_ENGAGEMENT: "Engajamento (Mensagens)",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_APP_PROMOTION: "App",
  // Objectives antigos (campanhas legadas)
  CONVERSIONS: "Conversões (legado)",
  MESSAGES: "Mensagens (legado)",
  LINK_CLICKS: "Cliques (legado)",
  POST_ENGAGEMENT: "Engajamento (legado)",
  PAGE_LIKES: "Curtidas (legado)",
  REACH: "Alcance (legado)",
  VIDEO_VIEWS: "Vídeo (legado)",
  LEAD_GENERATION: "Geração de leads (legado)",
};

function objectiveLabel(obj: string | null | undefined): string {
  if (!obj) return "Sem objetivo";
  return OBJECTIVE_LABELS[obj] ?? obj;
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "last_14d", label: "Últimos 14 dias" },
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "last_90d", label: "Últimos 90 dias" },
];

const PERIOD_LABELS: Record<string, string> = Object.fromEntries(
  PERIOD_OPTIONS.map((p) => [p.value, p.label]),
);

interface RankMetric {
  field: string;
  label: string;
  shortLabel: string;
  betterIs: "higher" | "lower";
  format: "currency" | "number" | "percent" | "decimal";
}

const RANK_METRICS: RankMetric[] = [
  { field: "purchases", label: "Compras (mais é melhor)", shortLabel: "compras", betterIs: "higher", format: "number" },
  { field: "cpa", label: "CPA (menor é melhor)", shortLabel: "CPA", betterIs: "lower", format: "currency" },
  { field: "purchaseValue", label: "Valor de Conversão (mais é melhor)", shortLabel: "valor de conversão", betterIs: "higher", format: "currency" },
  { field: "roas", label: "ROAS (maior é melhor)", shortLabel: "ROAS", betterIs: "higher", format: "decimal" },
  { field: "messages", label: "Conversas / Mensagens (mais é melhor)", shortLabel: "conversas", betterIs: "higher", format: "number" },
  { field: "costPerMessage", label: "Custo/conversa (menor é melhor)", shortLabel: "custo por conversa", betterIs: "lower", format: "currency" },
  { field: "cpc", label: "CPC (menor é melhor)", shortLabel: "CPC", betterIs: "lower", format: "currency" },
  { field: "ctr", label: "CTR (maior é melhor)", shortLabel: "CTR", betterIs: "higher", format: "percent" },
  { field: "cpm", label: "CPM (menor é melhor)", shortLabel: "CPM", betterIs: "lower", format: "currency" },
];

interface CampaignMetrics {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  spend: number;
  purchases: number;
  cpa: number | null;
  purchaseValue: number;
  roas: number | null;
  messages: number;
  costPerMessage: number | null;
  cpc: number | null;
  ctr: number | null;
  cpm: number | null;
}

interface AccountResult {
  accountId: string;
  accountName: string;
  bmName: string;
  currency: string;
  campaigns: CampaignMetrics[];
  // Agregados da conta (pra ordenar entre contas)
  totalSpend: number;
  totalPurchases: number;
  totalPurchaseValue: number;
  totalMessages: number;
  totalImpressions: number;
  totalClicks: number;
  aggCpa: number | null;
  aggRoas: number | null;
  aggCostPerMessage: number | null;
  aggCpc: number | null;
  aggCtr: number | null;
  aggCpm: number | null;
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function CompararPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const period = params.period ?? "last_30d";
  const periodLabel = PERIOD_LABELS[period] ?? period;
  const nameFilter = params.name?.trim() ?? "";
  // Quebra por vírgula: cada palavra é um termo OR. "CONVERSÃO,CONVERSÕES,CONVERSAS"
  // vira 3 termos buscados em paralelo (match qualquer um).
  const nameKeywords = nameFilter
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const objectiveFilter = params.objective ?? "";
  const selectedAccountIds = toArray(params.accounts);
  const rankByField = params.rankBy ?? "purchases";
  const rankMetric =
    RANK_METRICS.find((m) => m.field === rankByField) ?? RANK_METRICS[0];

  // Extrai palavras-chave dos nomes das campanhas das contas selecionadas
  // (split por | e por outros separadores). Ordena por frequência.
  let nameKeywordChips: Array<{ keyword: string; count: number }> = [];
  if (selectedAccountIds.length > 0) {
    const campaignsForChips = await prisma.campaign.findMany({
      where: {
        adAccountId: { in: selectedAccountIds },
        status: { notIn: ["DELETED", "ARCHIVED"] },
      },
      select: { name: true },
    });
    const keywordCounts = new Map<string, number>();
    for (const c of campaignsForChips) {
      const tokens = c.name
        .split(/[|\-_,/]/)
        .map((t) => t.trim())
        .filter((t) => {
          if (t.length < 3 || t.length > 30) return false;
          // Ignora tokens só com números/símbolos (ex: "30/04", "1-3-1")
          if (!/[a-zA-ZÀ-ú]/.test(t)) return false;
          return true;
        });
      const seen = new Set<string>();
      for (const t of tokens) {
        const norm = t.toUpperCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        keywordCounts.set(norm, (keywordCounts.get(norm) ?? 0) + 1);
      }
    }
    nameKeywordChips = Array.from(keywordCounts.entries())
      .filter(([, c]) => c >= 2) // pelo menos 2 campanhas têm a palavra
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 16);
  }

  // Helper: constrói URL SUBSTITUINDO o filtro de nome pelo keyword.
  // Se o keyword já é o único filtro ativo, limpa (toggle off). Senão, substitui.
  function buildSetNameUrl(keyword: string): string {
    const isExclusivelyActive =
      nameKeywords.length === 1 &&
      nameKeywords[0].toUpperCase() === keyword.toUpperCase();

    const sp = new URLSearchParams();
    sp.set("period", period);
    if (objectiveFilter) sp.set("objective", objectiveFilter);
    if (rankByField !== "purchases") sp.set("rankBy", rankByField);
    for (const id of selectedAccountIds) sp.append("accounts", id);
    if (!isExclusivelyActive) sp.set("name", keyword);
    return `/comparar?${sp.toString()}`;
  }

  // URL pra limpar todos os keywords
  function buildClearNameUrl(): string {
    const sp = new URLSearchParams();
    sp.set("period", period);
    if (objectiveFilter) sp.set("objective", objectiveFilter);
    if (rankByField !== "purchases") sp.set("rankBy", rankByField);
    for (const id of selectedAccountIds) sp.append("accounts", id);
    return `/comparar?${sp.toString()}`;
  }

  // Lista de objectives existentes nas campanhas do usuário (pra popular o filtro)
  const availableObjectives = await prisma.campaign.findMany({
    where: {
      adAccount: { businessManager: { userId: session.userId } },
      objective: { not: null },
      status: { notIn: ["DELETED", "ARCHIVED"] },
    },
    select: { objective: true },
    distinct: ["objective"],
    orderBy: { objective: "asc" },
  });
  const objectiveOptions = availableObjectives
    .map((o) => o.objective)
    .filter((o): o is string => o !== null)
    .map((o) => ({ value: o, label: objectiveLabel(o) }));

  // BMs e contas pra os checkboxes
  const businessManagers = await prisma.businessManager.findMany({
    where: { userId: session.userId },
    include: {
      adAccounts: {
        where: { accountStatus: 1 },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  // Busca campanhas + insights pras contas selecionadas
  let results: AccountResult[] = [];
  if (selectedAccountIds.length > 0) {
    const campaigns = await prisma.campaign.findMany({
      where: {
        adAccountId: { in: selectedAccountIds },
        status: { notIn: ["DELETED", "ARCHIVED"] },
        // OR entre keywords: nome contém QUALQUER um dos termos digitados
        ...(nameKeywords.length > 0 && {
          OR: nameKeywords.map((k) => ({
            name: { contains: k, mode: "insensitive" as const },
          })),
        }),
        ...(objectiveFilter && { objective: objectiveFilter }),
      },
      include: {
        adAccount: { include: { businessManager: true } },
        insights: { where: { period } },
      },
      orderBy: { name: "asc" },
    });

    const byAccount = new Map<
      string,
      {
        account: (typeof campaigns)[number]["adAccount"];
        campaigns: typeof campaigns;
      }
    >();
    for (const c of campaigns) {
      if (!byAccount.has(c.adAccount.id)) {
        byAccount.set(c.adAccount.id, {
          account: c.adAccount,
          campaigns: [],
        });
      }
      byAccount.get(c.adAccount.id)!.campaigns.push(c);
    }

    // Garante que contas selecionadas sem match também aparecem
    for (const accId of selectedAccountIds) {
      if (byAccount.has(accId)) continue;
      const acc = businessManagers
        .flatMap((bm) => bm.adAccounts)
        .find((a) => a.id === accId);
      if (acc) {
        const bmFull = businessManagers.find((bm) =>
          bm.adAccounts.some((a) => a.id === accId),
        )!;
        byAccount.set(accId, {
          account: { ...acc, businessManager: bmFull },
          campaigns: [],
        });
      }
    }

    results = Array.from(byAccount.values()).map(
      ({ account, campaigns: campaignList }) => {
        let totalSpend = 0;
        let totalPurchases = 0;
        let totalPurchaseValue = 0;
        let totalMessages = 0;
        let totalImpressions = 0;
        let totalClicks = 0;

        const campaignMetrics: CampaignMetrics[] = campaignList.map((c) => {
          const ins = c.insights[0];
          const cSpend = ins ? Number(ins.spend) : 0;
          const cPurchases = ins?.purchases ?? 0;
          const cPurchaseValue = ins ? Number(ins.purchaseValue) : 0;
          const cMessages = ins?.messagesInitiated ?? 0;
          const cImpressions = ins?.impressions ?? 0;
          const cClicks = ins?.clicks ?? 0;

          totalSpend += cSpend;
          totalPurchases += cPurchases;
          totalPurchaseValue += cPurchaseValue;
          totalMessages += cMessages;
          totalImpressions += cImpressions;
          totalClicks += cClicks;

          return {
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective,
            spend: cSpend,
            purchases: cPurchases,
            cpa: cPurchases > 0 ? cSpend / cPurchases : null,
            purchaseValue: cPurchaseValue,
            roas: cSpend > 0 && cPurchaseValue > 0 ? cPurchaseValue / cSpend : null,
            messages: cMessages,
            costPerMessage: cMessages > 0 ? cSpend / cMessages : null,
            cpc: ins?.cpc ? Number(ins.cpc) : null,
            ctr: ins?.ctr ? Number(ins.ctr) : null,
            cpm: ins?.cpm ? Number(ins.cpm) : null,
          };
        });

        // Sort campanhas dentro da conta pela mesma métrica de ranking
        campaignMetrics.sort((a, b) => {
          const av = a[rankMetric.field as keyof CampaignMetrics] as
            | number
            | null;
          const bv = b[rankMetric.field as keyof CampaignMetrics] as
            | number
            | null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return rankMetric.betterIs === "higher" ? bv - av : av - bv;
        });

        return {
          accountId: account.id,
          accountName: account.name,
          bmName: account.businessManager.name,
          currency: account.currency,
          campaigns: campaignMetrics,
          totalSpend,
          totalPurchases,
          totalPurchaseValue,
          totalMessages,
          totalImpressions,
          totalClicks,
          aggCpa: totalPurchases > 0 ? totalSpend / totalPurchases : null,
          aggRoas:
            totalSpend > 0 && totalPurchaseValue > 0
              ? totalPurchaseValue / totalSpend
              : null,
          aggCostPerMessage:
            totalMessages > 0 ? totalSpend / totalMessages : null,
          aggCpc: totalClicks > 0 ? totalSpend / totalClicks : null,
          aggCtr:
            totalImpressions > 0
              ? (totalClicks / totalImpressions) * 100
              : null,
          aggCpm:
            totalImpressions > 0
              ? (totalSpend / totalImpressions) * 1000
              : null,
        };
      },
    );

    // Sort contas (melhor → pior) pela métrica de ranking AGREGADA
    results.sort((a, b) => {
      const av = pickAggregateValue(a, rankMetric.field);
      const bv = pickAggregateValue(b, rankMetric.field);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return rankMetric.betterIs === "higher" ? bv - av : av - bv;
    });
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Comparar contas</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Selecione contas (ou BMs inteiras), opcionalmente filtre por nome
            de campanha, e veja qual conta tá performando melhor.
          </p>
        </div>

        {/* Form de seleção (colapsável) */}
        <details
          open={selectedAccountIds.length === 0}
          className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden group"
        >
          <summary className="px-5 py-3 cursor-pointer flex items-center justify-between hover:bg-zinc-900/70 list-none [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-3">
              <span className="text-zinc-400 group-open:rotate-90 transition-transform">
                ▶
              </span>
              <span className="font-semibold">Filtros e seleção de contas</span>
              {selectedAccountIds.length > 0 && (
                <span className="text-xs text-zinc-500">
                  · {selectedAccountIds.length} conta
                  {selectedAccountIds.length === 1 ? "" : "s"} ·{" "}
                  {periodLabel}
                  {nameFilter && ` · "${nameFilter}"`}
                  {objectiveFilter && ` · ${objectiveLabel(objectiveFilter)}`}
                </span>
              )}
            </div>
            <span className="text-xs text-zinc-500 group-open:hidden">
              clique pra abrir
            </span>
            <span className="text-xs text-zinc-500 hidden group-open:inline">
              clique pra recolher
            </span>
          </summary>

          <form
            method="get"
            action="/comparar"
            className="px-5 pb-5 pt-2 border-t border-zinc-800 space-y-5"
          >
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect
              name="period"
              label="Período"
              defaultValue={period}
              options={PERIOD_OPTIONS}
            />
            <FilterSelect
              name="objective"
              label="Objetivo"
              defaultValue={objectiveFilter}
              options={[
                { value: "", label: "Todos os objetivos" },
                ...objectiveOptions,
              ]}
            />
            <FilterSelect
              name="rankBy"
              label="Ordenar por"
              defaultValue={rankByField}
              options={RANK_METRICS.map((m) => ({
                value: m.field,
                label: m.label,
              }))}
            />
            <div className="flex flex-col gap-1 flex-1 min-w-[280px]">
              <label
                htmlFor="cmp-name"
                className="text-xs text-zinc-500 uppercase tracking-wider"
              >
                Filtrar por nome — separe variações com vírgula
              </label>
              <input
                id="cmp-name"
                type="text"
                name="name"
                defaultValue={nameFilter}
                placeholder="ex: CONVERSÃO, CONVERSÕES, CONVERSAS"
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {/* Chips de palavras-chave (auto-detectadas das campanhas) */}
          {nameKeywordChips.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
                Palavras-chave nos nomes (clique pra filtrar — substitui o
                filtro atual)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {nameKeywords.length > 0 && (
                  <Link
                    href={buildClearNameUrl()}
                    className="text-xs px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    × limpar
                  </Link>
                )}
                {nameKeywordChips.map(({ keyword, count }) => {
                  const isActive =
                    nameKeywords.length === 1 &&
                    nameKeywords[0].toUpperCase() === keyword.toUpperCase();
                  return (
                    <Link
                      key={keyword}
                      href={buildSetNameUrl(keyword)}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {keyword}{" "}
                      <span className="opacity-60">({count})</span>
                    </Link>
                  );
                })}
              </div>
              {nameKeywords.length > 1 && (
                <p className="text-xs text-amber-400/80 mt-2">
                  Filtrando por <strong>{nameKeywords.length} palavras</strong>{" "}
                  (OR via vírgula no input):{" "}
                  {nameKeywords.map((k) => `"${k}"`).join(", ")}. Pra usar só
                  uma, clique num chip ou limpe e digite só uma palavra.
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
              Contas pra comparar ({selectedAccountIds.length} selecionadas)
            </p>
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2 border border-zinc-800 rounded-lg p-3 bg-zinc-950/50">
              {businessManagers.map((bm) => {
                if (bm.adAccounts.length === 0) return null;
                const bmAllChecked = bm.adAccounts.every((a) =>
                  selectedAccountIds.includes(a.id),
                );
                return (
                  <div
                    key={bm.id}
                    className="border-b border-zinc-800/50 pb-3 last:border-0 last:pb-0"
                  >
                    <label className="flex items-center gap-2 text-sm font-medium text-zinc-200 mb-1.5 cursor-pointer hover:text-white">
                      <input
                        type="checkbox"
                        data-bm-toggle={bm.id}
                        defaultChecked={bmAllChecked}
                        className="accent-blue-600"
                      />
                      <span>{bm.name}</span>
                      <span className="text-xs text-zinc-500 font-normal">
                        ({bm.adAccounts.length})
                      </span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 ml-6">
                      {bm.adAccounts.map((acc) => (
                        <label
                          key={acc.id}
                          className="flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100 cursor-pointer px-2 py-1 rounded hover:bg-zinc-900"
                        >
                          <input
                            type="checkbox"
                            name="accounts"
                            value={acc.id}
                            data-bm={bm.id}
                            defaultChecked={selectedAccountIds.includes(acc.id)}
                            className="accent-blue-600"
                          />
                          <span className="truncate">{acc.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              Período: <strong>{periodLabel}</strong>
              {objectiveFilter && (
                <> · Objetivo: {objectiveLabel(objectiveFilter)}</>
              )}
              {nameFilter && (
                <> · Nome contém "{nameFilter}"</>
              )}
            </p>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
            >
              Comparar
            </button>
          </div>
          </form>
        </details>

        {/* Script: BM checkbox seleciona/desmarca todas as contas */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                document.querySelectorAll('[data-bm-toggle]').forEach(function(bmCb) {
                  var bmId = bmCb.getAttribute('data-bm-toggle');
                  var accCbs = document.querySelectorAll('[data-bm="' + bmId + '"]');

                  bmCb.addEventListener('change', function() {
                    accCbs.forEach(function(acc) { acc.checked = bmCb.checked; });
                  });

                  accCbs.forEach(function(acc) {
                    acc.addEventListener('change', function() {
                      var allChecked = Array.from(accCbs).every(function(a) { return a.checked; });
                      var noneChecked = Array.from(accCbs).every(function(a) { return !a.checked; });
                      bmCb.checked = allChecked;
                      bmCb.indeterminate = !allChecked && !noneChecked;
                    });
                  });

                  var allChecked = Array.from(accCbs).every(function(a) { return a.checked; });
                  var noneChecked = Array.from(accCbs).every(function(a) { return !a.checked; });
                  bmCb.indeterminate = !allChecked && !noneChecked;
                });
              })();
            `,
          }}
        />

        {/* Resultados */}
        {selectedAccountIds.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl p-8 border border-zinc-800 text-center text-sm text-zinc-500">
            Selecione pelo menos uma conta (ou marque uma BM inteira) e clique
            em Comparar.
          </div>
        ) : results.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl p-8 border border-zinc-800 text-center text-sm text-zinc-500">
            Nenhuma campanha encontrada nas contas selecionadas com os filtros.
          </div>
        ) : (
          <>
            <div className="space-y-5">
              {results.map((r, idx) => (
                <AccountSection
                  key={r.accountId}
                  result={r}
                  rank={idx + 1}
                  rankMetric={rankMetric}
                  isWinner={
                    idx === 0 &&
                    pickAggregateValue(r, rankMetric.field) !== null
                  }
                />
              ))}
            </div>

            <Summary
              results={results}
              rankMetric={rankMetric}
              nameFilter={nameFilter}
              periodLabel={periodLabel}
            />
          </>
        )}
      </main>
    </div>
  );
}

function pickAggregateValue(r: AccountResult, field: string): number | null {
  switch (field) {
    case "purchases":
      return r.totalPurchases;
    case "cpa":
      return r.aggCpa;
    case "purchaseValue":
      return r.totalPurchaseValue || null;
    case "roas":
      return r.aggRoas;
    case "messages":
      return r.totalMessages;
    case "costPerMessage":
      return r.aggCostPerMessage;
    case "cpc":
      return r.aggCpc;
    case "ctr":
      return r.aggCtr;
    case "cpm":
      return r.aggCpm;
    default:
      return null;
  }
}

function AccountSection({
  result,
  rank,
  rankMetric,
  isWinner,
}: {
  result: AccountResult;
  rank: number;
  rankMetric: RankMetric;
  isWinner: boolean;
}) {
  const aggValue = pickAggregateValue(result, rankMetric.field);

  return (
    <div
      className={`rounded-xl border ${
        isWinner
          ? "bg-emerald-500/5 border-emerald-500/30"
          : "bg-zinc-900 border-zinc-800"
      } overflow-hidden`}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
              isWinner
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {isWinner ? "🏆" : `#${rank}`}
          </div>
          <div>
            <h3 className="font-semibold text-lg">{result.accountName}</h3>
            <p className="text-xs text-zinc-500">
              {result.bmName} · {result.campaigns.length}{" "}
              {result.campaigns.length === 1 ? "campanha" : "campanhas"} ·{" "}
              {formatCurrency(result.totalSpend, result.currency)} spend
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <Stat label="Compras" value={formatNumber(result.totalPurchases)} />
          <Stat
            label="CPA"
            value={formatCurrency(result.aggCpa, result.currency)}
          />
          <Stat label="Msgs" value={formatNumber(result.totalMessages)} />
          <Stat
            label="$/Msg"
            value={formatCurrency(result.aggCostPerMessage, result.currency)}
          />
          {aggValue !== null && (
            <div className="border-l border-zinc-800 pl-6">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                {rankMetric.shortLabel}
              </p>
              <p
                className={`text-xl font-bold ${
                  isWinner ? "text-emerald-400" : "text-zinc-100"
                }`}
              >
                {formatMetric(aggValue, rankMetric, result.currency)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tabela de campanhas */}
      {result.campaigns.length === 0 ? (
        <div className="p-6 text-center text-sm text-zinc-500">
          Nenhuma campanha (com os filtros aplicados) nessa conta.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Campanha</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Spend</th>
                <th className="text-right px-4 py-2 font-medium">Compras</th>
                <th className="text-right px-4 py-2 font-medium">CPA</th>
                <th className="text-right px-4 py-2 font-medium">Conv. Value</th>
                <th className="text-right px-4 py-2 font-medium">ROAS</th>
                <th className="text-right px-4 py-2 font-medium">Conversas</th>
                <th className="text-right px-4 py-2 font-medium">$/Conv.</th>
                <th className="text-right px-4 py-2 font-medium">CPC</th>
                <th className="text-right px-4 py-2 font-medium">CTR</th>
                <th className="text-right px-4 py-2 font-medium">CPM</th>
              </tr>
            </thead>
            <tbody>
              {result.campaigns.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-zinc-800 hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-2 max-w-md">
                    <div className="truncate" title={c.name}>
                      {c.name}
                    </div>
                    {c.objective && (
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {objectiveLabel(c.objective)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatCurrency(c.spend, result.currency)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatNumber(c.purchases)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(c.cpa, result.currency)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(
                      c.purchaseValue > 0 ? c.purchaseValue : null,
                      result.currency,
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RoasCell value={c.roas} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatNumber(c.messages)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(c.costPerMessage, result.currency)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {formatCurrency(c.cpc, result.currency)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {formatPercent(c.ctr)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {formatCurrency(c.cpm, result.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-sm font-medium text-zinc-200 mt-0.5">{value}</p>
    </div>
  );
}

function RoasCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-500">—</span>;
  const cls =
    value >= 2
      ? "text-emerald-400"
      : value >= 1
        ? "text-zinc-200"
        : "text-red-400";
  return (
    <span className={cls}>
      {value.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </span>
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

function formatMetric(
  value: number,
  metric: RankMetric,
  currency: string,
): string {
  if (metric.format === "currency") return formatCurrency(value, currency);
  if (metric.format === "percent") return formatPercent(value);
  if (metric.format === "decimal")
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return formatNumber(value);
}

function Summary({
  results,
  rankMetric,
  nameFilter,
  periodLabel,
}: {
  results: AccountResult[];
  rankMetric: RankMetric;
  nameFilter: string;
  periodLabel: string;
}) {
  // Filtra contas que têm valor REAL na métrica (não null E não 0).
  // 0 não é um winner significativo — descarta.
  const validResults = results.filter((r) => {
    const v = pickAggregateValue(r, rankMetric.field);
    return v !== null && v !== 0;
  });

  // Estado: ninguém tem dados reais
  if (validResults.length === 0) {
    const hasAnySpend = results.some((r) => r.totalSpend > 0);
    return (
      <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 space-y-2">
        <p className="text-sm text-zinc-300">
          Nenhuma das contas selecionadas teve{" "}
          <strong>{rankMetric.shortLabel}</strong> em <strong>{periodLabel}</strong>
          {nameFilter && (
            <>
              {" "}com o filtro <strong>"{nameFilter}"</strong>
            </>
          )}
          .
        </p>
        <p className="text-xs text-zinc-500">
          {hasAnySpend
            ? "As campanhas filtradas têm spend mas não geraram essa métrica nesse período. Tente uma janela mais ampla (7 ou 30 dias) ou outra métrica de ranking."
            : "Nenhuma campanha filtrada teve spend nesse período. Tente uma janela maior (7d / 30d) ou clique em Sincronizar pra puxar dados frescos."}
        </p>
      </div>
    );
  }

  const winner = validResults[0];
  const winnerValue = pickAggregateValue(winner, rankMetric.field);

  // Média das outras (ignora 0/null)
  const others = validResults.slice(1);
  const avgOthers =
    others.length > 0
      ? others.reduce(
          (sum, r) => sum + (pickAggregateValue(r, rankMetric.field) ?? 0),
          0,
        ) / others.length
      : null;

  let comparison = "";
  if (avgOthers !== null && winnerValue !== null && avgOthers !== 0) {
    if (rankMetric.betterIs === "higher") {
      const pct = (((winnerValue - avgOthers) / avgOthers) * 100).toFixed(0);
      comparison = ` — ${pct}% acima da média das outras`;
    } else {
      const pct = (((avgOthers - winnerValue) / avgOthers) * 100).toFixed(0);
      comparison = ` — ${pct}% abaixo da média das outras`;
    }
  }

  return (
    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-5">
      <p className="text-sm text-emerald-300 leading-relaxed">
        <span className="text-2xl mr-1">🎯</span>
        {nameFilter ? (
          <>
            Suas campanhas com <strong>"{nameFilter}"</strong> no nome estão
            performando melhor na conta{" "}
          </>
        ) : (
          <>Suas campanhas estão performando melhor na conta </>
        )}
        <strong className="text-emerald-200">{winner.accountName}</strong> (
        {winner.bmName})
        {winnerValue !== null && (
          <>
            , com <strong>{rankMetric.shortLabel}</strong> de{" "}
            <strong>
              {formatMetric(winnerValue, rankMetric, winner.currency)}
            </strong>
            {comparison}
          </>
        )}
        . Período: {periodLabel}.
        {validResults.length < results.length && (
          <span className="block text-xs text-emerald-400/70 mt-1">
            ({results.length - validResults.length} conta
            {results.length - validResults.length === 1 ? "" : "s"} sem dados
            de {rankMetric.shortLabel} foi
            {results.length - validResults.length === 1 ? "" : "ram"}{" "}
            ignorada{results.length - validResults.length === 1 ? "" : "s"} no
            ranking)
          </span>
        )}
      </p>
    </div>
  );
}

function FilterSelect({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`cmp-${name}`}
        className="text-xs text-zinc-500 uppercase tracking-wider"
      >
        {label}
      </label>
      <select
        id={`cmp-${name}`}
        name={name}
        defaultValue={defaultValue}
        className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600 min-w-[180px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
