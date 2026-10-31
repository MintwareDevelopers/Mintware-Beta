import { expect, it } from 'vitest'
import { MARKET_CHAINS } from './marketChains'
import nextConfig from '../../next.config.mjs'

it('MW-04: enforced CSP permits each browser market RPC by its exact origin', async () => {
  const rules = await nextConfig.headers!()
  const csp = rules.flatMap((r: { headers: { key: string; value: string }[] }) => r.headers)
    .find((h: { key: string }) => h.key === 'Content-Security-Policy')?.value as string
  expect(csp).toBeTruthy()
  const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src '))!.trim().split(/\s+/).slice(1)
  for (const chain of Object.values(MARKET_CHAINS)) expect(connect).toContain(new URL(chain.rpc).origin)
  expect(connect).not.toContain('https://*.publicnode.com')
  expect(connect).not.toContain('*')
})
