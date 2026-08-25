import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { directSettler, type DirectSettleWriter } from './directSettler'
import { EIP3009_TRANSFER_TYPES, usdcDomainFor } from './verifyAuthorization'
import { USDC_BY_NETWORK } from './config'
import type { PaymentPayload, PaymentRequirements } from './types'

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const account = privateKeyToAccount(KEY)
const PAYTO = '0x7fD88B026B65B9f54FFE694bB422bBCC504D7E06'
const NETWORK = 'base-sepolia'
const ASSET = USDC_BY_NETWORK[NETWORK]
const NONCE = ('0x' + '22'.repeat(32)) as `0x${string}`
const TX = ('0x' + 'ab'.repeat(32)) as `0x${string}`

async function signedPayload(over: { to?: string; value?: string; tamperSig?: boolean } = {}): Promise<PaymentPayload> {
  const to = over.to ?? PAYTO
  const value = over.value ?? '10000'
  const auth = { from: account.address, to, value, validAfter: '0', validBefore: '9999999999', nonce: NONCE }
  const domain = usdcDomainFor(NETWORK, ASSET)!
  let signature = await account.signTypedData({
    domain,
    types: EIP3009_TRANSFER_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: { from: auth.from, to: to as `0x${string}`, value: BigInt(value), validAfter: 0n, validBefore: 9999999999n, nonce: NONCE },
  })
  if (over.tamperSig) signature = ('0x' + '11'.repeat(65)) as `0x${string}`
  return { x402Version: 1, scheme: 'exact', network: NETWORK, payload: { signature, authorization: auth } } as unknown as PaymentPayload
}

function reqs(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: 'exact', network: NETWORK, asset: ASSET, payTo: PAYTO, maxAmountRequired: '10000',
    resource: 'https://mintware.finance/api/x402/score', description: 'score', nonce: 'r1',
    validUntil: 9999999999, maxTimeoutSeconds: 300, ...over,
  } as unknown as PaymentRequirements
}

function recordingWriter(status: 'success' | 'reverted' = 'success') {
  const calls: Parameters<DirectSettleWriter['submit']>[0][] = []
  const writer: DirectSettleWriter = { async submit(i) { calls.push(i); return { txHash: TX, status } } }
  return { writer, calls }
}

describe('directSettler', () => {
  it('submits transferWithAuthorization to payTo and returns the tx hash', async () => {
    const { writer, calls } = recordingWriter('success')
    const out = await directSettler({ writer }).settle({ payload: await signedPayload(), reqs: reqs() })
    expect(out).toEqual({ success: true, txHash: TX })
    expect(calls).toHaveLength(1)
    const a = calls[0]
    expect(a.chainId).toBe(84532)
    expect(a.usdc.toLowerCase()).toBe(ASSET.toLowerCase())
    expect(a.from.toLowerCase()).toBe(account.address.toLowerCase())
    expect(a.to.toLowerCase()).toBe(PAYTO.toLowerCase()) // USDC goes straight to the seller wallet
    expect(a.value).toBe(10000n)
    expect(a.nonce).toBe(NONCE)
    expect(a.v === 27 || a.v === 28).toBe(true)
  })

  it('rejects a wrong recipient off-chain (no gas spent)', async () => {
    const { writer, calls } = recordingWriter()
    const out = await directSettler({ writer }).settle({ payload: await signedPayload({ to: '0x000000000000000000000000000000000000dEaD' }), reqs: reqs() })
    expect(out.success).toBe(false)
    expect(out.errorReason).toBe('wrong_recipient')
    expect(calls).toHaveLength(0)
  })

  it('rejects a bad signature off-chain', async () => {
    const { writer, calls } = recordingWriter()
    const out = await directSettler({ writer }).settle({ payload: await signedPayload({ tamperSig: true }), reqs: reqs() })
    expect(out.success).toBe(false)
    expect(out.errorReason).toBe('invalid_payment_signature')
    expect(calls).toHaveLength(0)
  })

  it('reports transfer_reverted when the tx mines with status 0', async () => {
    const { writer } = recordingWriter('reverted')
    const out = await directSettler({ writer }).settle({ payload: await signedPayload(), reqs: reqs() })
    expect(out.success).toBe(false)
    expect(out.errorReason).toBe('transfer_reverted')
    expect(out.txHash).toBe(TX)
  })

  it('rejects an unsupported network', async () => {
    const { writer, calls } = recordingWriter()
    const out = await directSettler({ writer }).settle({ payload: await signedPayload(), reqs: reqs({ network: 'solana' }) })
    expect(out.errorReason).toBe('unsupported_network')
    expect(calls).toHaveLength(0)
  })
})
