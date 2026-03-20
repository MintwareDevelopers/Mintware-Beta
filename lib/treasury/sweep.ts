// =============================================================================
// lib/treasury/sweep.ts — Treasury fee sweep: ERC-20 → native ETH on Base
//
// Called by POST /api/treasury/sweep (Vercel Cron, daily at 03:00 UTC).
//
// Uses LI.FI REST API (li.quest/v1/quote) — same routing engine as the user
// swap page, no 0x dependency needed. No integrator fee applied to self-swaps.
//
// Flow per token:
//   1. Read ERC-20 balance via publicClient.readContract
//   2. Skip if balance is zero or below DUST_THRESHOLD_USD
//   3. Fetch LI.FI quote (same-chain swap, token → native ETH)
//   4. If allowance to LI.FI router is zero → send ERC-20 approve tx
//   5. Broadcast the transactionRequest returned by LI.FI
//   6. Wait for receipt before moving to next token
//
// Required env vars:
//   TREASURY_PRIVATE_KEY       — hex private key of NEXT_PUBLIC_MINTWARE_TREASURY
//                                 (64-char hex, no 0x prefix). NEVER expose client-side.
//   NEXT_PUBLIC_LIFI_API_KEY   — already set in .env.local
//   BASE_RPC_URL               — already set in .env.local
//
// Note: no integrator fee / referrer is attached to these swaps — we are
// swapping our own accumulated fees and don't want to pay ourselves a fee.
// =============================================================================

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import {
  BASE_TOKENS,
  DUST_THRESHOLD_USD,
  type BaseToken,
} from './tokens'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIFI_API    = 'https://li.quest/v1'
/** Native ETH / zero address — LI.FI uses this for native gas tokens */
const NATIVE_ETH  = '0x0000000000000000000000000000000000000000'
/** Max uint256 — standard unlimited ERC-20 approval */
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

// ---------------------------------------------------------------------------
// Minimal ABIs
// ---------------------------------------------------------------------------
const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export interface SweepTokenResult {
  symbol:      string
  address:     string
  balanceRaw:  string   // raw bigint as decimal string
  balanceUsd:  number
  status:      'zero_balance' | 'skipped_dust' | 'no_route' | 'approved' | 'swapped' | 'error'
  txHash?:     string
  error?:      string
}

export interface SweepReport {
  treasury:       string
  sweepedAt:      string
  tokensChecked:  number
  tokensSwapped:  number
  results:        SweepTokenResult[]
}

// ---------------------------------------------------------------------------
// LI.FI quote response (simplified — only fields we use)
// ---------------------------------------------------------------------------
interface LifiQuote {
  estimate?: {
    approvalAddress?: string
    toAmountMin?:     string
  }
  transactionRequest?: {
    to:        string
    from:      string
    data:      string
    value:     string
    gasPrice:  string
    gasLimit:  string
  }
}

// ---------------------------------------------------------------------------
// Fetch a same-chain LI.FI quote: token → native ETH on Base
// ---------------------------------------------------------------------------
async function getLifiQuote(
  token:     BaseToken,
  amount:    bigint,
  treasury:  string
): Promise<LifiQuote | null> {
  const apiKey = process.env.NEXT_PUBLIC_LIFI_API_KEY
  const params = new URLSearchParams({
    fromChain:       '8453',
    toChain:         '8453',
    fromToken:       token.address,
    toToken:         NATIVE_ETH,
    fromAmount:      amount.toString(),
    fromAddress:     treasury,
    skipSimulation:  'true',
    allowExchanges:  'baseswap,aerodrome,uniswapv3,pancakeswapv3',
  })

  const res = await fetch(`${LIFI_API}/quote?${params}`, {
    headers: {
      'x-lifi-api-key': apiKey ?? '',
      'Content-Type':   'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LI.FI quote ${res.status}: ${body.slice(0, 200)}`)
  }

  return res.json() as Promise<LifiQuote>
}

// ---------------------------------------------------------------------------
// Rough USD value estimate for dust filtering
// Uses LI.FI quote with a small sentinel amount to get the exchange rate,
// then scales to the actual balance. Falls back to 0 on error.
// ---------------------------------------------------------------------------
async function estimateUsd(token: BaseToken, amount: bigint, treasury: string): Promise<number> {
  try {
    // Use 1 unit of the token (adjusted for decimals) as the sentinel
    const sentinelAmount = BigInt(10 ** token.decimals)  // 1 full token
    const quote = await getLifiQuote(token, sentinelAmount, treasury)
    if (!quote?.estimate?.toAmountMin) return 0

    // toAmountMin is ETH wei for 1 full token
    const ethPerToken  = Number(BigInt(quote.estimate.toAmountMin)) / 1e18
    const tokenUnits   = Number(amount) / 10 ** token.decimals
    const ETH_USD_EST  = 3500  // rough — only used for dust threshold, not accounting
    return tokenUnits * ethPerToken * ETH_USD_EST
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Main sweep
// ---------------------------------------------------------------------------
export async function runSweep(): Promise<SweepReport> {
  const privateKey = process.env.TREASURY_PRIVATE_KEY
  if (!privateKey) throw new Error('TREASURY_PRIVATE_KEY not set in env')

  const account  = privateKeyToAccount(`0x${privateKey}` as Hex)
  const treasury = account.address as Address

  const publicClient = createPublicClient({
    chain:     base,
    transport: http(process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'),
  })

  const walletClient = createWalletClient({
    account,
    chain:     base,
    transport: http(process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'),
  })

  const results:      SweepTokenResult[] = []
  let   tokensSwapped = 0

  for (const token of BASE_TOKENS) {
    const result: SweepTokenResult = {
      symbol:     token.symbol,
      address:    token.address,
      balanceRaw: '0',
      balanceUsd: 0,
      status:     'zero_balance',
    }

    try {
      // ── 1. Read balance ────────────────────────────────────────────────
      const balance = await publicClient.readContract({
        address:      token.address as Address,
        abi:          ERC20_ABI,
        functionName: 'balanceOf',
        args:         [treasury],
      })
      result.balanceRaw = balance.toString()

      if (balance === 0n) {
        results.push(result)
        continue
      }

      // ── 2. Dust check ──────────────────────────────────────────────────
      const usdValue = await estimateUsd(token, balance, treasury)
      result.balanceUsd = usdValue

      if (usdValue < DUST_THRESHOLD_USD) {
        result.status = 'skipped_dust'
        results.push(result)
        continue
      }

      // ── 3. LI.FI quote ────────────────────────────────────────────────
      let quote: LifiQuote | null = null
      try {
        quote = await getLifiQuote(token, balance, treasury)
      } catch (err) {
        result.status = 'no_route'
        result.error  = (err as Error).message
        results.push(result)
        continue
      }

      if (!quote?.transactionRequest) {
        result.status = 'no_route'
        results.push(result)
        continue
      }

      const { transactionRequest, estimate } = quote

      // ── 4. Approve LI.FI router if needed ─────────────────────────────
      if (estimate?.approvalAddress) {
        const spender  = estimate.approvalAddress as Address
        const allowed  = await publicClient.readContract({
          address:      token.address as Address,
          abi:          ERC20_ABI,
          functionName: 'allowance',
          args:         [treasury, spender],
        })

        if (allowed < balance) {
          const approveTx = await walletClient.writeContract({
            address:      token.address as Address,
            abi:          ERC20_ABI,
            functionName: 'approve',
            args:         [spender, MAX_UINT256],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveTx })
          result.status = 'approved'
          console.log(`[sweep] ✓ Approved LI.FI router for ${token.symbol} — tx ${approveTx}`)
        }
      }

      // ── 5. Broadcast swap ──────────────────────────────────────────────
      const txHash = await walletClient.sendTransaction({
        to:       transactionRequest.to as Address,
        data:     transactionRequest.data as Hex,
        value:    BigInt(transactionRequest.value ?? '0'),
        gasLimit: BigInt(transactionRequest.gasLimit),
        gasPrice: BigInt(transactionRequest.gasPrice),
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })

      result.status  = 'swapped'
      result.txHash  = txHash
      tokensSwapped++
      console.log(
        `[sweep] ✓ ${token.symbol} → ETH | $${usdValue.toFixed(2)} | tx ${txHash}`
      )

    } catch (err) {
      result.status = 'error'
      result.error  = (err as Error).message
      console.error(`[sweep] ✗ ${token.symbol}:`, (err as Error).message)
    }

    results.push(result)
  }

  return {
    treasury:      treasury,
    sweepedAt:     new Date().toISOString(),
    tokensChecked: BASE_TOKENS.length,
    tokensSwapped,
    results,
  }
}
