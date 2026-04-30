// Wrapper tipado da Marketing API com paginação automática

import { GRAPH_API_VERSION } from "@/lib/facebook";

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface MetaPagedResponse<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
}

interface MetaError {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

/**
 * Faz uma chamada paginada à Marketing API e retorna todos os items
 * concatenados. Segue o cursor `paging.next` automaticamente.
 */
export async function metaFetchPaginated<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const initialUrl = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    initialUrl.searchParams.set(key, value);
  }
  initialUrl.searchParams.set("access_token", accessToken);
  if (!initialUrl.searchParams.has("limit")) {
    initialUrl.searchParams.set("limit", "100");
  }

  const all: T[] = [];
  let nextUrl: string | null = initialUrl.toString();
  let pages = 0;
  const MAX_PAGES = 50; // safety guard contra loop infinito

  while (nextUrl && pages < MAX_PAGES) {
    const res = await fetch(nextUrl, { cache: "no-store" });
    const json = await res.json();

    if (!res.ok) {
      const err = json as MetaError;
      const msg = err.error?.message ?? "Erro desconhecido";
      throw new Error(`Meta API ${res.status}: ${msg}`);
    }

    const page = json as MetaPagedResponse<T>;
    all.push(...page.data);
    nextUrl = page.paging?.next ?? null;
    pages++;
  }

  return all;
}

// ====================== Tipos da Meta ======================

export interface MetaBusiness {
  id: string;
  name: string;
}

export interface MetaAdAccount {
  id: string; // formato: "act_123456789"
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
  business?: MetaBusiness; // pode ser null para contas pessoais (legacy)
}

// ====================== Endpoints ==========================

/**
 * Lista todas as contas de anúncio que o usuário tem acesso, junto com a BM
 * a que pertencem. Requer `ads_read` + `business_management`.
 */
export async function fetchAdAccountsWithBusiness(
  accessToken: string,
): Promise<MetaAdAccount[]> {
  return metaFetchPaginated<MetaAdAccount>("/me/adaccounts", accessToken, {
    fields:
      "id,name,account_status,currency,timezone_name,business{id,name}",
  });
}

// ====================== Campanhas e Insights ====================

export interface MetaCampaign {
  id: string;
  name: string;
  status: string; // ACTIVE, PAUSED, ARCHIVED, DELETED
  effective_status?: string;
  objective?: string;
  daily_budget?: string; // Meta retorna como string (cents)
  lifetime_budget?: string;
}

export interface MetaActionRow {
  action_type: string;
  value: string; // Meta retorna como string
}

export interface MetaPurchaseRoas {
  action_type: string;
  value: string;
}

export interface MetaInsight {
  campaign_id?: string;
  campaign_name?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  cpc?: string;
  ctr?: string;
  cpm?: string;
  actions?: MetaActionRow[];
  action_values?: MetaActionRow[];
  purchase_roas?: MetaPurchaseRoas[];
}

export async function fetchCampaigns(
  adAccountId: string, // formato "act_123456789"
  accessToken: string,
): Promise<MetaCampaign[]> {
  return metaFetchPaginated<MetaCampaign>(
    `/${adAccountId}/campaigns`,
    accessToken,
    {
      fields:
        "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
    },
  );
}

export interface FetchInsightsOptions {
  datePreset?: string; // ex: "last_30d", "last_7d", "yesterday"
  timeRange?: { since: string; until: string }; // ex: {since:"2026-04-01", until:"2026-04-30"}
}

export async function fetchCampaignInsights(
  adAccountId: string,
  accessToken: string,
  options: FetchInsightsOptions = { datePreset: "last_30d" },
): Promise<MetaInsight[]> {
  const params: Record<string, string> = {
    level: "campaign",
    fields:
      "campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,frequency,clicks,cpc,ctr,cpm,actions,action_values,purchase_roas",
  };

  if (options.timeRange) {
    params.time_range = JSON.stringify(options.timeRange);
  } else {
    params.date_preset = options.datePreset ?? "last_30d";
  }

  return metaFetchPaginated<MetaInsight>(
    `/${adAccountId}/insights`,
    accessToken,
    params,
  );
}

// ====================== Helpers de extração ====================

/** Extrai valor de actions[] por action_type. Retorna 0 se não encontrar. */
export function extractActionValue(
  actions: MetaActionRow[] | undefined,
  actionType: string,
): number {
  if (!actions) return 0;
  const row = actions.find((a) => a.action_type === actionType);
  return row ? parseFloat(row.value) : 0;
}
