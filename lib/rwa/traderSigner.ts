// V2-RWAs — the verified demo-trader Privy wallet (server-only) and the Base Sepolia read client, shared by the
// live-trade button (lib/rwa/liveTrade.ts) and the testnet dUSD faucet (lib/rwa/faucet.ts). Testnet only.

import { createPublicClient, createWalletClient, http, type Account } from 'viem'
import { baseSepolia } from 'viem/chains'

export const RWA_RPC = process.env.RWA_RPC_URL ?? 'https://sepolia.base.org'
export const rwaPub = createPublicClient({ chain: baseSepolia, transport: http(RWA_RPC, { timeout: 10_000 }) })

let traderAccount: Account | null = null
export async function rwaTrader(): Promise<Account> {
  if (traderAccount) return traderAccount
  const { PRIVY_APP_ID, PRIVY_APP_SECRET, RWA_TRADER_PRIVY_WALLET_ID: walletId, RWA_TRADER_PRIVY_ADDRESS: address } = process.env
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET || !walletId || !address) throw new Error('trader_not_configured')
  const { PrivyClient } = await import('@privy-io/server-auth')
  const { createViemAccount } = await import('@privy-io/server-auth/viem')
  const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
  // Privy bundles its own viem copy, so its Account type is nominally distinct — same runtime shape.
  traderAccount = (await createViemAccount({ walletId, address: address as `0x${string}`, privy: privy as never })) as unknown as Account
  return traderAccount
}

export function rwaWallet(account: Account) {
  return createWalletClient({ account, chain: baseSepolia, transport: http(RWA_RPC) })
}
