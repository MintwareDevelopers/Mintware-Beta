import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

describe('POST /api/gateway/deposit — signed MarketEngine receipt record', () => {
  it('requires signed-message auth before route processing', async () => {
    const res = await POST(new NextRequest('https://mw.test/api/gateway/deposit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: '0x' + '11'.repeat(32), pool: '0x' + '22'.repeat(32) }) }))
    expect(res.status).toBe(401)
  })
})
