// End-to-end flow test for the Bridge card rail — drives the REAL orchestration (onboarding runner +
// approve orchestrator + reconcile) with fakes for the external legs (Bridge client, Privy signer,
// chain, DB). This is the "test the whole flow" test: issue → approve → prime → activate → spend →
// reconcile → refill, plus the cold-decline guard on the unhappy path.

import { afterEach, describe, expect, it } from 'vitest'
import { runOnboarding, type OnboardDeps } from '@/lib/org/bridgeOnboard'
import { grantBridgeApproval } from '@/lib/org/bridgeApprove'
import { reconcileBridgeEvent, type ReconcileDeps } from '@/lib/org/bridgeReconcile'
import type { OnboardState } from '@/lib/cards/onboard'
import type { WalletSigner } from '@/lib/org/walletSigner'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SPENDER = '0x3333333333333333333333333333333333333333'
const DAY = 500_000_000n

const fakeSigner: WalletSigner = { async sendTransaction() { return { txHash: '0xsig' } } }

const saved = process.env.CARD_BRIDGE_ENABLED
afterEach(() => {
  if (saved === undefined) delete process.env.CARD_BRIDGE_ENABLED
  else process.env.CARD_BRIDGE_ENABLED = saved
})

/** In-memory onboarding harness: each dep mutates a shared state exactly like the real effects would. */
function harness(opts: { primeConfirms: boolean }) {
  const state: OnboardState = { cardIssued: false, approvalGranted: false, bufferPrimed: false, activated: false }
  const events: string[] = []
  const deps: OnboardDeps = {
    async loadState() { return { ...state } },
    async issueCard() { events.push('issue'); state.cardIssued = true },
    async grantApproval() {
      // exercises the REAL approve orchestrator + calldata encoding
      const r = await grantBridgeApproval({ usdcAddress: USDC, dailyCapAtomic: DAY, signer: fakeSigner, spender: SPENDER })
      if (!r.ok) throw new Error(`approval failed: ${r.reason}`)
      events.push('approve')
      state.approvalGranted = true
    },
    async primeBuffer() {
      events.push('prime')
      // only mark primed when the (simulated) on-chain refill confirms to the minimum
      if (opts.primeConfirms) state.bufferPrimed = true
    },
    async activate() { events.push('activate'); state.activated = true },
  }
  return { state, events, deps }
}

describe('bridge card — full onboarding flow', () => {
  it('runs issue → approve → prime → activate and never activates before the buffer is primed', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const h = harness({ primeConfirms: true })
    const res = await runOnboarding(h.deps)

    expect(res.complete).toBe(true)
    expect(res.ran).toEqual(['issue_card', 'grant_approval', 'prime_buffer', 'activate'])
    // activation happened strictly after priming
    expect(h.events.indexOf('activate')).toBeGreaterThan(h.events.indexOf('prime'))
    expect(h.state.activated).toBe(true)
  })

  it('cold-decline guard: if the buffer never primes, the card is NEVER activated', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const h = harness({ primeConfirms: false })
    const res = await runOnboarding(h.deps)

    expect(res.complete).toBe(false)
    expect(res.stopped).toContain('prime_buffer')
    expect(h.events).not.toContain('activate') // the whole point
    expect(h.state.activated).toBe(false)
  })

  it('resumes idempotently from a partially-onboarded card', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const h = harness({ primeConfirms: true })
    h.state.cardIssued = true
    h.state.approvalGranted = true // already done in a prior run
    const res = await runOnboarding(h.deps)
    expect(res.complete).toBe(true)
    expect(res.ran).toEqual(['prime_buffer', 'activate']) // only the remaining steps
  })
})

describe('bridge card — spend/reconcile loop', () => {
  function reconcileHarness() {
    const refills: Array<{ card: string; trigger: string }> = []
    const syncs: string[] = []
    const deps: ReconcileDeps = {
      async syncBuffer(card) { syncs.push(card) },
      async refill(card, trigger) { refills.push({ card, trigger }); return { ok: true } },
    }
    return { refills, syncs, deps }
  }

  it('a spend event resyncs then refills the buffer (spend, still earning)', async () => {
    const h = reconcileHarness()
    const r = await reconcileBridgeEvent({ kind: 'spend', orgCardId: 'card_1', amountAtomic: 1_200_000n }, h.deps)
    expect(r).toEqual({ action: 'refilled' })
    expect(h.syncs).toEqual(['card_1'])
    expect(h.refills).toEqual([{ card: 'card_1', trigger: 'bridge_spend' }])
  })

  it('a refund resyncs only — no refill (balance went up)', async () => {
    const h = reconcileHarness()
    const r = await reconcileBridgeEvent({ kind: 'refund', orgCardId: 'card_1' }, h.deps)
    expect(r).toEqual({ action: 'synced' })
    expect(h.syncs).toEqual(['card_1'])
    expect(h.refills).toHaveLength(0)
  })

  it('ignores unrelated events and events with no known card', async () => {
    const h = reconcileHarness()
    expect(await reconcileBridgeEvent({ kind: 'ignore' }, h.deps)).toEqual({ action: 'ignored' })
    expect(await reconcileBridgeEvent({ kind: 'spend' }, h.deps)).toEqual({ action: 'no_card' })
    expect(h.refills).toHaveLength(0)
  })

  it('reports a skipped refill without throwing (webhook must still ack)', async () => {
    const deps: ReconcileDeps = {
      async syncBuffer() {},
      async refill() { return { ok: false, reason: 'at_target' } },
    }
    const r = await reconcileBridgeEvent({ kind: 'spend', orgCardId: 'card_1' }, deps)
    expect(r).toEqual({ action: 'refill_skipped', reason: 'at_target' })
  })
})
