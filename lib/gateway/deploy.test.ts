import { describe, it, expect } from 'vitest'
import { deployWindowKey } from './deploy'

// L-02: the (position_manager, chain, window_key) claim is what makes a retried/concurrent deploy cron
// no-op instead of compound-deploying. window_key must be STABLE within a window and roll over across it,
// so two runs in the same window collide on the UNIQUE index (only the first proceeds).
describe('deployWindowKey (L-02 idempotency window)', () => {
  const WIN = 3600 // 1h

  const winStart = WIN * 1000 * 488_055 // a window-boundary-aligned ms timestamp

  it('is stable for two runs inside the same window', () => {
    const k = deployWindowKey(winStart, WIN)
    expect(deployWindowKey(winStart + 1_000, WIN)).toBe(k) // 1s later, same window
    expect(deployWindowKey(winStart + (WIN * 1000 - 1), WIN)).toBe(k) // just before rollover
  })

  it('rolls over to a new key in the next window', () => {
    const k = deployWindowKey(winStart, WIN)
    expect(deployWindowKey(winStart + WIN * 1000, WIN)).toBe(k + 1)
  })

  it('is an integer window index (floor of unix-secs / windowSecs)', () => {
    expect(deployWindowKey(WIN * 1000 * 5 + 123, WIN)).toBe(5)
    expect(Number.isInteger(deployWindowKey(Date.now(), WIN))).toBe(true)
  })
})
