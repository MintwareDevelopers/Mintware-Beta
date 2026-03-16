import type { WalletClient } from 'viem'

const ZEROX_BASE_URL = 'https://api.0x.org'
const ZEROX_API_KEY = process.env.NEXT_PUBLIC_0X_API_KEY || ''

export interface ZeroxQuoteParams {
  chainId: number
  sellToken: string
  buyToken: string
  sellAmount: string // in wei
  taker: string
  feeRecipient?: string
  feeBps?: number
  campaignId?: string
  referrer?: string
}

export interface ZeroxQuote {
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
  // Raw response fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any
}

export async function getQuote(
  params: ZeroxQuoteParams
): Promise<ZeroxQuote> {
  const {
    chainId,
    sellToken,
    buyToken,
    sellAmount,
    taker,
    feeRecipient,
    feeBps,
  } = params

  const searchParams = new URLSearchParams({
    chainId: chainId.toString(),
    sellToken,
    buyToken,
    sellAmount,
    taker,
  })

  if (feeRecipient) {
    searchParams.set('swapFeeRecipient', feeRecipient)
    searchParams.set('swapFeeBps', (feeBps ?? 10).toString())
    searchParams.set('swapFeeToken', 'buyToken')
  } else {
    // No treasury address set — log warning, proceed without fee
    if (typeof window !== 'undefined') {
      console.warn('[MintWare] MW treasury address not set — swap fee omitted')
    }
  }

  const res = await fetch(
    `${ZEROX_BASE_URL}/swap/allowance-holder/quote?${searchParams.toString()}`,
    {
      headers: {
        '0x-api-key': ZEROX_API_KEY,
        '0x-version': 'v2',
      },
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`0x quote failed: ${res.status} ${text}`)
  }

  const data = await res.json()

  return {
    buyAmount: data.buyAmount ?? '0',
    price: data.price ?? '0',
    estimatedGas: data.transaction?.gas ?? '200000',
    transaction: {
      to: data.transaction?.to ?? '',
      data: data.transaction?.data ?? '0x',
      value: data.transaction?.value ?? '0',
      gas: data.transaction?.gas ?? '200000',
      gasPrice: data.transaction?.gasPrice ?? '0',
    },
    raw: data,
  }
}

export async function executeSwap(
  quote: ZeroxQuote,
  walletClient: WalletClient
): Promise<`0x${string}`> {
  const txHash = await walletClient.sendTransaction({
    account: walletClient.account!,
    chain: walletClient.chain,
    to: quote.transaction.to as `0x${string}`,
    data: quote.transaction.data as `0x${string}`,
    value: BigInt(quote.transaction.value),
    gas: BigInt(quote.transaction.gas),
  })
  return txHash
}
