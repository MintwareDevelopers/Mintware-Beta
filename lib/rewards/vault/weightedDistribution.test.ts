// =============================================================================
// weightedDistribution.test.ts — economics of the two-token weighted allocation
// + twoTokenMerkleBuilder leaf-encoding agreement with the Solidity contract.
// Pure functions — no Supabase.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { keccak256, encodeAbiParameters } from 'viem'
import {
  computeWeightedDistribution,
  REFEREE_BOOST,
  REFERRER_RATE,
  referralQualityFactor,
  attrMultiplier,
  durationMultiplier,
  type WeightedLpInput,
} from '@/lib/rewards/vault/weightedDistribution'
import {
  buildTwoTokenMerkleTree,
  toWei,
} from '@/lib/rewards/vault/twoTokenMerkleBuilder'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b0'
const C = '0x00000000000000000000000000000000000000c2'

function lp(partial: Partial<WeightedLpInput> & { wallet: string }): WeightedLpInput {
  return {
    liquidityUnits: 100,
    lockTier: 'flex',
    daysHeld: 0,
    attrPercentile: 0,
    ...partial,
  }
}

describe('multiplier tables', () => {
  it('attribution bands', () => {
    expect(attrMultiplier(0)).toBe(1.0)
    expect(attrMultiplier(33)).toBe(1.0)
    expect(attrMultiplier(34)).toBe(1.25)
    expect(attrMultiplier(67)).toBe(1.5)
  })
  it('duration bands', () => {
    expect(durationMultiplier(0)).toBe(1.0)
    expect(durationMultiplier(30)).toBe(1.1)
    expect(durationMultiplier(90)).toBe(1.2)
    expect(durationMultiplier(180)).toBe(1.3)
  })
  it('quality factor is linear and clamped', () => {
    expect(referralQualityFactor(0)).toBe(0)
    expect(referralQualityFactor(50)).toBe(0.5)
    expect(referralQualityFactor(100)).toBe(1)
    expect(referralQualityFactor(150)).toBe(1)
    expect(referralQualityFactor(-10)).toBe(0)
  })
})

describe('base split (no referrals)', () => {
  it('splits the fee pot pro-rata by weight and conserves it', () => {
    const lps = [
      lp({ wallet: A, liquidityUnits: 100 }),
      lp({ wallet: B, liquidityUnits: 300 }),
    ]
    const r = computeWeightedDistribution(lps, { amount0: 1000, amount1: 500 })
    const a = r.entries.find((e) => e.wallet === A)!
    const b = r.entries.find((e) => e.wallet === B)!
    // 100 : 300 → 25% : 75%
    expect(a.base0).toBeCloseTo(250)
    expect(b.base0).toBeCloseTo(750)
    expect(a.base1).toBeCloseTo(125)
    expect(b.base1).toBeCloseTo(375)
    // no referrals → margin 0, total == fee pot
    expect(r.marginRequired.amount0).toBe(0)
    expect(r.total.amount0).toBeCloseTo(1000)
    expect(r.total.amount1).toBeCloseTo(500)
  })

  it('higher attribution + lock earns a larger base share', () => {
    const lps = [
      lp({ wallet: A, liquidityUnits: 100, attrPercentile: 0,  lockTier: 'flex' }),
      lp({ wallet: B, liquidityUnits: 100, attrPercentile: 67, lockTier: 'core' }), // 1.5 × 1.5 = 2.25×
    ]
    const r = computeWeightedDistribution(lps, { amount0: 1000, amount1: 0 })
    const a = r.entries.find((e) => e.wallet === A)!
    const b = r.entries.find((e) => e.wallet === B)!
    expect(b.base0).toBeGreaterThan(a.base0)
    // weights 100 vs 225 → shares 100/325 vs 225/325
    expect(a.base0).toBeCloseTo(1000 * (100 / 325))
    expect(b.base0).toBeCloseTo(1000 * (225 / 325))
  })

  it('zero total weight does not crash and yields zero', () => {
    const r = computeWeightedDistribution([lp({ wallet: A, liquidityUnits: 0 })], { amount0: 1000, amount1: 1000 })
    expect(r.entries[0].amount0).toBe(0)
    expect(r.total.amount0).toBe(0)
  })
})

describe('referral bonuses (margin-funded, double-sided, anti-sybil)', () => {
  it('referee boost is +10% of the referred LP base, and is NON-DILUTIVE to others', () => {
    // Two LPs with IDENTICAL base weight; only B is referred (by C). Because the
    // referral bonus is margin-funded (not taken from the pot), A's base share and
    // final payout must be exactly unchanged by B being referred.
    const lps = [
      lp({ wallet: A, liquidityUnits: 100 }),
      lp({ wallet: B, liquidityUnits: 100, referrer: C }),
    ]
    const r = computeWeightedDistribution(lps, { amount0: 1000, amount1: 0 })
    const a = r.entries.find((e) => e.wallet === A)!
    const b = r.entries.find((e) => e.wallet === B)!
    // base split unchanged: 500/500
    expect(a.base0).toBeCloseTo(500)
    expect(b.base0).toBeCloseTo(500)
    // A's payout is exactly its base — referral never touched it
    expect(a.amount0).toBeCloseTo(500)
    // B gets +10% referee boost from margin
    expect(b.refereeBonus0).toBeCloseTo(REFEREE_BOOST * 500)
    expect(b.amount0).toBeCloseTo(500 + 0.10 * 500)
  })

  it('referrer earns REFERRER_RATE × base × quality; margin + total reconcile', () => {
    const lps = [
      lp({ wallet: B, liquidityUnits: 100, attrPercentile: 100, referrer: C }),
    ]
    const r = computeWeightedDistribution(lps, { amount0: 1000, amount1: 0 })
    const b = r.entries.find((e) => e.wallet === B)!
    const c = r.entries.find((e) => e.wallet === C)!
    // B is the only LP → base0 = 1000
    expect(b.base0).toBeCloseTo(1000)
    // referrer C (not an LP) gets a bonus-only entry = 20% × 1000 × (100/100)
    expect(c.base0).toBe(0)
    expect(c.referrerReward0).toBeCloseTo(REFERRER_RATE * 1000 * 1)
    expect(c.amount0).toBeCloseTo(200)
    // margin = referee boost (100) + referrer reward (200); total = fees(1000) + margin(300)
    expect(r.marginRequired.amount0).toBeCloseTo(0.10 * 1000 + 200)
    expect(r.total.amount0).toBeCloseTo(1000 + r.marginRequired.amount0)
  })

  it('anti-sybil: a score-0 referee earns its referrer ~nothing', () => {
    const lps = [
      lp({ wallet: B, liquidityUnits: 100, attrPercentile: 0, referrer: C }),
    ]
    const r = computeWeightedDistribution(lps, { amount0: 1000, amount1: 0 })
    const c = r.entries.find((e) => e.wallet === C)
    // quality factor 0 → no referrer reward → no bonus-only entry created
    expect(c?.referrerReward0 ?? 0).toBe(0)
    // referee still gets their own boost though (that's their earning, not a sybil vector)
    const b = r.entries.find((e) => e.wallet === B)!
    expect(b.refereeBonus0).toBeCloseTo(0.10 * 1000)
  })

  it('half-percentile referee gives half the referrer reward', () => {
    const lps = [lp({ wallet: B, liquidityUnits: 100, attrPercentile: 50, referrer: C })]
    const r = computeWeightedDistribution(lps, { amount0: 1000, amount1: 0 })
    const c = r.entries.find((e) => e.wallet === C)!
    expect(c.referrerReward0).toBeCloseTo(REFERRER_RATE * 1000 * 0.5)
  })
})

describe('twoTokenMerkleBuilder', () => {
  it('toWei respects per-token decimals and never goes negative', () => {
    expect(toWei(1.5, 6)).toBe(1_500_000n)
    expect(toWei(1, 18)).toBe(1_000_000_000_000_000_000n)
    expect(toWei(0, 18)).toBe(0n)
    expect(toWei(-5, 18)).toBe(0n)
  })

  it('builds a verifiable tree; totals equal Σ leaves; drops zero rows', () => {
    const entries = [
      { wallet: A, amount0: 10, amount1: 20, base0: 10, base1: 20, baseWeight: 1, baseShare: 1, refereeBonus0: 0, refereeBonus1: 0, referrerReward0: 0, referrerReward1: 0 },
      { wallet: B, amount0: 30, amount1: 40, base0: 30, base1: 40, baseWeight: 1, baseShare: 1, refereeBonus0: 0, refereeBonus1: 0, referrerReward0: 0, referrerReward1: 0 },
      { wallet: C, amount0: 0,  amount1: 0,  base0: 0,  base1: 0,  baseWeight: 0, baseShare: 0, refereeBonus0: 0, refereeBonus1: 0, referrerReward0: 0, referrerReward1: 0 },
    ]
    const res = buildTwoTokenMerkleTree(entries, 18, 6)
    expect(res.walletsIncluded).toBe(2)     // C dropped (both zero)
    expect(res.walletsDroppedZero).toBe(1)
    expect(res.total0Wei).toBe((toWei(10, 18) + toWei(30, 18)).toString())
    expect(res.total1Wei).toBe((toWei(20, 6) + toWei(40, 6)).toString())
    // every leaf's proof verifies against the root
    for (const leaf of res.leaves) {
      const ok = StandardMerkleTree.verify(
        res.root,
        ['address', 'uint256', 'uint256'],
        [leaf.wallet, leaf.amount0Wei, leaf.amount1Wei],
        leaf.proof
      )
      expect(ok).toBe(true)
    }
  })

  it('leaf hash matches the Solidity contract encoding exactly', () => {
    // Contract: keccak256(bytes.concat(keccak256(abi.encode(wallet, amount0, amount1))))
    // For a single-leaf StandardMerkleTree, root == that leaf hash.
    const wallet = A
    const a0 = toWei(10, 18)
    const a1 = toWei(20, 6)
    const res = buildTwoTokenMerkleTree(
      [{ wallet, amount0: 10, amount1: 20, base0: 10, base1: 20, baseWeight: 1, baseShare: 1, refereeBonus0: 0, refereeBonus1: 0, referrerReward0: 0, referrerReward1: 0 }],
      18, 6
    )
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
        [wallet as `0x${string}`, a0, a1]
      )
    )
    const expectedLeaf = keccak256(inner)
    expect(res.root.toLowerCase()).toBe(expectedLeaf.toLowerCase())
  })
})
