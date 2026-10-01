// V2-RWAs signer resolution for the demo scripts.
//
// Production path (the default): the DEDICATED `rwa` Privy server-wallet seat — RWA_ORACLE_PRIVY_WALLET_ID +
// RWA_ORACLE_PRIVY_ADDRESS (+ PRIVY_APP_ID/SECRET, optional RWA_ORACLE_PRIVY_AUTH_KEY). The key lives in
// Privy's enclave; no raw key anywhere. Deliberately NO fallback to the root or gateway seats (seat
// separation, re-audit A-3 / round-2 O-6).
//
// Rehearsal path: RWA_REHEARSAL=1 + RWA_REHEARSAL_KEY (e.g. anvil's public test account) — local forks only.

import { privateKeyToAccount } from 'viem/accounts'

export async function resolveRwaSigner() {
  if (process.env.RWA_REHEARSAL === '1') {
    const k = process.env.RWA_REHEARSAL_KEY
    if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('RWA_REHEARSAL=1 needs RWA_REHEARSAL_KEY (a throwaway local-fork key)')
    return { account: privateKeyToAccount(k), kind: 'rehearsal-key' }
  }
  const { PRIVY_APP_ID, PRIVY_APP_SECRET, RWA_ORACLE_PRIVY_WALLET_ID: walletId, RWA_ORACLE_PRIVY_ADDRESS: address } = process.env
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET || !walletId || !address) {
    throw new Error('missing Privy env: PRIVY_APP_ID, PRIVY_APP_SECRET, RWA_ORACLE_PRIVY_WALLET_ID, RWA_ORACLE_PRIVY_ADDRESS')
  }
  const { PrivyClient } = await import('@privy-io/server-auth')
  const { createViemAccount } = await import('@privy-io/server-auth/viem')
  const authKey = process.env.RWA_ORACLE_PRIVY_AUTH_KEY ?? ''
  const privy = authKey
    ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET, { walletApi: { authorizationPrivateKey: authKey } })
    : new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
  return { account: await createViemAccount({ walletId, address, privy }), kind: 'privy-rwa-seat' }
}
