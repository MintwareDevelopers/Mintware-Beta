// =============================================================================
// weightedEpochOrchestrator.test.ts — end-to-end weighted-epoch build + sign,
// signature recovery, and fail-closed liveness (C9). No Supabase, no live chain.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  buildAndSignWeightedEpoch,
  ScoreSourceUnavailableError,
  type WeightedEpochInput,
} from '@/lib/rewards/vault/weightedEpochOrchestrator'

// Anvil account #0 — deterministic test signer.
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const SIGNER = privateKeyToAccount(PK).address

const DISTRIBUTOR = '0x00000000000000000000000000000000000000dd' as const
const VAULT_ID = ('0x' + 'ab'.repeat(32)) as `0x${string}`
const CHAIN_ID = 8453

const EPOCH_ROOT_TYPES = {
  EpochRoot: [
    { name: 'vaultId',      type: 'bytes32' },
    { name: 'epochNumber',  type: 'uint256' },
    { name: 'merkleRoot',   type: 'bytes32' },
    { name: 'totalAmount0', type: 'uint256' },
    { name: 'totalAmount1', type: 'uint256' },
    { name: 'deadline',     type: 'uint256' },
  ],
} as const

function baseInput(overrides: Partial<WeightedEpochInput> = {}): WeightedEpochInput {
  return {
    vaultId: VAULT_ID,
    epochNumber: 3,
    distributorAddress: DISTRIBUTOR,
    chainId: CHAIN_ID,
    feesPot: { amount0: 1000, amount1: 500 },
    lps: [
      { wallet: '0x00000000000000000000000000000000000000a1', liquidityUnits: 100, lockTier: 'flex', daysHeld: 0, attrPercentile: 50 },
      { wallet: '0x00000000000000000000000000000000000000b0', liquidityUnits: 300, lockTier: 'core', daysHeld: 200, attrPercentile: 80, referrer: '0x00000000000000000000000000000000000000c2' },
    ],
    token0Decimals: 18,
    token1Decimals: 6,
    deadline: 2_000_000_000,
    scoresAvailable: true,
    ...overrides,
  }
}

beforeAll(() => {
  process.env.WEIGHT_ORACLE_PRIVATE_KEY = PK
})

describe('buildAndSignWeightedEpoch', () => {
  it('signs an EpochRoot that recovers to the oracle signer', async () => {
    const r = await buildAndSignWeightedEpoch(baseInput())
    expect(r.oracleSigner.toLowerCase()).toBe(SIGNER.toLowerCase())

    const recovered = await recoverTypedDataAddress({
      domain: { name: 'MintwareWeightedDistributor', version: '1', chainId: CHAIN_ID, verifyingContract: DISTRIBUTOR },
      types: EPOCH_ROOT_TYPES,
      primaryType: 'EpochRoot',
      message: {
        vaultId: VAULT_ID,
        epochNumber: 3n,
        merkleRoot: r.merkleRoot,
        totalAmount0: BigInt(r.total0Wei),
        totalAmount1: BigInt(r.total1Wei),
        deadline: 2_000_000_000n,
      },
      signature: r.signature,
    })
    expect(recovered.toLowerCase()).toBe(SIGNER.toLowerCase())
  })

  it('closeEpochArgs match the signed totals', async () => {
    const r = await buildAndSignWeightedEpoch(baseInput())
    expect(r.closeEpochArgs.vaultId).toBe(VAULT_ID)
    expect(r.closeEpochArgs.merkleRoot).toBe(r.merkleRoot)
    expect(r.closeEpochArgs.total0).toBe(BigInt(r.total0Wei))
    expect(r.closeEpochArgs.total1).toBe(BigInt(r.total1Wei))
    expect(r.closeEpochArgs.deadline).toBe(2_000_000_000n)
    // referral present → margin required is non-zero on at least one side
    expect(r.marginRequired.amount0).toBeGreaterThan(0)
  })

  it('produces a claimable leaf per non-zero wallet', async () => {
    const r = await buildAndSignWeightedEpoch(baseInput())
    // 2 LPs + 1 referrer (b0 was referred by c2, quality>0) → 3 leaves
    expect(r.leaves.length).toBe(3)
    for (const leaf of r.leaves) {
      expect(BigInt(leaf.amount0Wei) > 0n || BigInt(leaf.amount1Wei) > 0n).toBe(true)
    }
  })

  // ── C9 fail-closed liveness ──
  it('refuses to sign when scores are unavailable', async () => {
    await expect(buildAndSignWeightedEpoch(baseInput({ scoresAvailable: false })))
      .rejects.toBeInstanceOf(ScoreSourceUnavailableError)
  })

  it('refuses to sign when a percentile is missing/NaN', async () => {
    const bad = baseInput()
    bad.lps[0] = { ...bad.lps[0], attrPercentile: Number.NaN }
    await expect(buildAndSignWeightedEpoch(bad)).rejects.toBeInstanceOf(ScoreSourceUnavailableError)
  })

  it('refuses to sign when a percentile is out of range', async () => {
    const bad = baseInput()
    bad.lps[1] = { ...bad.lps[1], attrPercentile: 150 }
    await expect(buildAndSignWeightedEpoch(bad)).rejects.toBeInstanceOf(ScoreSourceUnavailableError)
  })
})
