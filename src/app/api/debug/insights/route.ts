import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { fetchCampaignInsights } from "@/lib/meta-api";

/**
 * Debug: varre todas as contas ativas e coleta os action_types únicos
 * que aparecem nos insights. Útil pra descobrir como mensagens iniciadas
 * são reportadas (variações por região/tipo de campanha).
 */
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "no session" }, { status: 401 });

  const tokenRecord = await prisma.token.findUnique({
    where: { userId: session.userId },
  });
  if (!tokenRecord)
    return NextResponse.json({ error: "no token" }, { status: 404 });

  const accessToken = decrypt(tokenRecord.accessTokenEncrypted);

  const accounts = await prisma.adAccount.findMany({
    where: {
      businessManager: { userId: session.userId },
      accountStatus: 1,
    },
    take: 20, // limite pra não estourar
  });

  const allActionTypes = new Set<string>();
  // Sample do primeiro insight que tiver actions com algum termo "messag"
  let messageSample: {
    account: string;
    campaign?: string;
    actions: { action_type: string; value: string }[];
  } | null = null;

  const accountsScanned: Array<{
    name: string;
    metaId: string;
    campaignsWithInsights: number;
    actionTypes: string[];
  }> = [];

  for (const account of accounts) {
    try {
      const insights = await fetchCampaignInsights(
        account.metaAccountId,
        accessToken,
        { datePreset: "last_30d" },
      );
      const actionTypesInAccount = new Set<string>();
      for (const ins of insights) {
        for (const action of ins.actions ?? []) {
          allActionTypes.add(action.action_type);
          actionTypesInAccount.add(action.action_type);
        }
        // Procura sample com mensagens
        if (
          !messageSample &&
          ins.actions?.some((a) => a.action_type.includes("messag"))
        ) {
          messageSample = {
            account: account.name,
            campaign: ins.campaign_name,
            actions: ins.actions ?? [],
          };
        }
      }
      accountsScanned.push({
        name: account.name,
        metaId: account.metaAccountId,
        campaignsWithInsights: insights.length,
        actionTypes: Array.from(actionTypesInAccount).sort(),
      });
    } catch {
      // ignora contas que dão erro
    }
  }

  return NextResponse.json({
    totalAccountsScanned: accountsScanned.length,
    allUniqueActionTypes: Array.from(allActionTypes).sort(),
    messageRelatedActionTypes: Array.from(allActionTypes)
      .filter((t) => t.toLowerCase().includes("messag"))
      .sort(),
    messageSample,
    perAccountSummary: accountsScanned.filter(
      (a) => a.campaignsWithInsights > 0,
    ),
  });
}
