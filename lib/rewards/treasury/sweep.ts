// =============================================================================
// lib/treasury/sweep.ts
//
// Two related treasury jobs live here:
//
// 1. runSweep()          — generic treasury ERC-20 → native ETH sweep
// 2. runNormalizeMev()   — staged MEV ERC-20 → USDC → FeeVault accounting
//
// Uses LI.FI REST API (li.quest/v1/quote) — same routing engine as the user
// swap page, no 0x dependency needed. No integrator fee applied to self-swaps.
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
// ---------------------------------------------------------------------------
// Minimal ABIs
// ---------------------------------------------------------------------------
const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const FEE_VAULT_ABI = parseAbi([
  'function receiveFees(uint256 amount, string source) external',
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

export interface NormalizeMevTokenResult extends SweepTokenResult {
  usdcReceivedRaw?: string
  feeVaultTxHash?: string
}

export interface NormalizeMevReport {
  treasury:            string
  feeVault:            string
  normalizedAt:        string
  tokensChecked:       number
  tokensNormalized:    number
  totalUsdcDeposited:  string
  results:             NormalizeMevTokenResult[]
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
  wallet:    string,
  toToken:   string
): Promise<LifiQuote | null> {
  const apiKey = process.env.LIFI_API_KEY || process.env.NEXT_PUBLIC_LIFI_API_KEY
  const params = new URLSearchParams({
    fromChain:       '8453',
    toChain:         '8453',
    fromToken:       token.address,
    toToken,
    fromAmount:      amount.toString(),
    fromAddress:     wallet,
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
    const quote = await getLifiQuote(token, sentinelAmount, treasury, NATIVE_ETH)
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
        quote = await getLifiQuote(token, balance, treasury, NATIVE_ETH)
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
          let approveTx: Hex
          try {
            approveTx = await walletClient.writeContract({
              address:      token.address as Address,
              abi:          ERC20_ABI,
              functionName: 'approve',
              args:         [spender, balance],
            })
          } catch (approveErr) {
            if (allowed > 0n) {
              const resetTx = await walletClient.writeContract({
                address:      token.address as Address,
                abi:          ERC20_ABI,
                functionName: 'approve',
                args:         [spender, 0n],
              })
              await publicClient.waitForTransactionReceipt({ hash: resetTx })
              approveTx = await walletClient.writeContract({
                address:      token.address as Address,
                abi:          ERC20_ABI,
                functionName: 'approve',
                args:         [spender, balance],
              })
            } else {
              throw approveErr
            }
          }
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

function getFeeVaultAddress(): Address {
  const feeVault = (process.env.FEE_VAULT_ADDRESS ?? process.env.NEXT_PUBLIC_FEE_VAULT_ADDRESS ?? '') as Address
  if (!/^0x[a-fA-F0-9]{40}$/.test(feeVault)) {
    throw new Error('FEE_VAULT_ADDRESS or NEXT_PUBLIC_FEE_VAULT_ADDRESS must be set to a valid address')
  }
  return feeVault
}

async function ensureAllowance(
  publicClient: any,
  walletClient: any,
  owner: Address,
  tokenAddress: Address,
  spender: Address,
  amount: bigint
) {
  const allowed = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  })

  if (allowed >= amount) return

  let approveTx: Hex
  try {
    approveTx = await walletClient.writeContract({
      chain: base,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    })
  } catch (approveErr) {
    if (allowed > 0n) {
      const resetTx = await walletClient.writeContract({
        chain: base,
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, 0n],
      })
      await publicClient.waitForTransactionReceipt({ hash: resetTx })
      approveTx = await walletClient.writeContract({
        chain: base,
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, amount],
      })
    } else {
      throw approveErr
    }
  }

  await publicClient.waitForTransactionReceipt({ hash: approveTx })
}

export async function runNormalizeMev(): Promise<NormalizeMevReport> {
  const privateKey = process.env.MEV_TREASURY_PRIVATE_KEY ?? process.env.TREASURY_PRIVATE_KEY
  if (!privateKey) throw new Error('MEV_TREASURY_PRIVATE_KEY or TREASURY_PRIVATE_KEY not set in env')

  const feeVault = getFeeVaultAddress()
  const account = privateKeyToAccount(`0x${privateKey}` as Hex)
  const treasury = account.address as Address

  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'),
  })

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'),
  })

  const usdcToken = BASE_TOKENS.find((token) => token.symbol === 'USDC')
  if (!usdcToken) throw new Error('USDC token config missing from BASE_TOKENS')

  const results: NormalizeMevTokenResult[] = []
  let tokensNormalized = 0
  let totalUsdcDeposited = 0n

  for (const token of BASE_TOKENS) {
    const result: NormalizeMevTokenResult = {
      symbol: token.symbol,
      address: token.address,
      balanceRaw: '0',
      balanceUsd: 0,
      status: 'zero_balance',
    }

    try {
      const balance = await publicClient.readContract({
        address: token.address as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [treasury],
      })
      result.balanceRaw = balance.toString()

      if (balance === 0n) {
        results.push(result)
        continue
      }

      const usdValue = await estimateUsd(token, balance, treasury)
      result.balanceUsd = usdValue

      if (usdValue < DUST_THRESHOLD_USD) {
        result.status = 'skipped_dust'
        results.push(result)
        continue
      }

      let usdcReceived = 0n

      if (token.symbol === 'USDC') {
        usdcReceived = balance
      } else {
        const usdcBefore = await publicClient.readContract({
          address: usdcToken.address as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [treasury],
        })

        let quote: LifiQuote | null = null
        try {
          quote = await getLifiQuote(token, balance, treasury, usdcToken.address)
        } catch (err) {
          result.status = 'no_route'
          result.error = (err as Error).message
          results.push(result)
          continue
        }

        if (!quote?.transactionRequest) {
          result.status = 'no_route'
          results.push(result)
          continue
        }

        const { transactionRequest, estimate } = quote

        if (estimate?.approvalAddress) {
          await ensureAllowance(
            publicClient,
            walletClient,
            treasury,
            token.address as Address,
            estimate.approvalAddress as Address,
            balance
          )
        }

        const swapTxHash = await walletClient.sendTransaction({
          to: transactionRequest.to as Address,
          data: transactionRequest.data as Hex,
          value: BigInt(transactionRequest.value ?? '0'),
          gasLimit: BigInt(transactionRequest.gasLimit),
          gasPrice: BigInt(transactionRequest.gasPrice),
        })
        await publicClient.waitForTransactionReceipt({ hash: swapTxHash })

        const usdcAfter = await publicClient.readContract({
          address: usdcToken.address as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [treasury],
        })

        usdcReceived = usdcAfter - usdcBefore
        result.txHash = swapTxHash
      }

      if (usdcReceived === 0n) {
        result.status = 'error'
        result.error = 'Normalization produced zero USDC'
        results.push(result)
        continue
      }

      await ensureAllowance(
        publicClient,
        walletClient,
        treasury,
        usdcToken.address as Address,
        feeVault,
        usdcReceived
      )

      const feeVaultTxHash = await walletClient.writeContract({
        chain: base,
        address: feeVault,
        abi: FEE_VAULT_ABI,
        functionName: 'receiveFees',
        args: [usdcReceived, 'mev-normalized'],
      })
      await publicClient.waitForTransactionReceipt({ hash: feeVaultTxHash })

      result.status = 'swapped'
      result.usdcReceivedRaw = usdcReceived.toString()
      result.feeVaultTxHash = feeVaultTxHash
      totalUsdcDeposited += usdcReceived
      tokensNormalized++
    } catch (err) {
      result.status = 'error'
      result.error = (err as Error).message
    }

    results.push(result)
  }

  return {
    treasury,
    feeVault,
    normalizedAt: new Date().toISOString(),
    tokensChecked: BASE_TOKENS.length,
    tokensNormalized,
    totalUsdcDeposited: totalUsdcDeposited.toString(),
    results,
  }
}
