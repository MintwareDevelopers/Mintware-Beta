// Audit reproduction: asserts the observed bootstrap PM-selector regression, not a passing exit flow.
import { it, expect } from 'vitest'
import { resolveInstanceStrict } from '../lib/gateway/routeInstance'
import { fakeSupabase } from '../lib/gateway/__audit__/fakeSupabase'
it('reproduces bootstrap resolution failure when its correct PM is explicitly supplied', async () => {
  const pm = '0x00000000000000000000000000000000000000aa' as const
  const pool = '0x' + 'ee'.repeat(32)
  const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: pm, staging: null, poolAddress: pool }
  const { client } = fakeSupabase()
  expect((await resolveInstanceStrict(client, cfg, pool, { includeInactive: true })).ok).toBe(true)
  expect(await resolveInstanceStrict(client, cfg, pool, { includeInactive: true, positionManager: pm })).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
})
