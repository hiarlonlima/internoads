import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * Debug do banco de dados: mostra contagem de insights por período + por conta,
 * e sample do que tá salvo pra hoje.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "no session" }, { status: 401 });

  const url = new URL(req.url);
  const account = url.searchParams.get("account") ?? "CA - 02";

  // Contagem por período no DB inteiro
  const insightsByPeriod = await prisma.insight.groupBy({
    by: ["period"],
    where: {
      campaign: {
        adAccount: { businessManager: { userId: session.userId } },
      },
    },
    _count: true,
    _sum: { spend: true, purchases: true, messagesInitiated: true },
  });

  // Pega a conta específica
  const targetAccount = await prisma.adAccount.findFirst({
    where: {
      businessManager: { userId: session.userId },
      name: { contains: account },
    },
    include: {
      campaigns: {
        include: {
          insights: {
            select: {
              period: true,
              spend: true,
              purchases: true,
              messagesInitiated: true,
              syncedAt: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    insightsByPeriodGlobal: insightsByPeriod.map((p) => ({
      period: p.period,
      count: p._count,
      totalSpend: Number(p._sum.spend ?? 0),
      totalPurchases: p._sum.purchases ?? 0,
      totalMessages: p._sum.messagesInitiated ?? 0,
    })),
    targetAccountFound: !!targetAccount,
    accountName: targetAccount?.name,
    accountStatus: targetAccount?.accountStatus,
    campaignCount: targetAccount?.campaigns.length ?? 0,
    campaignsByStatus: targetAccount?.campaigns.reduce<Record<string, number>>(
      (acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1;
        return acc;
      },
      {},
    ),
    sampleCampaignsWithInsights:
      targetAccount?.campaigns
        .filter((c) => c.insights.length > 0)
        .slice(0, 5)
        .map((c) => ({
          name: c.name,
          status: c.status,
          insights: c.insights.map((i) => ({
            period: i.period,
            spend: Number(i.spend),
            purchases: i.purchases,
            messages: i.messagesInitiated,
          })),
        })) ?? [],
  });
}
