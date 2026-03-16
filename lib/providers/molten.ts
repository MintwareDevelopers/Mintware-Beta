/**
 * Molten provider — Algebra SwapRouter on Core chain (chainId: 1116)
 *
 * NOTE: NEXT_PUBLIC_MOLTEN_ROUTER_ADDRESS must be set before Core swaps work.
 * If address is empty, gracefully returns a "coming soon" error — never crashes.
 */
import type { WalletClient } from 'viem'
import type { Token } from '@/config/tokens'

const MOLTEN_ROUTER_ADDRESS = process.env.NEXT_PUBLIC_MOLTEN_ROUTER_ADDRESS || ''

export interface MoltenQuoteParams {
  sellToken: Token
  buyToken: Token
  sellAmount: string // in wei
  taker: string
  campaignId?: string
  referrer?: string
}

export interface MoltenQuote {
  buyAmount: string
  price: string
  estimatedGas: string
  transaction: {
    to: string
    data: string
    value: string
    gas: string
    gasPrice: string
  }
}

// Minimal Algebra exactInputSingle ABI
const EXACT_INPUT_SINGLE_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'limitSqrtPrice', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const

export function isMoltenReady(): boolean {
  return Boolean(MOLTEN_ROUTER_ADDRESS)
}

export async function getQuote(
  params: MoltenQuoteParams
): Promise<MoltenQuote> {
  if (!MOLTEN_ROUTER_ADDRESS) {
    throw new Error('CORE_COMING_SOON')
  }

  // Fetch token prices via Covalent for price ratio calculation
  const covalentKey = process.env.NEXT_PUBLIC_COVALENT_API_KEY || ''
  const chainName = 'core-mainnet'

  const [sellPrice, buyPrice] = await Promise.all([
    fetchTokenPrice(params.sellToken.address, chainName, covalentKey),
    fetchTokenPrice(params.buyToken.address, chainName, covalentKey),
  ])

  if (!sellPrice || !buyPrice) {
    throw new Error('Unable to fetch token prices for Core swap')
  }

  // Calculate output amount from price ratio
  const sellAmountNum = Number(params.sellAmount) / 10 ** params.sellToken.decimals
  const sellValueUSD = sellAmountNum * sellPrice
  const buyAmountNum = sellValueUSD / buyPrice
  const buyAmount = Math.floor(
    buyAmountNum * 10 ** params.buyToken.decimals
  ).toString()

  const price = (buyAmountNum / sellAmountNum).toFixed(6)

  return {
    buyAmount,
    price,
    estimatedGas: '300000',
    transaction: {
      to: MOLTEN_ROUTER_ADDRESS,
      data: '0x', // Encoded calldata — built in executeSwap
      value: params.sellToken.address === '0x0000000000000000000000000000000000000000'
        ? params.sellAmount
        : '0',
      gas: '300000',
      gasPrice: '1000000000', // 1 gwei — Core is cheap
    },
  }
}

async function fetchTokenPrice(
  address: string,
  chainName: string,
  apiKey: string
): Promise<number | null> {
  try {
    const isNative =
      address === '0x0000000000000000000000000000000000000000' ||
      address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

    const endpoint = isNative
      ? `https://api.covalenthq.com/v1/pricing/tickers/?quote-currency=USD&format=JSON&tickers=CORE`
      : `https://api.covalenthq.com/v1/${chainName}/tokens/${address}/token_holders_v2/?quote-currency=USD`

    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return null
    const data = await res.json()

    if (isNative) {
      return data?.data?.items?.[0]?.quote_rate ?? null
    }
    return data?.data?.items?.[0]?.quote_rate ?? null
  } catch {
    return null
  }
}

export async function executeSwap(
  params: MoltenQuoteParams,
  walletClient: WalletClient
): Promise<`0x${string}`> {
  if (!MOLTEN_ROUTER_ADDRESS) {
    throw new Error('CORE_COMING_SOON')
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200) // +20 min

  // Encode campaignId + referrer into calldata (appended as ABI-encoded tail)
  // For now we pass them via the standard Algebra route, actual encoding
  // is a placeholder until Molten confirms their interface.
  const { encodeFunctionData } = await import('viem')

  const data = encodeFunctionData({
    abi: EXACT_INPUT_SINGLE_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: params.sellToken.address as `0x${string}`,
        tokenOut: params.buyToken.address as `0x${string}`,
        recipient: params.taker as `0x${string}`,
        deadline,
        amountIn: BigInt(params.sellAmount),
        amountOutMinimum: BigInt(0),
        limitSqrtPrice: BigInt(0),
      },
    ],
  })

  const txHash = await walletClient.sendTransaction({
    account: walletClient.account!,
    chain: walletClient.chain,
    to: MOLTEN_ROUTER_ADDRESS as `0x${string}`,
    data,
    value:
      params.sellToken.address === '0x0000000000000000000000000000000000000000'
        ? BigInt(params.sellAmount)
        : BigInt(0),
  })

  return txHash
}
