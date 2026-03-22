// =============================================================================
// merkleBuilder.test.ts — Unit tests for buildMerkleTree and commitDistribution
//
// buildMerkleTree is a pure function — no Supabase needed.
// commitDistribution wraps Supabase writes — mocked via vi.mock.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildMerkleTree, commitDistribution } from '@/lib/rewards/merkleBuilder'
import type { DistributionEntry } from '@/lib/rewards/epochProcessor'
import type { Campaign } from '@/lib/rewards/types'

// ---------------------------------------------------------------------------
// Mock Supabase (commitDistribution uses it; buildMerkleTree does not)
// ---------------------------------------------------------------------------

vi.mock('@/lib/web2/supabase', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

import { createSupabaseServiceClient } from '@/lib/web2/supabase'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal DistributionEntry factory */
function makeEntry(wallet: string, payout_usd: number, points: number = 100): DistributionEntry {
  return {
    wallet,
    points,
    attribution_percentile: 50,
    sharing_score: 100,
    multipliers: { attribution: 1.25, sharing: 1.15, combined: 1.4375 },
    payout_usd,
  }
}

const TOKEN_PRICE_USD = 2.0   // $2 per token
const TOKEN_DECIMALS  = 18

/** Minimal Campaign fixture for commitDistribution tests */
const fakeCampaign: Campaign = {
  id: 'camp-test',
  campaign_type: 'points',
  name: 'Test Campaign',
  status: 'live',
  closed: false,
  closed_at: null,
  start_date: null,
  end_date: null,
  token_contract: '0xToken',
  token_decimals: TOKEN_DECIMALS,
  token_allocation_usd: null,
  buyer_reward_pct: null,
  referral_reward_pct: null,
  platform_fee_pct: 2,
  claim_duration_mins: null,
  pool_remaining_usd: null,
  pool_usd: 1000,
  token_symbol: 'WETH',
  epoch_duration_days: 7,
  epoch_count: 4,
  actions: null,
  min_score: 0,
  sponsorship_fee: null,
  contract_address: null,
  chain: 'base',
  daily_wallet_cap_usd: null,
  daily_pool_cap_usd: null,
  use_score_multiplier: true,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
}

const fakeEpochState = {
  id: 'epoch-1',
  campaign_id: 'camp-test',
  epoch_number: 1,
  epoch_pool_usd: 250,
  epoch_end: '2025-01-08T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// buildMerkleTree — pure function tests (no mocks needed)
// ---------------------------------------------------------------------------

describe('buildMerkleTree', () => {

  it('should throw when given an empty entries array', () => {
    expect(() => buildMerkleTree([], TOKEN_PRICE_USD, TOKEN_DECIMALS))
      .toThrow('[merkleBuilder] Cannot build Merkle tree with 0 entries')
  })

  it('should return a non-empty root for a single-entry tree', () => {
    const entries = [makeEntry('0xaaaa000000000000000000000000000000000001', 10)]
    const result = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    expect(result.root).toBeTruthy()
    expect(result.root).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it('should produce the same root for the same inputs (deterministic)', () => {
    const entries = [
      makeEntry('0xaaaa000000000000000000000000000000000001', 10),
      makeEntry('0xbbbb000000000000000000000000000000000002', 20),
    ]
    const r1 = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)
    const r2 = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    expect(r1.root).toBe(r2.root)
  })

  it('should produce a different root when entries change', () => {
    const entriesA = [makeEntry('0xaaaa000000000000000000000000000000000001', 10)]
    const entriesB = [makeEntry('0xaaaa000000000000000000000000000000000001', 99)]

    const rA = buildMerkleTree(entriesA, TOKEN_PRICE_USD, TOKEN_DECIMALS)
    const rB = buildMerkleTree(entriesB, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    expect(rA.root).not.toBe(rB.root)
  })

  it('should return one leaf per entry', () => {
    const entries = [
      makeEntry('0xaaaa000000000000000000000000000000000001', 10),
      makeEntry('0xbbbb000000000000000000000000000000000002', 20),
      makeEntry('0xcccc000000000000000000000000000000000003', 30),
    ]
    const result = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    expect(result.leaves).toHaveLength(3)
  })

  it('should produce non-empty proofs for each leaf', () => {
    const entries = [
      makeEntry('0xaaaa000000000000000000000000000000000001', 10),
      makeEntry('0xbbbb000000000000000000000000000000000002', 20),
    ]
    const result = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    for (const leaf of result.leaves) {
      expect(Array.isArray(leaf.proof)).toBe(true)
      // Single-entry trees have an empty proof by definition;
      // two-entry trees must have at least one element.
      expect(leaf.proof.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('should correctly compute total_amount_wei as sum of all leaf amounts', () => {
    // $10 / $2 per token = 5 tokens = 5 * 10^18 wei
    // $20 / $2 per token = 10 tokens = 10 * 10^18 wei
    // total = 15 * 10^18 wei
    const entries = [
      makeEntry('0xaaaa000000000000000000000000000000000001', 10),
      makeEntry('0xbbbb000000000000000000000000000000000002', 20),
    ]
    const result = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    const expectedTotal = BigInt(5) * (10n ** 18n) + BigInt(10) * (10n ** 18n)
    expect(BigInt(result.total_amount_wei)).toBe(expectedTotal)
  })

  it('should store token_price_usd in the result', () => {
    const entries = [makeEntry('0xaaaa000000000000000000000000000000000001', 10)]
    const result = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    expect(result.token_price_usd).toBe(TOKEN_PRICE_USD)
  })

  it('should include a tree_dump that can be used to reconstruct the tree', () => {
    const entries = [makeEntry('0xaaaa000000000000000000000000000000000001', 10)]
    const result = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    // tree_dump must be a non-null object with at least a root-level key
    expect(typeof result.tree_dump).toBe('object')
    expect(result.tree_dump).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Address casing normalisation
  // -------------------------------------------------------------------------

  it('should normalise wallet addresses to lowercase in proof map', () => {
    // Supply a checksummed (mixed-case) address — proofs should still be found
    const checksummedAddress = '0xAaAa000000000000000000000000000000000001'
    const entries = [
      makeEntry(checksummedAddress, 10),
      makeEntry('0xbbbb000000000000000000000000000000000002', 5),
    ]
    const result = buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)

    // Every leaf must have a proof (none should be empty due to casing bug)
    const checksumLeaf = result.leaves.find(
      (l) => l.wallet.toLowerCase() === checksummedAddress.toLowerCase()
    )
    expect(checksumLeaf).toBeDefined()
    expect(checksumLeaf!.proof.length).toBeGreaterThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // Token decimal handling
  // -------------------------------------------------------------------------

  it('should produce different amount_wei for different token decimals', () => {
    const entries = [makeEntry('0xaaaa000000000000000000000000000000000001', 10)]

    const r18 = buildMerkleTree(entries, TOKEN_PRICE_USD, 18)
    const r6  = buildMerkleTree(entries, TOKEN_PRICE_USD, 6)

    expect(BigInt(r18.leaves[0].amount_wei)).toBeGreaterThan(BigInt(r6.leaves[0].amount_wei))
  })

})

// ---------------------------------------------------------------------------
// commitDistribution — Supabase-dependent tests
// ---------------------------------------------------------------------------

describe('commitDistribution', () => {

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Builds a minimal MerkleResult for two wallets */
  function buildTestMerkleResult() {
    const entries = [
      makeEntry('0xaaaa000000000000000000000000000000000001', 10),
      makeEntry('0xbbbb000000000000000000000000000000000002', 5),
    ]
    return buildMerkleTree(entries, TOKEN_PRICE_USD, TOKEN_DECIMALS)
  }

  /** A matching EpochProcessorResult for the two wallets above */
  const processorResult = {
    campaign_id: 'camp-test',
    epoch_number: 1,
    epoch_pool_usd: 250,
    total_points: 200,
    entries: [
      makeEntry('0xaaaa000000000000000000000000000000000001', 10),
      makeEntry('0xbbbb000000000000000000000000000000000002', 5),
    ],
    total_payout_usd: 15,
    wallets_excluded_zero_points: 0,
  }

  function makeMockSupabase() {
    return {
      from: vi.fn((table: string) => {
        if (table === 'distributions') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'dist-123' }, error: null }),
          }
        }
        // daily_payouts, participants, epoch_state, campaigns
        return {
          upsert:  vi.fn().mockResolvedValue({ error: null }),
          update:  vi.fn().mockReturnThis(),
          insert:  vi.fn().mockResolvedValue({ error: null }),
          eq:      vi.fn().mockReturnThis(),
          in:      vi.fn().mockReturnThis(),
        }
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  }

  it('should return a BuilderSummary with correct campaign_id and epoch_number', async () => {
    const mock = makeMockSupabase()
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    const merkleResult = buildTestMerkleResult()
    const summary = await commitDistribution(fakeCampaign, fakeEpochState, processorResult, merkleResult)

    expect(summary.campaign_id).toBe('camp-test')
    expect(summary.epoch_number).toBe(1)
  })

  it('should return distribution_id from the inserted distributions row', async () => {
    const mock = makeMockSupabase()
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    const merkleResult = buildTestMerkleResult()
    const summary = await commitDistribution(fakeCampaign, fakeEpochState, processorResult, merkleResult)

    expect(summary.distribution_id).toBe('dist-123')
  })

  it('should return merkle_root matching the tree root', async () => {
    const mock = makeMockSupabase()
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    const merkleResult = buildTestMerkleResult()
    const summary = await commitDistribution(fakeCampaign, fakeEpochState, processorResult, merkleResult)

    expect(summary.merkle_root).toBe(merkleResult.root)
  })

  it('should report wallets_included equal to the number of leaves', async () => {
    const mock = makeMockSupabase()
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    const merkleResult = buildTestMerkleResult()
    const summary = await commitDistribution(fakeCampaign, fakeEpochState, processorResult, merkleResult)

    expect(summary.wallets_included).toBe(merkleResult.leaves.length)
  })

  it('should set next_epoch_created=true and campaign_ended=false for a non-final epoch', async () => {
    // epoch_number=1, epoch_count=4 → not the final epoch
    const mock = makeMockSupabase()
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    const merkleResult = buildTestMerkleResult()
    const summary = await commitDistribution(
      { ...fakeCampaign, epoch_count: 4 },
      { ...fakeEpochState, epoch_number: 1 },
      processorResult,
      merkleResult
    )

    expect(summary.next_epoch_created).toBe(true)
    expect(summary.campaign_ended).toBe(false)
  })

  it('should set campaign_ended=true and next_epoch_created=false for the final epoch', async () => {
    // epoch_number=4 and epoch_count=4 → isLastEpoch is true
    const mock = makeMockSupabase()
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    const merkleResult = buildTestMerkleResult()
    const summary = await commitDistribution(
      { ...fakeCampaign, epoch_count: 4 },
      { ...fakeEpochState, epoch_number: 4 },
      processorResult,
      merkleResult
    )

    expect(summary.campaign_ended).toBe(true)
    expect(summary.next_epoch_created).toBe(false)
  })

  it('should throw when the distributions insert fails', async () => {
    const mock = {
      from: vi.fn((table: string) => {
        if (table === 'distributions') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'duplicate key value' },
            }),
          }
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          eq:     vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
        }
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    const merkleResult = buildTestMerkleResult()

    await expect(
      commitDistribution(fakeCampaign, fakeEpochState, processorResult, merkleResult)
    ).rejects.toThrow('[merkleBuilder] distributions insert failed')
  })

  // -------------------------------------------------------------------------
  // entryMap guard — wallet in Merkle tree but missing from entries (L7 fix)
  // -------------------------------------------------------------------------
  it('should throw a descriptive error when a Merkle leaf wallet is not in processorResult entries', async () => {
    const mock = {
      from: vi.fn((table: string) => {
        if (table === 'distributions') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'dist-999' }, error: null }),
          }
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          eq:     vi.fn().mockReturnThis(),
          in:     vi.fn().mockReturnThis(),
        }
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as ReturnType<typeof createSupabaseServiceClient>)

    // Build a Merkle tree with two wallets...
    const merkleResult = buildTestMerkleResult()

    // ...but give processorResult entries for ONLY ONE wallet.
    // The second wallet appears in the tree but is missing from entries → should throw.
    const mismatchedProcessor = {
      ...processorResult,
      entries: [makeEntry('0xaaaa000000000000000000000000000000000001', 10)],
    }

    await expect(
      commitDistribution(fakeCampaign, fakeEpochState, mismatchedProcessor, merkleResult)
    ).rejects.toThrow('possible address casing mismatch')
  })

})
