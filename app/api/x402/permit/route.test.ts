import { describe, expect, it } from 'vitest'
import { POST, GET } from './route'

describe('retired /api/x402/permit', () => {
  it('fails closed with a retirement response', async () => {
    const post = await POST()
    const get = await GET()
    expect(post.status).toBe(410)
    expect(get.status).toBe(410)
    expect(await post.json()).toMatchObject({ error: 'standing_gateway_permits_retired' })
  })
})
