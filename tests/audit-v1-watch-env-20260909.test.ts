// Audit evidence: originally reproduced a bootstrap PM-selector regression Codex's live fix-watch
// caught (2026-09-09, ~22:52 UTC) — the `positionManager`-exact-match branch in `resolveInstanceStrict`
// ran unconditionally, BEFORE the `all.length > 0` gate guarding the registry-search path, so a
// genuinely empty registry (bootstrap; the env-fallback rig is the only candidate) always found
// nothing to match and 404'd before ever reaching the env-fallback logic. Withdraw derives its
// `positionManager` from the tx receipt unconditionally (see app/api/gateway/withdraw/route.ts), so
// this broke EVERY withdrawal during bootstrap.
//
// FIXED 2026-09-09 (same day, lib/gateway/routeInstance.ts): the exact-match branch is now scoped to
// `all.length > 0`; a genuinely empty registry falls through to the env-fallback tail, which now
// separately validates a supplied `positionManager` against the env rig's own address (fail-closed on
// a mismatch, rather than silently ignoring it). Flipped to prove the fix, per this project's
// established PoC-flip convention.
import { it, expect } from 'vitest'
import { resolveInstanceStrict } from '../lib/gateway/routeInstance'
import { fakeSupabase } from '../lib/gateway/__audit__/fakeSupabase'

it('FIXED: bootstrap + a PM selector matching the env rig itself now resolves (was a false 404)', async () => {
  const pm = '0x00000000000000000000000000000000000000aa' as const
  const pool = '0x' + 'ee'.repeat(32)
  const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: pm, staging: null, poolAddress: pool }
  const { client } = fakeSupabase()
  expect((await resolveInstanceStrict(client, cfg, pool, { includeInactive: true })).ok).toBe(true)
  // The regression: this used to 404 even though `pm` IS the env rig's own PM.
  const r = await resolveInstanceStrict(client, cfg, pool, { includeInactive: true, positionManager: pm })
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.inst.positionManager.toLowerCase()).toBe(pm)
})

it('bootstrap + a PM selector that does NOT match the env rig fails closed (never silently ignored)', async () => {
  const pm = '0x00000000000000000000000000000000000000aa' as const
  const wrongPm = '0x00000000000000000000000000000000000000bb'
  const pool = '0x' + 'ee'.repeat(32)
  const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: pm, staging: null, poolAddress: pool }
  const { client } = fakeSupabase()
  const r = await resolveInstanceStrict(client, cfg, pool, { includeInactive: true, positionManager: wrongPm })
  expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
})
