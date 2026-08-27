// End-to-end flow test for the Bridge card rail — drives the REAL orchestration (onboarding runner +
// approve orchestrator + reconcile) with fakes for the external legs (Bridge client, Privy signer,
// chain, DB). This is the "test the whole flow" test: issue → (member permit) → approve → prime →
// go_live → spend → reconcile → refill, plus the pauses and guards on the unhappy paths.

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

/** In-memory onboarding harness: each dep mutates a shared state exactly like the real effects would.
 *  `memberSigns` toggles whether the member has signed their standing permit (a member action). */
function harness(opts: { primeConfirms: boolean; memberSigns: boolean }) {
  const state: OnboardState = {
    cardIssued: false,
    permitSigned: opts.memberSigns, // set out-of-band by the member, not by the orchestrator
    approvalGranted: false,
    bufferPrimed: false,
    liveProvisioned: false,
  }
  const events: string[] = []
  const deps: OnboardDeps = {
    async loadState() { return { ...state } },
    async issueCard() { events.push('issue'); state.cardIssued = true },
    async grantApproval() {
      const r = await grantBridgeApproval({ usdcAddress: USDC, dailyCapAtomic: DAY, signer: fakeSigner, spender: SPENDER })
      if (!r.ok) throw new Error(`approval failed: ${r.reason}`)
      events.push('approve')
      state.approvalGranted = true
    },
    async primeBuffer() {
      events.push('prime')
      if (opts.primeConfirms) state.bufferPrimed = true
    },
    async goLive() { events.push('go_live'); state.liveProvisioned = true },
  }
  return { state, events, deps }
}

describe('bridge card — full onboarding flow', () => {
  it('runs issue → (permit) → approve → prime → go_live and never goes live before the buffer is primed', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const h = harness({ primeConfirms: true, memberSigns: true })
    const res = await runOnboarding(h.deps)

    expect(res.complete).toBe(true)
    expect(res.ran).toEqual(['issue_card', 'grant_approval', 'prime_buffer', 'go_live']) // permit is the member's, not "run"
    expect(h.events.indexOf('go_live')).toBeGreaterThan(h.events.indexOf('prime'))
    expect(h.state.liveProvisioned).toBe(true)
  })

  it('pauses for the member permit — issues the card, then waits (never primes/goes live)', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const h = harness({ primeConfirms: true, memberSigns: false })
    const res = await runOnboarding(h.deps)

    expect(res.complete).toBe(false)
    expect(res.awaitingMember).toBe('sign_permit')
    expect(res.ran).toEqual(['issue_card'])
    expect(h.events).not.toContain('prime')
    expect(h.events).not.toContain('go_live')
  })

  it('cold-decline guard: if the buffer never primes, the card is NEVER made live', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const h = harness({ primeConfirms: false, memberSigns: true })
    const res = await runOnboarding(h.deps)

    expect(res.complete).toBe(false)
    expect(res.stopped).toContain('prime_buffer')
    expect(h.events).not.toContain('go_live')
    expect(h.state.liveProvisioned).toBe(false)
  })

  it('resumes idempotently from a partially-onboarded card (permit already signed)', async () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    const h = harness({ primeConfirms: true, memberSigns: true })
    h.state.cardIssued = true
    h.state.approvalGranted = true
    const res = await runOnboarding(h.deps)
    expect(res.complete).toBe(true)
    expect(res.ran).toEqual(['prime_buffer', 'go_live'])
  })
})

describe('bridge card — spend/reconcile loop', () => {
  function reconcileHarness() {
    const refills: Array<{ card: string; trigger: string }> = []
    const syncs: string[] = []
    const deps: ReconcileDeps = {
      async syncBuffer(card) { syncs.push(card); return { ok: true } },
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

  it('a refund resyncs only when no sweep is configured (balance went up)', async () => {
    const h = reconcileHarness()
    const r = await reconcileBridgeEvent({ kind: 'refund', orgCardId: 'card_1' }, h.deps)
    expect(r).toEqual({ action: 'synced' })
    expect(h.refills).toHaveLength(0)
  })

  it('a refund SWEEPS the surplus back to the vault when a sweep is configured', async () => {
    const sweeps: string[] = []
    const deps: ReconcileDeps = {
      async syncBuffer() { return { ok: true } },
      async refill() { return { ok: true } },
      async sweep(card) { sweeps.push(card); return { ok: true } },
    }
    const r = await reconcileBridgeEvent({ kind: 'refund', orgCardId: 'card_1' }, deps)
    expect(r).toEqual({ action: 'swept' })
    expect(sweeps).toEqual(['card_1'])
  })

  it('reports sweep_skipped when the sweep declines (e.g. disabled / nothing above target)', async () => {
    const deps: ReconcileDeps = {
      async syncBuffer() { return { ok: true } },
      async refill() { return { ok: true } },
      async sweep() { return { ok: false, reason: 'nothing' } },
    }
    const r = await reconcileBridgeEvent({ kind: 'refund', orgCardId: 'card_1' }, deps)
    expect(r).toEqual({ action: 'sweep_skipped', reason: 'nothing' })
  })

  it('ignores unrelated events and events with no known card', async () => {
    const h = reconcileHarness()
    expect(await reconcileBridgeEvent({ kind: 'ignore' }, h.deps)).toEqual({ action: 'ignored' })
    expect(await reconcileBridgeEvent({ kind: 'spend' }, h.deps)).toEqual({ action: 'no_card' })
    expect(h.refills).toHaveLength(0)
  })

  it('reports a skipped refill without throwing (webhook must still ack)', async () => {
    const deps: ReconcileDeps = {
      async syncBuffer() { return { ok: true } },
      async refill() { return { ok: false, reason: 'at_target' } },
    }
    const r = await reconcileBridgeEvent({ kind: 'spend', orgCardId: 'card_1' }, deps)
    expect(r).toEqual({ action: 'refill_skipped', reason: 'at_target' })
  })

  it('a FAILED resync skips the refill (never sizes off a stale cache)', async () => {
    const refills: string[] = []
    const deps: ReconcileDeps = {
      async syncBuffer() { return { ok: false } }, // on-chain read failed, cache not refreshed
      async refill(card) { refills.push(card); return { ok: true } },
    }
    const r = await reconcileBridgeEvent({ kind: 'spend', orgCardId: 'card_1' }, deps)
    expect(r).toEqual({ action: 'sync_failed' })
    expect(refills).toHaveLength(0) // the whole point — no refill off an unreconciled cache
  })

  it('a throwing dep is caught → error action (webhook can still ack 200)', async () => {
    const deps: ReconcileDeps = {
      async syncBuffer() { throw new Error('supabase down') },
      async refill() { return { ok: true } },
    }
    const r = await reconcileBridgeEvent({ kind: 'spend', orgCardId: 'card_1' }, deps)
    expect(r.action).toBe('error')
  })
})
