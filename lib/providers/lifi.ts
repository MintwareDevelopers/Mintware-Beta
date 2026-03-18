// =============================================================================
// lib/providers/lifi.ts — LI.FI aggregator for same-chain swaps
//
// Covers: Ethereum (1), Base (8453), Arbitrum (42161)
// Does NOT cover: Core DAO (1116) — use lib/providers/molten.ts for that
//
// Fee collection: pass `integrator` + `fee` (decimal fraction of feeBps/10000)
// to LI.FI. The integrator account must be registered at https://li.fi/integrators
// If NEXT_PUBLIC_LIFI_INTEGRATOR is unset, fee is omitted (dev mode).
//
// API key: optional but rate-limited without one. Set NEXT_PUBLIC_LIFI_API_KEY.
// =============================================================================

import type { WalletClient } from 'viem'

const LIFI_API      = 'https://li.quest/v1'
const LIFI_API_KEY  = process.env.NEXT_PUBLIC_LIFI_API_KEY  || ''
const INTEGRATOR    = process.env.NEXT_PUBLIC_LIFI_INTEGRATOR || 'mintware'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LifiQuoteParams {
  chainId:      number
  sellToken:    string   // ERC-20 address or 0x000...000 for native
  buyToken:     string
  sellAmount:   string   // in wei (decimal string)
  taker:        string   // wallet address
  feeBps?:      number   // e.g. 10 = 0.1%
  campaignId?:  string
  referrer?:    string
}

// Stored raw so executeSwap can use original hex values directly
interface LifiTxRequest {
  to:       string
  data:     string
  value:    string   // hex or '0x0'
  gasLimit: string   // hex or decimal
  gasPrice: string   // hex or decimal
  chainId:  number
}

export interface LifiQuote {
  buyAmount:    string   // wei (estimate.toAmount from LI.FI)
  price:        string   // always '0' — price impact not available from aggregator
  estimatedGas: string   // decimal string
  transaction: {
    to:       string
    data:     string
    value:    string   // decimal string (for display compatibility)
    gas:      string   // decimal string
    gasPrice: string   // decimal string
  }
  _txReq: LifiTxRequest  // preserved for executeSwap
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely parse hex or decimal string to BigInt, returns 0n on failure */
function safeBigInt(val: string | undefined): bigint {
  if (!val) return 0n
  try { return BigInt(val) } catch { return 0n }
}

function makeHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (LIFI_API_KEY) h['x-lifi-api-key'] = LIFI_API_KEY
  return h
}

// ─── getQuote ─────────────────────────────────────────────────────────────────

export async function getQuote(params: LifiQuoteParams): Promise<LifiQuote> {
  const { chainId, sellToken, buyToken, sellAmount, taker, feeBps } = params

  const qp = new URLSearchParams({
    fromChain:   chainId.toString(),
    toChain:     chainId.toString(),
    fromToken:   sellToken,
    toToken:     buyToken,
    fromAmount:  sellAmount,
    fromAddress: taker,
    integrator:  INTEGRATOR,
    // Disable bridge routes — same-chain only
    allowBridges: 'false',
  })

  // Fee: LI.FI accepts `fee` as a decimal fraction (0.001 = 0.1% = 10 BPS)
  // Only applied when an integrator account is registered with LI.FI
  if (feeBps && feeBps > 0) {
    qp.set('fee', (feeBps / 10000).toFixed(6))
  }

  const res = await fetch(`${LIFI_API}/quote?${qp.toString()}`, {
    headers: makeHeaders(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`LI.FI quote failed (${res.status}): ${body}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()

  const txReq   = data?.transactionRequest
  const estimate = data?.estimate

  if (!txReq || !estimate?.toAmount) {
    throw new Error('LI.FI returned an invalid quote — no transaction or estimate')
  }

  // Gas values come as hex from LI.FI
  const gasLimitDec = safeBigInt(txReq.gasLimit).toString()
  const gasPriceDec = safeBigInt(txReq.gasPrice).toString()
  const valueDec    = safeBigInt(txReq.value).toString()

  return {
    buyAmount:    estimate.toAmount as string,
    // Price impact calc not meaningful for aggregator quotes — hook handles null
    price:        '0',
    estimatedGas: gasLimitDec || '200000',
    transaction: {
      to:       txReq.to       ?? '',
      data:     txReq.data     ?? '0x',
      value:    valueDec,
      gas:      gasLimitDec    || '200000',
      gasPrice: gasPriceDec    || '0',
    },
    _txReq: {
      to:       txReq.to       ?? '',
      data:     txReq.data     ?? '0x',
      value:    txReq.value    ?? '0x0',
      gasLimit: txReq.gasLimit ?? '0x30d40',
      gasPrice: txReq.gasPrice ?? '0x0',
      chainId:  txReq.chainId  ?? chainId,
    },
  }
}

// ─── executeSwap ──────────────────────────────────────────────────────────────

export async function executeSwap(
  quote: LifiQuote,
  walletClient: WalletClient,
): Promise<`0x${string}`> {
  const { _txReq } = quote

  const txHash = await walletClient.sendTransaction({
    account: walletClient.account!,
    chain:   walletClient.chain,
    to:      _txReq.to       as `0x${string}`,
    data:    _txReq.data     as `0x${string}`,
    value:   safeBigInt(_txReq.value),
    gas:     safeBigInt(_txReq.gasLimit) || 200000n,
  })

  return txHash
}
