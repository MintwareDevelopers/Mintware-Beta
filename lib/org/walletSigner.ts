// WalletSigner — the seam between "we decided to send this tx from the buffer wallet" and "Privy
// actually signs + broadcasts it." Kept as a tiny interface (mirrors how lib/org/cardAuthorize.ts
// injects an EdgeAuthorizer) so the approve/onboarding logic is unit-testable with a fake, and the
// real Privy server-wallet adapter stays a lazy, deploy-gated implementation detail.
//
// The buffer wallet is the user's OWN Privy embedded wallet (= bufferOf[user]); Privy signs from it,
// gas sponsored. IMPORTANT: when a Privy SERVER signer auto-signs an approve, it MUST run under a
// Privy policy that allowlists only Bridge's spender + caps the amount — otherwise the auto-signer is
// a standing right to approve anyone. That policy is the approve-step analogue of the Gateway's C1 pin.

export interface SignableCall {
  to: `0x${string}`
  data: `0x${string}`
  value: '0x0' | `0x${string}`
}

export interface WalletSigner {
  /** Sign + broadcast `call` from the funding (buffer) wallet; resolves with the tx hash. */
  sendTransaction(call: SignableCall): Promise<{ txHash: `0x${string}` }>
}

/**
 * Lazily construct a Privy-backed signer for a given wallet, or null when Privy isn't configured
 * (PRIVY_APP_ID / PRIVY_APP_SECRET unset) — same null-not-throw posture as getLithicClient(). The
 * `@privy-io/server-auth` import is dynamic so its ABSENCE never breaks module load or the test run
 * (it is a deploy-gated dependency here — see memory design_v2 / wallet_layer_privy_only). The exact
 * server-wallet send call is verified against the pinned SDK at deploy; the flow tests use a fake
 * signer, so orchestration correctness does not depend on this adapter.
 */
export function privySignerFromEnv(walletId: string, chainId: number): WalletSigner | null {
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret || !walletId) return null

  return {
    async sendTransaction(call: SignableCall): Promise<{ txHash: `0x${string}` }> {
      const mod = await import('@privy-io/server-auth').catch(() => null)
      if (!mod) throw new Error('privy_sdk_unavailable')
      // PrivyClient shape is pinned at deploy; kept behind `any` so a missing/renamed member is a
      // runtime 5xx (deploy-gated), not a build break in an environment without the SDK installed.
      const anyMod = mod as unknown as { PrivyClient: new (id: string, secret: string) => any }
      const client = new anyMod.PrivyClient(appId, appSecret)
      const res = await client.walletApi.ethereum.sendTransaction({
        walletId,
        caip2: `eip155:${chainId}`,
        transaction: { to: call.to, data: call.data, value: call.value },
      })
      const hash = (res?.hash ?? res?.transactionHash) as `0x${string}` | undefined
      if (!hash) throw new Error('privy_send_no_hash')
      return { txHash: hash }
    },
  }
}
