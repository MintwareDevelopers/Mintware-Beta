import { describe, it, expect } from 'vitest'
import { buildVaultCreateMessage, type VaultTrancheIntent } from './signedActionMessages'

// The route strict-compares its rebuilt message against the client's signed message, so the frontend
// build and the route rebuild MUST be byte-identical — otherwise every treasury-vault create fails auth.
const base = {
  teamWallet: '0xabc0000000000000000000000000000000000001',
  issuedAt: 1_700_000_000_000,
  name: 'TKN/USDC Vault',
  projectToken: '0xdef0000000000000000000000000000000000002',
  seedAmount: 100_000,
  chainId: 84532,
  poolKey: {
    currency0: '0xdef0000000000000000000000000000000000002',
    currency1: '0x0000000000000000000000000000000000000000',
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
  },
}

describe('buildVaultCreateMessage', () => {
  it('omits the tranche block for the legacy pair vault (back-compat, deterministic)', () => {
    const msg = buildVaultCreateMessage(base)
    expect(JSON.parse(msg).tranche).toBeUndefined()
    expect(buildVaultCreateMessage(base)).toBe(msg) // deterministic
  })

  it('includes exactly the four tranche fields for treasury vaults', () => {
    const tranche: VaultTrancheIntent = {
      juniorCommitUsdc: 100_000,
      lockDays: 90,
      teamUsdc: 25_000,
      subordinateUsdc: true,
    }
    const parsed = JSON.parse(buildVaultCreateMessage({ ...base, tranche }))
    expect(parsed.tranche).toEqual(tranche)
  })

  it('frontend build == route rebuild even if the client sends extra tranche junk (strict-compare safe)', () => {
    const tranche: VaultTrancheIntent = { juniorCommitUsdc: 50_000, lockDays: 180, teamUsdc: 0, subordinateUsdc: false }
    const frontend = buildVaultCreateMessage({ ...base, tranche })
    // The route rebuilds from body.tranche, which could carry extra client-supplied fields.
    const withJunk = { ...tranche, evil: 'x', extra: 42 } as VaultTrancheIntent
    const routeSide = buildVaultCreateMessage({ ...base, tranche: withJunk })
    expect(routeSide).toBe(frontend) // only the four canonical fields are serialized
  })
})
