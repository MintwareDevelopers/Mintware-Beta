// =============================================================================
// oracleSigner.ts — pluggable signer resolution for the oracle roles.
//
// Returns a viem `Account` for a signing role, from one of two providers:
//
//   env-key (default) — a raw private key from env (via oracleKeys.ts). Simple,
//                       but the key sits in the process env (this is what leaked).
//
//   privy             — a Privy SERVER WALLET. The private key lives in Privy's
//                       secure enclave; we sign via the Privy API, so there is NO
//                       raw key in env. This is the professional setup that retires
//                       the exposed key. `createViemAccount` returns a normal viem
//                       LocalAccount, so every existing signing call site
//                       (walletClient.signTypedData / writeContract) is unchanged.
//
// Select the provider with ORACLE_SIGNER_PROVIDER = 'env-key' | 'privy' (default
// 'env-key', so this is fully backward compatible until you flip it).
//
// ── Privy mode setup (per role) ──────────────────────────────────────────────
//   PRIVY_APP_ID, PRIVY_APP_SECRET          — your Privy app credentials (server)
//   <ROLE>_ORACLE_PRIVY_WALLET_ID           — the Privy server-wallet id for the role
//   <ROLE>_ORACLE_PRIVY_ADDRESS             — that wallet's 0x address
// e.g. ROOT_ORACLE_PRIVY_WALLET_ID / ROOT_ORACLE_PRIVY_ADDRESS for the 'root' role.
//
// After provisioning the Privy wallet, rotate the ON-CHAIN oracleSigner to its
// address via the 48h timelock (proposeOracleSigner → confirmOracleSigner). See
// docs/developers/professional-key-setup.md.
// =============================================================================

import type { LocalAccount } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getOracleSignerKey, type OracleRole } from './oracleKeys'

type PrivyEnv = { walletId: string; address: string }

/** Per-role Privy env-var names (walletId + address). */
const ROLE_PRIVY_ENV: Record<OracleRole, PrivyEnv> = {
  root:   { walletId: 'ROOT_ORACLE_PRIVY_WALLET_ID',   address: 'ROOT_ORACLE_PRIVY_ADDRESS' },
  weight: { walletId: 'WEIGHT_ORACLE_PRIVY_WALLET_ID', address: 'WEIGHT_ORACLE_PRIVY_ADDRESS' },
  range:  { walletId: 'RANGE_ORACLE_PRIVY_WALLET_ID',  address: 'RANGE_ORACLE_PRIVY_ADDRESS' },
  agent:  { walletId: 'AGENT_ORACLE_PRIVY_WALLET_ID',  address: 'AGENT_ORACLE_PRIVY_ADDRESS' },
  gateway: { walletId: 'GATEWAY_ORACLE_PRIVY_WALLET_ID', address: 'GATEWAY_ORACLE_PRIVY_ADDRESS' },
}

function usePrivy(): boolean {
  // Round-3 audit F-6: a TYPO in ORACLE_SIGNER_PROVIDER ("privvy", "Privy " …) used to fall through to env-key
  // mode silently — the `gateway` seat then failed closed (no raw key) but `range`/`agent` would sign with the
  // shared, git-exposed ORACLE_PRIVATE_KEY. Only the two documented values are accepted; anything else throws
  // at first use (every signer path is behind this), so a misconfiguration is loud, not a silent downgrade.
  const raw = (process.env.ORACLE_SIGNER_PROVIDER ?? 'env-key').trim().toLowerCase()
  if (raw === 'privy') return true
  if (raw === 'env-key') return false
  throw new Error(`[oracleSigner] ORACLE_SIGNER_PROVIDER must be "privy" or "env-key" (got "${raw}") — refusing to pick a signer.`)
}

/**
 * Resolve a viem `Account` for a signing role. Honors ORACLE_SIGNER_PROVIDER.
 * Async because the Privy wallet is fetched over its API; the env-key path
 * resolves synchronously but is awaited uniformly for a single call shape.
 */
export async function getOracleSigner(role: OracleRole): Promise<LocalAccount> {
  if (usePrivy()) return getPrivyOracleSigner(role)
  return privateKeyToAccount(getOracleSignerKey(role))
}

async function getPrivyOracleSigner(role: OracleRole): Promise<LocalAccount> {
  const appId     = process.env.PRIVY_APP_ID ?? ''
  const appSecret = process.env.PRIVY_APP_SECRET ?? ''
  if (!appId || !appSecret) {
    throw new Error('[oracleSigner] ORACLE_SIGNER_PROVIDER=privy requires PRIVY_APP_ID + PRIVY_APP_SECRET.')
  }
  const { walletId: widEnv, address: addrEnv } = ROLE_PRIVY_ENV[role]
  const walletId = process.env[widEnv] ?? ''
  const address  = process.env[addrEnv] ?? ''
  if (!walletId || !address) {
    throw new Error(`[oracleSigner] Privy mode for role "${role}" requires ${widEnv} + ${addrEnv}.`)
  }

  // Imported dynamically so @privy-io/server-auth is only loaded when Privy mode is active.
  const { PrivyClient }       = await import('@privy-io/server-auth')
  const { createViemAccount } = await import('@privy-io/server-auth/viem')
  // Round-2 audit O-6: PRIVY_APP_SECRET alone reaches EVERY server wallet, so address-level seat separation
  // (root vs gateway) was not credential-level. Once a wallet has an authorization keypair enabled in the
  // Privy dashboard, signing REQUIRES the matching private key — each role carries its own
  // `<ROLE>_ORACLE_PRIVY_AUTH_KEY`, so a leaked app secret can no longer move the gateway's funds, and a
  // leaked gateway key can't reach the card/x402 seat. Optional until the dashboard toggle is on.
  const authKey = process.env[`${role.toUpperCase()}_ORACLE_PRIVY_AUTH_KEY`] ?? ''
  const privy = authKey
    ? new PrivyClient(appId, appSecret, { walletApi: { authorizationPrivateKey: authKey } })
    : new PrivyClient(appId, appSecret)
  // The ESM/CJS dual .d.ts declarations of PrivyClient are structurally identical but nominally
  // distinct (private `api` member), so tsc rejects a direct pass. The runtime value IS a valid
  // PrivyClient from the same package — cast through `unknown` to the exact expected param type.
  type PrivyArg = Parameters<typeof createViemAccount>[0]['privy']
  return createViemAccount({ walletId, address: address as `0x${string}`, privy: privy as unknown as PrivyArg })
}
