import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    const bmCount = await prisma.businessManager.count();
    const accountCount = await prisma.adAccount.count();
    const campaignCount = await prisma.campaign.count();
    const insightCount = await prisma.insight.count();

    return NextResponse.json({
      ok: true,
      tables: {
        users: userCount,
        businessManagers: bmCount,
        adAccounts: accountCount,
        campaigns: campaignCount,
        insights: insightCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
