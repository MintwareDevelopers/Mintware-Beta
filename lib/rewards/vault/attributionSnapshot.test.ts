// =============================================================================
// attributionSnapshot.test.ts — the shared attribution-snapshot core used by the
// standalone /api/vault/attribution-snapshot route AND the inline
// vault-weighted-epoch-close cron. Pure banding + the fresh percentile read.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import {
  attributionMultiplierBps,
  durationMultiplierBps,
  combinedMultiplierBps,
  getAttributionPercentile,
  COMBINED_MULTIPLIER_CAP_BPS,
} from '@/lib/rewards/vault/attributionSnapshot'

const DAY = 86_400_000

describe('attributionMultiplierBps — percentile bands', () => {
  it('0–33% → 1.0×', () => {
    expect(attributionMultiplierBps(0)).toBe(10000)
    expect(attributionMultiplierBps(33)).toBe(10000)
  })
  it('34–66% → 1.25×', () => {
    expect(attributionMultiplierBps(34)).toBe(12500)
    expect(attributionMultiplierBps(66)).toBe(12500)
  })
  it('67–100% → 1.5×', () => {
    expect(attributionMultiplierBps(67)).toBe(15000)
    expect(attributionMultiplierBps(100)).toBe(15000)
  })
})

describe('durationMultiplierBps — day bands', () => {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()
  it('<30d → 1.0×', () => {
    expect(durationMultiplierBps(iso(0))).toBe(10000)
    expect(durationMultiplierBps(iso(29))).toBe(10000)
  })
  it('30–89d → 1.1×', () => {
    expect(durationMultiplierBps(iso(30))).toBe(11000)
    expect(durationMultiplierBps(iso(89))).toBe(11000)
  })
  it('90–179d → 1.2×', () => {
    expect(durationMultiplierBps(iso(90))).toBe(12000)
    expect(durationMultiplierBps(iso(179))).toBe(12000)
  })
  it('≥180d → 1.3×', () => {
    expect(durationMultiplierBps(iso(180))).toBe(13000)
    expect(durationMultiplierBps(iso(400))).toBe(13000)
  })
})

describe('combinedMultiplierBps', () => {
  it('multiplies the two bps factors down to a single bps figure', () => {
    expect(combinedMultiplierBps(10000, 10000)).toBe(10000) // 1.0 × 1.0
    expect(combinedMultiplierBps(15000, 13000)).toBe(19500) // 1.5 × 1.3 = 1.95
    expect(combinedMultiplierBps(12500, 11000)).toBe(13750) // 1.25 × 1.1
  })
  it('caps at COMBINED_MULTIPLIER_CAP_BPS (1.95×)', () => {
    expect(COMBINED_MULTIPLIER_CAP_BPS).toBe(19500)
    // A hypothetical over-cap product is clamped.
    expect(combinedMultiplierBps(20000, 20000)).toBe(COMBINED_MULTIPLIER_CAP_BPS)
  })
})

// getAttributionPercentile is a thin, non-swallowing wrapper over the canonical
// score. Mock the score module to prove: it returns the percentile, falls back
// to 0 when there's no percentile, and PROPAGATES source errors (so the closer's
// C9 fail-closed guard can still fire).
vi.mock('@/lib/attribution/serverScore', () => ({
  getServerLegacyScore: vi.fn(),
}))
import { getServerLegacyScore } from '@/lib/attribution/serverScore'
const mockScore = vi.mocked(getServerLegacyScore)

describe('getAttributionPercentile', () => {
  it('returns the wallet percentile', async () => {
    mockScore.mockResolvedValueOnce({ percentile: 72 } as never)
    await expect(getAttributionPercentile('0xABC')).resolves.toBe(72)
  })
  it('falls back to 0 when the score has no percentile', async () => {
    mockScore.mockResolvedValueOnce({} as never)
    await expect(getAttributionPercentile('0xABC')).resolves.toBe(0)
  })
  it('propagates a score-source error (does NOT swallow to 0)', async () => {
    mockScore.mockRejectedValueOnce(new Error('source down'))
    await expect(getAttributionPercentile('0xABC')).rejects.toThrow('source down')
  })
  it('lowercases the wallet before scoring', async () => {
    mockScore.mockResolvedValueOnce({ percentile: 5 } as never)
    await getAttributionPercentile('0xAbCdEf')
    expect(mockScore).toHaveBeenLastCalledWith('0xabcdef', {})
  })
})
