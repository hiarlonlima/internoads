"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { syncBusinessManagersAndAccounts } from "@/lib/sync";
import { syncCampaignsAndInsights } from "@/lib/sync-campaigns";

export async function syncAction() {
  const session = await getSession();
  if (!session) return { ok: false, error: "Não autenticado" };

  try {
    // 1. Sync de BMs e contas
    const bmResult = await syncBusinessManagersAndAccounts(session.userId);

    // 2. Sync de campanhas e insights pra TODOS os períodos (em paralelo).
    // Trocar filtro depois é instantâneo.
    const campResult = await syncCampaignsAndInsights(session.userId);

    revalidatePath("/");
    return {
      ok: true,
      businesses: bmResult.businesses,
      adAccounts: bmResult.adAccounts,
      campaigns: campResult.campaignsUpserted,
      insights: campResult.insightsUpserted,
      errors: [...bmResult.errors, ...campResult.errors],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("Sync error:", err);
    return { ok: false, error: message };
  }
}
