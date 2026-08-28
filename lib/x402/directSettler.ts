// Direct x402 settler — the STANDARD x402 "exact" scheme: submit the payer's signed EIP-3009
// `transferWithAuthorization` to the USDC contract so USDC moves straight from the payer to `payTo`
// (the seller's wallet). No vault, no gateway, no `settleSpend`, no `RELAYER_ROLE`, no CCTP — a valid
// EIP-3009 authorization can be submitted by ANYONE, so the submitter is a pure gas payer. We use
// `getOracleSigner('root')` (the Privy wallet) as that gas payer to stay Privy-consistent, but it needs
// NO on-chain role — only gas on the payment network.
//
// This is the right settle model when the seller just wants the fee in a wallet. The oracle/relayer
// `settleSpend` paths (lib/x402/oracleSettler.ts / edgeHttp.httpSettler) are the heavier YPN-vault model,
// meant for the *payer's* balance to keep earning — a different product. Select with X402_SETTLE_PROVIDER=direct.
//
// Self-guarding: before spending gas it re-checks the payload (recipient == payTo, amount, window) and the
// EIP-3009 signature, so a bad request is rejected off-chain rather than reverting on-chain.

import { createPublicClient, createWalletClient, http, defineChain, parseSignature, isAddress } from 'viem'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { checkPayloadAgainst } from './protocol'
import { verifyEip3009Authorization } from './verifyAuthorization'
import { USDC_BY_NETWORK } from './config'
import type { Settler } from './facilitator'

/** USDC EIP-3009 `transferWithAuthorization` (v,r,s form — universal across all EIP-3009 USDC tokens). */
const USDC_EIP3009_ABI = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

/** Per-network chain id + RPC (env-overridable). Base Sepolia default is publicnode — sepolia.base.org is dead. */
const NETWORKS: Record<string, { chainId: number; rpcEnv: string; defaultRpc: string }> = {
  base: { chainId: 8453, rpcEnv: 'BASE_RPC_URL', defaultRpc: 'https://mainnet.base.org' },
  'base-sepolia': { chainId: 84532, rpcEnv: 'BASE_SEPOLIA_RPC_URL', defaultRpc: 'https://base-sepolia-rpc.publicnode.com' },
}

/** The one impure step — submit the transfer + await the receipt — injectable so the settler is unit-testable
 *  without a live chain. Default impl uses viem + the Privy/oracle gas payer. */
export interface DirectSettleWriter {
  submit(input: {
    chainId: number
    rpc: string
    usdc: `0x${string}`
    from: `0x${string}`
    to: `0x${string}`
    value: bigint
    validAfter: bigint
    validBefore: bigint
    nonce: `0x${string}`
    v: number
    r: `0x${string}`
    s: `0x${string}`
  }): Promise<{ txHash: `0x${string}`; status: 'success' | 'reverted' }>
}

const viemWriter: DirectSettleWriter = {
  async submit(i) {
    const chain = defineChain({
      id: i.chainId,
      name: `x402-${i.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [i.rpc] } },
    })
    const account = await getOracleSigner('root')
    const walletClient = createWalletClient({ account, chain, transport: http(i.rpc) })
    const publicClient = createPublicClient({ chain, transport: http(i.rpc) })
    const txHash = await walletClient.writeContract({
      address: i.usdc,
      abi: USDC_EIP3009_ABI,
      functionName: 'transferWithAuthorization',
      args: [i.from, i.to, i.value, i.validAfter, i.validBefore, i.nonce, i.v, i.r, i.s],
      account,
      chain,
      gas: 150_000n,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    return { txHash, status: receipt.status === 'success' ? 'success' : 'reverted' }
  },
}

/** Build the direct-transfer settler. `writer` is injectable for tests. */
export function directSettler(cfg: { writer?: DirectSettleWriter } = {}): Settler {
  const writer = cfg.writer ?? viemWriter
  return {
    async settle({ payload, reqs }) {
      const net = NETWORKS[reqs.network]
      if (!net) return { success: false, errorReason: 'unsupported_network' }

      // Guard off-chain so a bad request never spends gas: recipient == payTo, amount/window (checkPayloadAgainst),
      // then the EIP-3009 signature itself. The USDC contract enforces the same on-chain as a backstop.
      const now = Math.floor(Date.now() / 1000)
      const pre = checkPayloadAgainst(reqs, payload, now)
      if (!pre.ok) return { success: false, errorReason: pre.reason }

      const auth = payload?.payload?.authorization
      const signature = payload?.payload?.signature
      if (!auth || !signature) return { success: false, errorReason: 'settlement_authorization_missing' }
      const sigOk = await verifyEip3009Authorization({ network: reqs.network, asset: reqs.asset, authorization: auth, signature })
      if (!sigOk) return { success: false, errorReason: 'invalid_payment_signature' }

      const usdc = (reqs.asset && isAddress(reqs.asset) ? reqs.asset : USDC_BY_NETWORK[reqs.network]) as `0x${string}` | undefined
      if (!usdc || !isAddress(usdc)) return { success: false, errorReason: 'unknown_usdc_asset' }

      let value: bigint, validAfter: bigint, validBefore: bigint
      try {
        value = BigInt(auth.value)
        validAfter = BigInt(auth.validAfter)
        validBefore = BigInt(auth.validBefore)
      } catch {
        return { success: false, errorReason: 'unparseable_authorization' }
      }

      let v: number, r: `0x${string}`, s: `0x${string}`
      try {
        const p = parseSignature(signature as `0x${string}`)
        v = p.v !== undefined ? Number(p.v) : Number(p.yParity) + 27
        if (v < 27) v += 27
        r = p.r
        s = p.s
      } catch {
        return { success: false, errorReason: 'malformed_signature' }
      }

      try {
        const rpc = process.env[net.rpcEnv] || net.defaultRpc
        const { txHash, status } = await writer.submit({
          chainId: net.chainId,
          rpc,
          usdc,
          from: auth.from as `0x${string}`,
          to: auth.to as `0x${string}`,
          value,
          validAfter,
          validBefore,
          nonce: auth.nonce as `0x${string}`,
          v,
          r,
          s,
        })
        if (status !== 'success') return { success: false, txHash, errorReason: 'transfer_reverted' }
        return { success: true, txHash }
      } catch (e) {
        return { success: false, errorReason: `transfer_failed:${String(e instanceof Error ? e.message : e)}` }
      }
    },
  }
}
