"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { syncBusinessManagersAndAccounts } from "@/lib/sync";
import { syncCampaignsAndInsights } from "@/lib/sync-campaigns";

export async function syncAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;

  try {
    // 1. Sync de BMs e contas
    await syncBusinessManagersAndAccounts(session.userId);

    // 2. Sync de campanhas e insights pra TODOS os períodos (em paralelo).
    // Trocar filtro depois é instantâneo.
    await syncCampaignsAndInsights(session.userId);

    revalidatePath("/");
    revalidatePath("/comparar");
    revalidatePath("/contas");
  } catch (err) {
    console.error("Sync error:", err);
    // Erros são logados no servidor; UI mostra dados como estavam antes.
  }
}
