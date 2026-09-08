// RED-TEAM PoC (off-chain, 2026-09-08) — signer-resolution semantics. Uses only obviously-fake key
// material (0x11…11 / 0x22…22); no real secret is read or printed.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getOracleSignerKey } from '@/lib/web3/oracleKeys'

const FAKE_EXPOSED = '0x' + '11'.repeat(32) // stands in for the git-exposed ORACLE_PRIVATE_KEY
const FAKE_DIST = '0x' + '22'.repeat(32)

afterEach(() => vi.unstubAllEnvs())

describe('oracleKeys fallback chains (env-key mode)', () => {
  it('gateway role FAILS CLOSED with no shared-key fallback (MITIGATED — A-3 key hardening holds)', () => {
    vi.stubEnv('ORACLE_PRIVATE_KEY', FAKE_EXPOSED)
    vi.stubEnv('ROOT_ORACLE_PRIVATE_KEY', FAKE_DIST)
    vi.stubEnv('DISTRIBUTOR_PRIVATE_KEY', FAKE_DIST)
    vi.stubEnv('GATEWAY_ORACLE_PRIVATE_KEY', '')
    expect(() => getOracleSignerKey('gateway')).toThrow(/GATEWAY_ORACLE_PRIVATE_KEY/)
  })

  it('range + agent roles STILL fall back to ORACLE_PRIVATE_KEY (the key the audit says was git-exposed) whenever ORACLE_SIGNER_PROVIDER != privy', () => {
    vi.stubEnv('ORACLE_PRIVATE_KEY', FAKE_EXPOSED)
    vi.stubEnv('RANGE_ORACLE_PRIVATE_KEY', '')
    vi.stubEnv('AGENT_ORACLE_PRIVATE_KEY', '')
    expect(getOracleSignerKey('range')).toBe(FAKE_EXPOSED)
    expect(getOracleSignerKey('agent')).toBe(FAKE_EXPOSED)
  })

  it('a bare hex (no 0x) is silently 0x-prefixed — a pasted wrong-format value becomes a valid-looking key rather than an error', () => {
    vi.stubEnv('GATEWAY_ORACLE_PRIVATE_KEY', '33'.repeat(32))
    expect(getOracleSignerKey('gateway')).toBe('0x' + '33'.repeat(32))
  })
})

describe('ORACLE_SIGNER_PROVIDER is a single GLOBAL switch', () => {
  it('FIXED (round-3 F-6): a typo ("privy-server") no longer downgrades to env-key — every role refuses to sign', async () => {
    vi.stubEnv('ORACLE_SIGNER_PROVIDER', 'privy-server')
    vi.stubEnv('GATEWAY_ORACLE_PRIVATE_KEY', FAKE_DIST)
    const { getOracleSigner } = await import('@/lib/web3/oracleSigner')
    // used to resolve from the RAW env key while the operator believed prod was Privy-enclaved
    await expect(getOracleSigner('gateway')).rejects.toThrow(/ORACLE_SIGNER_PROVIDER must be "privy" or "env-key"/)
  })
})
