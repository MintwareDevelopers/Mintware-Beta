import { describe, it, expect } from 'vitest'
import { oracleSettler, type SettleWriter } from './oracleSettler'
import type { PaymentPayload, PaymentRequirements } from './types'
import type { RelayerPermit } from './facilitator'

const GATEWAY = '0x1D07000000000000000000000000000000005399'
const PAYER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PAYTO = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const HOLD = ('0x' + '11'.repeat(32)) as `0x${string}`
const TX = ('0x' + 'ab'.repeat(32)) as `0x${string}`

const permit: RelayerPermit = {
  user: PAYER,
  max_daily_spend_usdc: '2000000000',
  nonce: '7',
  deadline: '9999999999',
  signature: '0x' + 'cd'.repeat(65),
}

function reqs(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'base',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    payTo: PAYTO,
    maxAmountRequired: '10000',
    resource: 'https://mintware.finance/api/x402/score',
    description: 'score',
    mimeType: 'application/json',
    maxTimeoutSeconds: 60,
    ...over,
  } as PaymentRequirements
}

function payload(value = '10000'): PaymentPayload {
  return {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: { signature: '0x' + 'ef'.repeat(65), authorization: { from: PAYER, to: PAYTO, value } },
  } as unknown as PaymentPayload
}

/** A writer that records the args it was handed and returns a canned receipt. */
function recordingWriter(status: 'success' | 'reverted' = 'success') {
  const calls: Parameters<SettleWriter['submit']>[0][] = []
  const writer: SettleWriter = {
    async submit(input) {
      calls.push(input)
      return { txHash: TX, status }
    },
  }
  return { writer, calls }
}

describe('oracleSettler', () => {
  it('maps the x402 payload + standing permit into a correct settleSpend and returns the tx hash', async () => {
    const { writer, calls } = recordingWriter('success')
    const s = oracleSettler({ gateway: GATEWAY, chainId: 8453, writer })

    const out = await s.settle({ holdId: HOLD, payload: payload('10000'), reqs: reqs(), permit })

    expect(out).toEqual({ success: true, txHash: TX })
    expect(calls).toHaveLength(1)
    const a = calls[0]
    expect(a.gateway.toLowerCase()).toBe(GATEWAY.toLowerCase())
    expect(a.chainId).toBe(8453)
    expect(a.holdId).toBe(HOLD)
    expect(a.user.toLowerCase()).toBe(PAYER.toLowerCase())
    expect(a.assets).toBe(10000n)
    expect(a.receiver.toLowerCase()).toBe(PAYTO.toLowerCase()) // fee revenue → payTo
    expect(a.permit.maxDailySpendUSDC).toBe(2000000000n)
    expect(a.permit.nonce).toBe(7n)
    expect(a.permitSig).toBe(permit.signature)
    // no edge auth for a sub-$250 charge → the empty tuple
    expect(a.edgeAuth.amountUSDC).toBe(0n)
    expect(a.edgeSig).toBe('0x')
  })

  it('reports settle_reverted when the tx mines with status 0 (never a false settle)', async () => {
    const { writer } = recordingWriter('reverted')
    const s = oracleSettler({ gateway: GATEWAY, chainId: 8453, writer })
    const out = await s.settle({ holdId: HOLD, payload: payload(), reqs: reqs(), permit })
    expect(out.success).toBe(false)
    expect(out.errorReason).toBe('settle_reverted')
    expect(out.txHash).toBe(TX)
  })

  it('fails closed (no submit) when the standing permit is absent', async () => {
    const { writer, calls } = recordingWriter()
    const s = oracleSettler({ gateway: GATEWAY, chainId: 8453, writer })
    const out = await s.settle({ holdId: HOLD, payload: payload(), reqs: reqs() })
    expect(out).toEqual({ success: false, errorReason: 'settlement_permit_unavailable' })
    expect(calls).toHaveLength(0)
  })

  it('fails closed when the gateway or chain is unconfigured', async () => {
    const { writer, calls } = recordingWriter()
    const noGw = oracleSettler({ chainId: 8453, writer })
    expect((await noGw.settle({ holdId: HOLD, payload: payload(), reqs: reqs(), permit })).errorReason).toBe('settle_gateway_unconfigured')
    const noChain = oracleSettler({ gateway: GATEWAY, writer })
    expect((await noChain.settle({ holdId: HOLD, payload: payload(), reqs: reqs(), permit })).errorReason).toBe('settle_chain_unconfigured')
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-positive signed amount before any submit', async () => {
    const { writer, calls } = recordingWriter()
    const s = oracleSettler({ gateway: GATEWAY, chainId: 8453, writer })
    const out = await s.settle({ holdId: HOLD, payload: payload('0'), reqs: reqs(), permit })
    expect(out.success).toBe(false)
    expect(out.errorReason).toBe('settlement_non_positive_amount')
    expect(calls).toHaveLength(0)
  })

  it('threads a high-value edge auth tuple through when present', async () => {
    const { writer, calls } = recordingWriter('success')
    const s = oracleSettler({ gateway: GATEWAY, chainId: 8453, writer })
    const edge = {
      hold_id: HOLD,
      user: PAYER,
      amount_usdc: '300000000',
      nonce: '3',
      expiry: '9999999999',
      signature: '0x' + '12'.repeat(65),
    }
    await s.settle({ holdId: HOLD, payload: payload('300000000'), reqs: reqs({ maxAmountRequired: '300000000' }), permit, edge })
    const a = calls[0]
    expect(a.edgeAuth.amountUSDC).toBe(300000000n)
    expect(a.edgeAuth.nonce).toBe(3n)
    expect(a.edgeSig).toBe(edge.signature)
  })
})
