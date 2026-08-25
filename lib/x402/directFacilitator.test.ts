import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { DirectFacilitator } from './directFacilitator'
import { EIP3009_TRANSFER_TYPES, usdcDomainFor } from './verifyAuthorization'
import { USDC_BY_NETWORK } from './config'
import type { PaymentPayload, PaymentRequirements } from './types'
import type { Settler } from './facilitator'

const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const PAYTO = '0x7fD88B026B65B9f54FFE694bB422bBCC504D7E06'
const NETWORK = 'base-sepolia'
const ASSET = USDC_BY_NETWORK[NETWORK]
const NONCE = ('0x' + '33'.repeat(32)) as `0x${string}`

async function signedPayload(to = PAYTO): Promise<PaymentPayload> {
  const auth = { from: account.address, to, value: '10000', validAfter: '0', validBefore: '9999999999', nonce: NONCE }
  const signature = await account.signTypedData({
    domain: usdcDomainFor(NETWORK, ASSET)!,
    types: EIP3009_TRANSFER_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: { from: auth.from, to: to as `0x${string}`, value: 10000n, validAfter: 0n, validBefore: 9999999999n, nonce: NONCE },
  })
  return { x402Version: 1, scheme: 'exact', network: NETWORK, payload: { signature, authorization: auth } } as unknown as PaymentPayload
}

const reqs = (): PaymentRequirements => ({
  scheme: 'exact', network: NETWORK, asset: ASSET, payTo: PAYTO, maxAmountRequired: '10000',
  resource: 'r', description: 'd', nonce: 'n', validUntil: 9999999999, maxTimeoutSeconds: 300,
}) as unknown as PaymentRequirements

const okSettler: Settler = { async settle() { return { success: true, txHash: '0xfeed' } } }

describe('DirectFacilitator', () => {
  const f = new DirectFacilitator({ supportedNetworks: [NETWORK], settler: okSettler })

  it('verify() accepts a valid signed transfer to payTo', async () => {
    const v = await f.verify(reqs(), await signedPayload(), 1000)
    expect(v.isValid).toBe(true)
    expect(v.payer?.toLowerCase()).toBe(account.address.toLowerCase())
  })

  it('verify() rejects a wrong recipient', async () => {
    const v = await f.verify(reqs(), await signedPayload('0x000000000000000000000000000000000000dEaD'), 1000)
    expect(v.isValid).toBe(false)
    expect(v.invalidReason).toBe('wrong_recipient')
  })

  it('verify() rejects an unsupported network', async () => {
    const other = new DirectFacilitator({ supportedNetworks: ['base'], settler: okSettler })
    const v = await other.verify(reqs(), await signedPayload(), 1000)
    expect(v.isValid).toBe(false)
    // network_mismatch (payload says base-sepolia, reqs says base-sepolia but not supported) → unsupported_network
    expect(['unsupported_network', 'network_mismatch']).toContain(v.invalidReason)
  })

  it('settle() delegates to the settler', async () => {
    const out = await f.settle(reqs(), await signedPayload())
    expect(out).toEqual({ success: true, txHash: '0xfeed', network: NETWORK, errorReason: undefined })
  })

  it('supported() advertises the exact scheme only', async () => {
    expect(await f.supported()).toEqual({ schemes: ['exact'], networks: [NETWORK] })
  })
})
