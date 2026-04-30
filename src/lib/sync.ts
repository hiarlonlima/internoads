// Orquestração do sync: AdAccounts (com BMs derivadas) → (futuro: Campaigns → Insights)

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { fetchAdAccountsWithBusiness } from "@/lib/meta-api";

// Fallback caso a conta não tenha BM associada (contas pessoais legacy)
const STANDALONE_BM_ID = "__standalone__";
const STANDALONE_BM_NAME = "Sem BM (contas pessoais)";

export interface SyncResult {
  businesses: number;
  adAccounts: number;
  errors: string[];
}

export async function syncBusinessManagersAndAccounts(
  userId: string,
): Promise<SyncResult> {
  const userToken = await prisma.token.findUnique({ where: { userId } });
  if (!userToken) throw new Error("Token Meta não encontrado pra esse usuário");

  const accessToken = decrypt(userToken.accessTokenEncrypted);
  const errors: string[] = [];

  // 1. Busca todas as contas de anúncio (com info da BM embutida)
  const accounts = await fetchAdAccountsWithBusiness(accessToken);

  // 2. Agrupa contas por BM
  const accountsByBusiness = new Map<
    string,
    {
      business: { id: string; name: string };
      accounts: typeof accounts;
    }
  >();

  for (const account of accounts) {
    const bizId = account.business?.id ?? STANDALONE_BM_ID;
    const bizName = account.business?.name ?? STANDALONE_BM_NAME;

    if (!accountsByBusiness.has(bizId)) {
      accountsByBusiness.set(bizId, {
        business: { id: bizId, name: bizName },
        accounts: [],
      });
    }
    accountsByBusiness.get(bizId)!.accounts.push(account);
  }

  // 3. Upsert das BMs e contas
  let totalAccounts = 0;

  for (const { business, accounts: bmAccounts } of accountsByBusiness.values()) {
    const bm = await prisma.businessManager.upsert({
      where: {
        userId_metaBusinessId: {
          userId,
          metaBusinessId: business.id,
        },
      },
      create: {
        userId,
        metaBusinessId: business.id,
        name: business.name,
      },
      update: {
        name: business.name,
        syncedAt: new Date(),
      },
    });

    for (const account of bmAccounts) {
      try {
        await prisma.adAccount.upsert({
          where: {
            businessManagerId_metaAccountId: {
              businessManagerId: bm.id,
              metaAccountId: account.id,
            },
          },
          create: {
            businessManagerId: bm.id,
            metaAccountId: account.id,
            name: account.name,
            accountStatus: account.account_status,
            currency: account.currency,
            timezone: account.timezone_name,
          },
          update: {
            name: account.name,
            accountStatus: account.account_status,
            currency: account.currency,
            timezone: account.timezone_name,
            syncedAt: new Date(),
          },
        });
        totalAccounts++;
      } catch (err) {
        errors.push(
          `Conta ${account.id} (${account.name}): ${err instanceof Error ? err.message : "erro"}`,
        );
      }
    }
  }

  return {
    businesses: accountsByBusiness.size,
    adAccounts: totalAccounts,
    errors,
  };
}
