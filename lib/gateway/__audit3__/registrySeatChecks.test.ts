// Round-3 F-5 regression — the registry's code-hash trust root is per-BUILD, not per-instance. A lookalike PM
// deployed from the audited bytecode with attacker constructor args has an identical code hash. The `seat` checks
// pin the instance to OUR seat: pm.owner(), pm.harvestRecipient(), and staging → adapter → vault binding.
import { describe, it, expect } from 'vitest'
import { keccak256, zeroAddress } from 'viem'
import { verifyInstanceOnChain, computePoolId, registryTrustConfigFromEnv, type ReadClient, type RegistryTrustConfig } from '@/lib/gateway/registry'

const USDG = ('0x' + '11'.repeat(20)) as `0x${string}`
const PAIRED = ('0x' + '22'.repeat(20)) as `0x${string}`
const SEAT = ('0x' + 'aa'.repeat(20)) as `0x${string}`
const ATTACKER = ('0x' + 'bb'.repeat(20)) as `0x${string}`
const COLD = ('0x' + 'cc'.repeat(20)) as `0x${string}`
const PM = '0x' + '01'.repeat(20)
const STG = '0x' + '02'.repeat(20)
const ADAPTER = '0x' + '03'.repeat(20)
const KEY = { currency0: USDG, currency1: PAIRED, fee: 3000, tickSpacing: 60, hooks: zeroAddress }
const POOL_ID = computePoolId(KEY)
const CODE = ('0x6080' + 'ab'.repeat(64)) as `0x${string}`
const HASH = keccak256(CODE).toLowerCase()

type World = { owner: string; recipient: string; adapter: string; vault: string }
function client(w: World): ReadClient {
  return {
    async readContract(a: { address: string; functionName: string }) {
      const addr = a.address.toLowerCase()
      if (addr === PM) {
        if (a.functionName === 'quoteAsset') return USDG
        if (a.functionName === 'poolKey') return KEY
        if (a.functionName === 'staging') return STG
        if (a.functionName === 'owner') return w.owner
        if (a.functionName === 'harvestRecipient') return w.recipient
      }
      if (addr === STG) {
        if (a.functionName === 'controller') return PM
        if (a.functionName === 'quoteAsset') return USDG
        if (a.functionName === 'adapter') return w.adapter
      }
      if (addr === ADAPTER && a.functionName === 'vault') return w.vault
      throw new Error(`no such read ${addr}.${a.functionName}`)
    },
    async getCode() { return CODE },
  }
}
const seatTrust = (expectedOwner: `0x${string}` | null, extra: string[] = []): RegistryTrustConfig => ({
  factory: null, pmCodeHashes: [HASH], expectedQuoteAsset: USDG,
  seat: { expectedOwner, allowedHarvestRecipients: expectedOwner ? [expectedOwner, ...extra] : extra },
})
const verify = (w: World, trust: RegistryTrustConfig) =>
  verifyInstanceOnChain({ client: client(w), positionManager: PM as `0x${string}`, staging: STG as `0x${string}`, expectedPoolAddress: POOL_ID, trust })

const legit: World = { owner: SEAT, recipient: SEAT, adapter: ADAPTER, vault: STG }

describe('registry seat checks (round-3 F-5)', () => {
  it('legit rig: our seat owns it, fees go to our seat, adapter bound to this staging → ok', async () => {
    expect(await verify(legit, seatTrust(SEAT))).toMatchObject({ ok: true, verification: 'codehash' })
  })
  it('FIXED: audited bytecode but ATTACKER owner → owner_mismatch (the hash alone used to be enough)', async () => {
    expect(await verify({ ...legit, owner: ATTACKER }, seatTrust(SEAT))).toEqual({ ok: false, error: 'owner_mismatch' })
  })
  it('FIXED: fees routed to an address outside the allowlist → recipient_not_allowlisted', async () => {
    expect(await verify({ ...legit, recipient: ATTACKER }, seatTrust(SEAT))).toEqual({ ok: false, error: 'recipient_not_allowlisted' })
  })
  it('a cold recipient is fine when allowlisted via LP_GATEWAY_HARVEST_RECIPIENTS', async () => {
    expect(await verify({ ...legit, recipient: COLD }, seatTrust(SEAT, [COLD]))).toMatchObject({ ok: true })
  })
  it('FIXED: staging with no adapter bound → adapter_unbound', async () => {
    expect(await verify({ ...legit, adapter: zeroAddress }, seatTrust(SEAT))).toEqual({ ok: false, error: 'adapter_unbound' })
  })
  it('FIXED: adapter whose vault is NOT this staging (shared/foreign adapter) → adapter_vault_mismatch', async () => {
    expect(await verify({ ...legit, vault: '0x' + '04'.repeat(20) }, seatTrust(SEAT))).toEqual({ ok: false, error: 'adapter_vault_mismatch' })
  })
  it('FAILS CLOSED when the owner env is unset (seat configured from env, no owner) → owner_env_unset', async () => {
    expect(await verify(legit, seatTrust(null))).toEqual({ ok: false, error: 'owner_env_unset' })
  })
  it('a seat read that reverts → seat_read_failed (never silently passes)', async () => {
    const c = client(legit)
    const broken: ReadClient = {
      ...c,
      async readContract(a: { address: string; functionName: string }) {
        if (a.functionName === 'owner') throw new Error('revert')
        return c.readContract(a as never)
      },
    }
    const r = await verifyInstanceOnChain({ client: broken, positionManager: PM as `0x${string}`, staging: STG as `0x${string}`, expectedPoolAddress: POOL_ID, trust: seatTrust(SEAT) })
    expect(r).toEqual({ ok: false, error: 'seat_read_failed' })
  })
  it('registryTrustConfigFromEnv always populates seat: owner from LP_GATEWAY_OWNER ?? GATEWAY_ORACLE_PRIVY_ADDRESS, recipients ∪ owner', () => {
    const c = registryTrustConfigFromEnv({ LP_GATEWAY_USDG: USDG, LP_GATEWAY_PM_CODEHASHES: HASH, GATEWAY_ORACLE_PRIVY_ADDRESS: SEAT.toUpperCase().replace('0X', '0x'), LP_GATEWAY_HARVEST_RECIPIENTS: `${COLD}, not-an-address` })
    expect(c.seat?.expectedOwner).toBe(SEAT)
    expect(c.seat?.allowedHarvestRecipients).toEqual([COLD, SEAT])
    const none = registryTrustConfigFromEnv({ LP_GATEWAY_USDG: USDG })
    expect(none.seat).toEqual({ expectedOwner: null, allowedHarvestRecipients: [] })
  })
  it('legacy hand-built configs without `seat` skip the identity checks (test affordance) — the env builder never omits it', async () => {
    const legacy: RegistryTrustConfig = { factory: null, pmCodeHashes: [HASH], expectedQuoteAsset: USDG }
    expect(await verify({ ...legit, owner: ATTACKER }, legacy)).toMatchObject({ ok: true })
  })
})
