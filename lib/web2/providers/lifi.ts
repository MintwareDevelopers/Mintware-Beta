// =============================================================================
// lib/providers/lifi.ts — LI.FI aggregator for same-chain swaps
//
// Covers: Ethereum (1), Base (8453), Arbitrum (42161)
//
// Quotes are fetched through our OWN server proxy (`POST /api/swap/quote`), never
// li.quest directly. The proxy holds the API key (server-only) and injects the
// platform fee server-side, so neither the key nor the fee is exposed to — or
// strippable by — the browser. See app/api/(web2)/swap/quote/route.ts.
// =============================================================================

import type { WalletClient } from 'viem'

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
  buyAmount:            string   // wei (estimate.toAmount from LI.FI)
  price:                string   // always '0' — price impact not available from aggregator
  estimatedGas:         string   // decimal string
  quoteId?:             string   // server-recorded quote id (mw_quote_id) — thread into swap-event
  fromAmountUSD?:       string   // USD value of sell side (estimate.fromAmountUSD from LI.FI)
  gasCostUSD?:          string   // USD cost of network fee (estimate.gasCosts[0].amountUSD)
  nativeTokenPriceUSD?: string   // native token spot price (estimate.gasCosts[0].price)
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

// ─── getQuote ─────────────────────────────────────────────────────────────────

export async function getQuote(params: LifiQuoteParams): Promise<LifiQuote> {
  const { chainId, sellToken, buyToken, sellAmount, taker } = params

  // Go through our server proxy — the API key and fee are injected there.
  // `feeBps` is intentionally NOT forwarded: the fee is a server decision so a
  // tampered client cannot zero it out.
  const res = await fetch('/api/swap/quote', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ chainId, sellToken, buyToken, sellAmount, taker }),
    cache:   'no-store',
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
    buyAmount:           estimate.toAmount                        as string,
    quoteId:             data.mw_quote_id                         as string | undefined,
    fromAmountUSD:       estimate.fromAmountUSD                   as string | undefined,
    gasCostUSD:          estimate.gasCosts?.[0]?.amountUSD        as string | undefined,
    nativeTokenPriceUSD: estimate.gasCosts?.[0]?.token?.priceUSD  as string | undefined,
    // Price impact calc not meaningful for aggregator quotes — hook handles null
    price:          '0',
    estimatedGas:   gasLimitDec || '200000',
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
