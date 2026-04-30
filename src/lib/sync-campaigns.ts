// Sync de campanhas e insights por conta de anúncio

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import {
  fetchCampaigns,
  fetchCampaignInsights,
  type MetaCampaign,
  type MetaInsight,
} from "@/lib/meta-api";

// Variações de action_type que a Meta usa — em ordem de prioridade.
// Pega a primeira que tiver valor (não soma — risco de double-count).
//
// "Compras" no gerenciador de anúncios = omni_purchase (todos canais)
const ACTION_TYPES_PURCHASE = [
  "omni_purchase",
  "purchase",
  "onsite_conversion.purchase",
  "offsite_conversion.fb_pixel_purchase",
];
// "Conversas por anúncio" = messaging_conversation_started_7d
const ACTION_TYPES_MESSAGES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "messaging_first_reply",
];

function pickFirstActionValue(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: readonly string[],
): number {
  if (!actions) return 0;
  for (const type of types) {
    const row = actions.find((a) => a.action_type === type);
    if (row) {
      const val = parseFloat(row.value);
      if (val > 0) return val;
    }
  }
  return 0;
}

const CONCURRENCY = 5; // contas processadas em paralelo

export const VALID_PERIODS = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
] as const;
export type Period = (typeof VALID_PERIODS)[number];

export function isValidPeriod(p: string): p is Period {
  return (VALID_PERIODS as readonly string[]).includes(p);
}

export interface CampaignSyncResult {
  accountsProcessed: number;
  campaignsUpserted: number;
  insightsUpserted: number;
  errors: string[];
}

export async function syncCampaignsAndInsights(
  userId: string,
  options: { periods?: readonly Period[] } = {},
): Promise<CampaignSyncResult> {
  const userToken = await prisma.token.findUnique({ where: { userId } });
  if (!userToken) throw new Error("Token Meta não encontrado");
  const accessToken = decrypt(userToken.accessTokenEncrypted);

  // Por padrão sincroniza todos os períodos de uma vez (em paralelo dentro de
  // cada conta), pra trocar de filtro depois ser instantâneo.
  const periods = options.periods ?? VALID_PERIODS;

  // Pega todas as contas ATIVAS do usuário
  const accounts = await prisma.adAccount.findMany({
    where: {
      businessManager: { userId },
      accountStatus: 1, // só ATIVAS — desabilitadas não têm dados úteis
    },
  });

  const errors: string[] = [];
  let campaignsUpserted = 0;
  let insightsUpserted = 0;

  // Processa em batches de CONCURRENCY contas
  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    const batch = accounts.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (account) => {
        try {
          const result = await syncSingleAccount(
            account.id,
            account.metaAccountId,
            accessToken,
            periods,
          );
          campaignsUpserted += result.campaigns;
          insightsUpserted += result.insights;
        } catch (err) {
          errors.push(
            `${account.name} (${account.metaAccountId}): ${err instanceof Error ? err.message : "erro"}`,
          );
        }
      }),
    );
  }

  return {
    accountsProcessed: accounts.length,
    campaignsUpserted,
    insightsUpserted,
    errors,
  };
}

async function syncSingleAccount(
  internalAccountId: string,
  metaAccountId: string,
  accessToken: string,
  periods: readonly Period[],
): Promise<{ campaigns: number; insights: number }> {
  // Em paralelo: 1 chamada de campanhas + N chamadas de insights (1 por período)
  const [campaigns, ...insightsByPeriod] = await Promise.all([
    fetchCampaigns(metaAccountId, accessToken),
    ...periods.map((p) =>
      fetchCampaignInsights(metaAccountId, accessToken, { datePreset: p }),
    ),
  ]);

  let campaignsCount = 0;
  let insightsCount = 0;

  // Upsert das campanhas primeiro
  const dbCampaignsByMetaId = new Map<string, { id: string }>();
  for (const campaign of campaigns) {
    const dbCampaign = await prisma.campaign.upsert({
      where: {
        adAccountId_metaCampaignId: {
          adAccountId: internalAccountId,
          metaCampaignId: campaign.id,
        },
      },
      create: {
        adAccountId: internalAccountId,
        metaCampaignId: campaign.id,
        name: campaign.name,
        status: campaign.effective_status ?? campaign.status,
        objective: campaign.objective,
        dailyBudget: parseBudget(campaign.daily_budget),
        lifetimeBudget: parseBudget(campaign.lifetime_budget),
      },
      update: {
        name: campaign.name,
        status: campaign.effective_status ?? campaign.status,
        objective: campaign.objective,
        dailyBudget: parseBudget(campaign.daily_budget),
        lifetimeBudget: parseBudget(campaign.lifetime_budget),
        syncedAt: new Date(),
      },
    });
    dbCampaignsByMetaId.set(campaign.id, { id: dbCampaign.id });
    campaignsCount++;
  }

  // Pra cada período, upsert dos insights
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const insights = insightsByPeriod[i];

    for (const insight of insights) {
      if (!insight.campaign_id) continue;
      const dbCampaign = dbCampaignsByMetaId.get(insight.campaign_id);
      if (!dbCampaign) continue;
      await upsertInsight(dbCampaign.id, insight, period);
      insightsCount++;
    }
  }

  return { campaigns: campaignsCount, insights: insightsCount };
}

async function upsertInsight(
  campaignId: string,
  insight: MetaInsight,
  period: Period,
): Promise<void> {
  const purchases = pickFirstActionValue(insight.actions, ACTION_TYPES_PURCHASE);
  const purchaseValue = pickFirstActionValue(
    insight.action_values,
    ACTION_TYPES_PURCHASE,
  );
  const messagesInitiated = pickFirstActionValue(
    insight.actions,
    ACTION_TYPES_MESSAGES,
  );

  const spend = parseFloat(insight.spend ?? "0");
  const roas =
    insight.purchase_roas && insight.purchase_roas[0]
      ? parseFloat(insight.purchase_roas[0].value)
      : null;

  // Métricas calculadas
  const cpa = purchases > 0 ? spend / purchases : null;
  const costPerMessageInitiated =
    messagesInitiated > 0 ? spend / messagesInitiated : null;

  await prisma.insight.upsert({
    where: {
      campaignId_period: {
        campaignId,
        period,
      },
    },
    create: {
      campaignId,
      period,
      dateStart: new Date(insight.date_start),
      dateStop: new Date(insight.date_stop),
      spend,
      impressions: parseInt(insight.impressions ?? "0", 10),
      reach: parseInt(insight.reach ?? "0", 10),
      clicks: parseInt(insight.clicks ?? "0", 10),
      frequency: parseFloat(insight.frequency ?? "0"),
      cpc: insight.cpc ? parseFloat(insight.cpc) : null,
      ctr: insight.ctr ? parseFloat(insight.ctr) : null,
      cpm: insight.cpm ? parseFloat(insight.cpm) : null,
      purchases,
      purchaseValue,
      cpa,
      roas,
      messagesInitiated,
      costPerMessageInitiated,
    },
    update: {
      dateStart: new Date(insight.date_start),
      dateStop: new Date(insight.date_stop),
      spend,
      impressions: parseInt(insight.impressions ?? "0", 10),
      reach: parseInt(insight.reach ?? "0", 10),
      clicks: parseInt(insight.clicks ?? "0", 10),
      frequency: parseFloat(insight.frequency ?? "0"),
      cpc: insight.cpc ? parseFloat(insight.cpc) : null,
      ctr: insight.ctr ? parseFloat(insight.ctr) : null,
      cpm: insight.cpm ? parseFloat(insight.cpm) : null,
      purchases,
      purchaseValue,
      cpa,
      roas,
      messagesInitiated,
      costPerMessageInitiated,
      syncedAt: new Date(),
    },
  });
}

/** Meta retorna budget em CENTAVOS (string). Convertemos pra reais decimais. */
function parseBudget(budget?: string): number | null {
  if (!budget) return null;
  const cents = parseInt(budget, 10);
  if (Number.isNaN(cents)) return null;
  return cents / 100;
}

// Apenas pra evitar warnings — MetaCampaign é usado via type-only imports
export type { MetaCampaign };
