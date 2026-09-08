// ROUND-3 EXPLOIT REPLAY — signer-seat resolution (lib/web3/oracleSigner.ts + oracleKeys.ts).
// Incident class: "the env var was misspelled in prod so the secure path was silently skipped"
// (Codecov 2021 / countless `NODE_ENV=prod` typos). Question: with ORACLE_SIGNER_PROVIDER mistyped,
// which roles still sign, from which key, and is there a boot-time assertion? (No real secrets used —
// throwaway hardhat keys are stubbed into the env for the duration of the test.)
import { describe, it, expect, vi, afterEach } from 'vitest'

const HARDHAT0 = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // public, worthless
const HARDHAT0_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

// FIXED (round-3 F-6): a typo used to fall through to env-key mode silently — `gateway` failed closed (no raw key) but
// `range`/`agent` signed with the shared, git-exposed ORACLE_PRIVATE_KEY. Now only "privy" / "env-key" (trimmed,
// case-insensitive) are accepted; anything else throws for EVERY role at first use. PoC kept with flipped expectations.
describe('ORACLE_SIGNER_PROVIDER typo ⇒ FIXED: every role refuses to sign (no silent env-key downgrade)', () => {
  for (const typo of ['privvy', 'PRIVY_', 'prviy', 'true']) {
    it(`"${typo}" → every role rejects with the provider error; nothing signs with the shared ORACLE_PRIVATE_KEY`, async () => {
      vi.stubEnv('ORACLE_SIGNER_PROVIDER', typo)
      vi.stubEnv('PRIVY_APP_ID', 'app'); vi.stubEnv('PRIVY_APP_SECRET', 'not-a-real-secret')
      vi.stubEnv('GATEWAY_ORACLE_PRIVY_WALLET_ID', 'w'); vi.stubEnv('GATEWAY_ORACLE_PRIVY_ADDRESS', '0x' + '18'.repeat(20))
      vi.stubEnv('GATEWAY_ORACLE_PRIVATE_KEY', '')
      vi.stubEnv('ORACLE_PRIVATE_KEY', HARDHAT0) // the git-exposed shared key class (bare hex, no 0x)
      vi.stubEnv('RANGE_ORACLE_PRIVATE_KEY', ''); vi.stubEnv('AGENT_ORACLE_PRIVATE_KEY', '')
      const { getOracleSigner } = await import('@/lib/web3/oracleSigner')
      const provider = /ORACLE_SIGNER_PROVIDER must be "privy" or "env-key"/
      await expect(getOracleSigner('gateway')).rejects.toThrow(provider)
      await expect(getOracleSigner('range')).rejects.toThrow(provider)
      await expect(getOracleSigner('agent')).rejects.toThrow(provider)
      await expect(getOracleSigner('root')).rejects.toThrow(provider)
    })
  }
  for (const ok of ['Privy ', 'privy\n', 'PRIVY']) {
    it(`"${JSON.stringify(ok)}" — whitespace/case around a valid value is normalised to privy mode (not a downgrade)`, async () => {
      vi.stubEnv('ORACLE_SIGNER_PROVIDER', ok)
      vi.stubEnv('PRIVY_APP_ID', ''); vi.stubEnv('PRIVY_APP_SECRET', '')
      vi.stubEnv('ORACLE_PRIVATE_KEY', HARDHAT0); vi.stubEnv('RANGE_ORACLE_PRIVATE_KEY', '')
      const { getOracleSigner } = await import('@/lib/web3/oracleSigner')
      // privy mode with no app credentials fails on the PRIVY requirement — proving it did NOT fall to env-key
      await expect(getOracleSigner('range')).rejects.toThrow(/ORACLE_SIGNER_PROVIDER=privy requires PRIVY_APP_ID/)
    })
  }

  it('bare-hex keys are silently 0x-prefixed (a copy-paste without 0x "works" — and so does a truncated 63-char one? no: viem rejects wrong length)', async () => {
    vi.stubEnv('ORACLE_SIGNER_PROVIDER', 'env-key')
    vi.stubEnv('ROOT_ORACLE_PRIVATE_KEY', HARDHAT0)
    const { getOracleSigner } = await import('@/lib/web3/oracleSigner')
    expect((await getOracleSigner('root')).address.toLowerCase()).toBe(HARDHAT0_ADDR)
    vi.stubEnv('ROOT_ORACLE_PRIVATE_KEY', HARDHAT0.slice(1))
    vi.resetModules()
    const m = await import('@/lib/web3/oracleSigner')
    await expect(m.getOracleSigner('root')).rejects.toThrow()
  })

  it('import stays side-effect free (no boot-time throw — Next would crash every route); the assertion is at FIRST USE', async () => {
    vi.stubEnv('ORACLE_SIGNER_PROVIDER', 'privvy')
    const m = await import('@/lib/web3/oracleSigner')
    expect(m).toBeTruthy()
    await expect(m.getOracleSigner('root')).rejects.toThrow(/refusing to pick a signer/)
  })

  it('Privy mode without <ROLE>_ORACLE_PRIVY_AUTH_KEY constructs a client with the app secret only (code path exists; Privy-side owner policy is what refuses it)', async () => {
    vi.stubEnv('ORACLE_SIGNER_PROVIDER', 'privy')
    vi.stubEnv('PRIVY_APP_ID', 'app'); vi.stubEnv('PRIVY_APP_SECRET', 'not-a-real-secret')
    vi.stubEnv('GATEWAY_ORACLE_PRIVY_WALLET_ID', 'w'); vi.stubEnv('GATEWAY_ORACLE_PRIVY_ADDRESS', '0x' + '18'.repeat(20))
    vi.stubEnv('GATEWAY_ORACLE_PRIVY_AUTH_KEY', '')
    const ctorArgs: unknown[][] = []
    vi.doMock('@privy-io/server-auth', () => ({ PrivyClient: class { constructor(...a: unknown[]) { ctorArgs.push(a) } } }))
    vi.doMock('@privy-io/server-auth/viem', () => ({ createViemAccount: (o: { address: string }) => ({ address: o.address, source: 'privy' }) }))
    const { getOracleSigner } = await import('@/lib/web3/oracleSigner')
    await getOracleSigner('gateway')
    expect(ctorArgs[0].length).toBe(2) // (appId, appSecret) — no walletApi.authorizationPrivateKey
    vi.doUnmock('@privy-io/server-auth'); vi.doUnmock('@privy-io/server-auth/viem')
  })
})
