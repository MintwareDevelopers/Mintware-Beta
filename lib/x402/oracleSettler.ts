// In-process x402 settler — submits the Gateway `settleSpend` on-chain via `getOracleSigner('root')`,
// the SAME signer seat the human card flow uses (`lib/org/settleSwipe.ts`). This keeps x402 settlement
// CONSISTENT with the rest of the platform: `getOracleSigner` honors `ORACLE_SIGNER_PROVIDER=privy`, so
// the key lives in Privy's enclave (no raw key in env) exactly like every other oracle-signed action —
// and it removes the need to stand up the separate Rust `services/relayer` with a raw funded key just to
// settle x402 charges. The Rust relayer stays an OPTIONAL override (see config.ts): when `X402_RELAYER_URL`
// is set, `httpSettler` still wins; when `X402_SETTLE_PROVIDER=oracle` is set instead, this path runs.
//
// Fail-closed posture is unchanged: this settler only ever runs when the /api/x402/settle route has
// already bound the payer's per-payment EIP-3009 authorization (from==permit.user, to==payTo, value==assets)
// AND sourced the standing DelegatedSpendPermit; without a permit it returns an error rather than submitting.

import { createPublicClient, createWalletClient, http, zeroAddress, isHex } from 'viem'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { viemChainFor } from '@/lib/web3/chains'
import { GATEWAY_ABI } from '@/lib/web3/artifacts/treasuryV2'
import type { Settler, RelayerPermit, RelayerEdgeAuth } from './facilitator'

/** The one impure step — submit `settleSpend` and wait for the receipt — factored out so the settler is
 *  unit-testable without a live chain. The default implementation is the real viem + Privy/oracle signer
 *  path; tests inject a fake. */
export interface SettleWriter {
  submit(input: {
    gateway: `0x${string}`
    chainId: number
    holdId: `0x${string}`
    user: `0x${string}`
    assets: bigint
    receiver: `0x${string}`
    permit: { user: `0x${string}`; maxDailySpendUSDC: bigint; nonce: bigint; deadline: bigint }
    permitSig: `0x${string}`
    edgeAuth: { holdId: `0x${string}`; user: `0x${string}`; amountUSDC: bigint; nonce: bigint; expiry: bigint }
    edgeSig: `0x${string}`
  }): Promise<{ txHash: `0x${string}`; status: 'success' | 'reverted' }>
}

const EMPTY_HASH = ('0x' + '0'.repeat(64)) as `0x${string}`

/** Real writer — routes `settleSpend` through `getOracleSigner('root')` (Privy or env-key, per
 *  `ORACLE_SIGNER_PROVIDER`), identical to `settleSwipe.ts`. */
const viemWriter: SettleWriter = {
  async submit(input) {
    const rpcUrl = rpcForChain(input.chainId)
    const chain = viemChainFor(input.chainId)
    if (!rpcUrl || !chain) throw new Error(`unsupported settle chain ${input.chainId}`)

    const account = await getOracleSigner('root')
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

    const txHash = await walletClient.writeContract({
      address: input.gateway,
      abi: GATEWAY_ABI,
      functionName: 'settleSpend',
      args: [
        input.holdId,
        input.user,
        input.assets,
        input.receiver,
        input.permit,
        input.permitSig,
        input.edgeAuth,
        input.edgeSig,
      ],
      account,
      chain,
      gas: 700_000n,
    })
    // A mined tx is not a successful tx — settleSpend can revert (bad permit, missing RELAYER_ROLE) and
    // still be included with status 0. Surface the receipt status so the caller never reports a false settle.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    return { txHash, status: receipt.status === 'success' ? 'success' : 'reverted' }
  },
}

/** Build the in-process oracle/Privy settler. `gateway` + `chainId` come from x402 config
 *  (`x402PermitGateway()` / `x402PermitChainId()`); when either is missing the settler fails closed at
 *  settle time rather than at construction, so the facilitator still builds. */
export function oracleSettler(cfg: {
  gateway?: string
  chainId?: number
  writer?: SettleWriter
}): Settler {
  const writer = cfg.writer ?? viemWriter
  return {
    async settle({ holdId, payload, reqs, permit, edge }) {
      if (!cfg.gateway || !isHex(cfg.gateway)) return { success: false, errorReason: 'settle_gateway_unconfigured' }
      if (!cfg.chainId || !Number.isFinite(cfg.chainId)) return { success: false, errorReason: 'settle_chain_unconfigured' }
      if (!holdId || !isHex(holdId)) return { success: false, errorReason: 'settlement_hold_missing' }

      const auth = payload?.payload?.authorization
      const user = auth?.from
      const assetsRaw = auth?.value ?? reqs.maxAmountRequired
      if (!user || !isHex(user) || !assetsRaw) return { success: false, errorReason: 'settlement_payload_incomplete' }
      // The Gateway's DelegatedSpendPermit is not in the x402 payload — the settle route sources it from
      // the standing-permit store and threads it here. No permit ⇒ fail closed, never fabricate a signature.
      if (!permit) return { success: false, errorReason: 'settlement_permit_unavailable' }
      if (!reqs.payTo || !isHex(reqs.payTo)) return { success: false, errorReason: 'settlement_receiver_invalid' }
      if (!isHex(permit.signature)) return { success: false, errorReason: 'settlement_permit_malformed' }

      let assets: bigint
      let permitStruct: { user: `0x${string}`; maxDailySpendUSDC: bigint; nonce: bigint; deadline: bigint }
      try {
        assets = BigInt(assetsRaw)
        permitStruct = {
          user: permit.user as `0x${string}`,
          maxDailySpendUSDC: BigInt(permit.max_daily_spend_usdc),
          nonce: BigInt(permit.nonce),
          deadline: BigInt(permit.deadline),
        }
      } catch {
        return { success: false, errorReason: 'settlement_amount_unparseable' }
      }
      if (assets <= 0n) return { success: false, errorReason: 'settlement_non_positive_amount' }

      // Edge auth is only present for high-value (>= $250) charges; otherwise pass the empty tuple the
      // Gateway treats as "no short-lived auth" (matches settleSwipe.ts's emptyEdgeAuth).
      const edgeAuth = edge
        ? {
            holdId: (isHex(edge.hold_id) ? edge.hold_id : EMPTY_HASH) as `0x${string}`,
            user: edge.user as `0x${string}`,
            amountUSDC: BigInt(edge.amount_usdc),
            nonce: BigInt(edge.nonce),
            expiry: BigInt(edge.expiry),
          }
        : { holdId: EMPTY_HASH, user: zeroAddress, amountUSDC: 0n, nonce: 0n, expiry: 0n }
      const edgeSig = (edge && isHex(edge.signature) ? edge.signature : '0x') as `0x${string}`

      try {
        const { txHash, status } = await writer.submit({
          gateway: cfg.gateway as `0x${string}`,
          chainId: cfg.chainId,
          holdId: holdId as `0x${string}`,
          user: user as `0x${string}`,
          assets,
          receiver: reqs.payTo as `0x${string}`,
          permit: permitStruct,
          permitSig: permit.signature as `0x${string}`,
          edgeAuth,
          edgeSig,
        })
        if (status !== 'success') return { success: false, txHash, errorReason: 'settle_reverted' }
        return { success: true, txHash }
      } catch (e) {
        return { success: false, errorReason: `settle_failed:${String(e instanceof Error ? e.message : e)}` }
      }
    },
  }
}
