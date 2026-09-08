import { describe, it, expect } from 'vitest'
import { deployWindowKey, computeDeployMinLiquidity, DEFAULT_DEPLOY_TOL_BPS } from './deploy'
import { getSqrtPriceAtTick, getLiquidityForAmounts, applyToleranceBps } from './v4Math'

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

// O-9 / HO-8: the M-03 sandwich floor is computed per pool from spot — the exact L the contract mints
// for the two amounts, haircut by the tolerance — never one global absolute-L env value.
describe('computeDeployMinLiquidity (O-9 spot-computed floor)', () => {
  const tickLower = -23040
  const tickUpper = 23040
  const A = getSqrtPriceAtTick(tickLower)
  const B = getSqrtPriceAtTick(tickUpper)
  const spot = getSqrtPriceAtTick(0)
  const base = { sqrtPriceX96: spot, tickLower, tickUpper, quoteIsCurrency0: true, quoteToDeploy: 1_000_000_000n, pairedOut: 10n ** 18n }

  it('in range: floor = getLiquidityForAmounts(spot, A, B, amounts) × (1 − tol), default 1%', () => {
    const r = computeDeployMinLiquidity(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const L = getLiquidityForAmounts(spot, A, B, base.quoteToDeploy, base.pairedOut)
    expect(r.expectedLiquidity).toBe(L)
    expect(r.minLiquidity).toBe(applyToleranceBps(L, DEFAULT_DEPLOY_TOL_BPS))
    expect(r.minLiquidity < L).toBe(true)
    expect(r.envFloorApplied).toBe(false)
  })

  it('honours a custom tolerance', () => {
    const r = computeDeployMinLiquidity({ ...base, tolBps: 500 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.minLiquidity).toBe(applyToleranceBps(r.expectedLiquidity, 500))
  })

  it('maps the quote leg to currency0 or currency1 correctly', () => {
    // An ASYMMETRIC range (spot is not the midpoint) so which amount is amount0 changes the min(L0, L1).
    const asym = { ...base, tickLower: -23040, tickUpper: 6000, quoteToDeploy: 10n ** 18n, pairedOut: 10n ** 18n }
    const a = getSqrtPriceAtTick(asym.tickLower)
    const b = getSqrtPriceAtTick(asym.tickUpper)
    const q0 = computeDeployMinLiquidity(asym)
    const q1 = computeDeployMinLiquidity({ ...asym, quoteIsCurrency0: false })
    if (!q0.ok || !q1.ok) throw new Error('expected ok')
    expect(q0.expectedLiquidity).toBe(getLiquidityForAmounts(spot, a, b, asym.quoteToDeploy, asym.pairedOut))
    expect(q1.expectedLiquidity).toBe(getLiquidityForAmounts(spot, a, b, asym.pairedOut, asym.quoteToDeploy))
    // with equal amounts the two orderings give the SAME L (sanity) — so use unequal amounts to see the mapping bite:
    const u0 = computeDeployMinLiquidity({ ...asym, pairedOut: 10n ** 17n })
    const u1 = computeDeployMinLiquidity({ ...asym, pairedOut: 10n ** 17n, quoteIsCurrency0: false })
    if (!u0.ok || !u1.ok) throw new Error('expected ok')
    expect(u0.expectedLiquidity).not.toBe(u1.expectedLiquidity)
  })

  it('the env value is only ever an ADDITIONAL floor: max(computed, env)', () => {
    const r = computeDeployMinLiquidity(base)
    if (!r.ok) throw new Error('expected ok')
    const lower = computeDeployMinLiquidity({ ...base, envFloor: r.minLiquidity / 2n })
    const higher = computeDeployMinLiquidity({ ...base, envFloor: r.minLiquidity * 3n })
    if (!lower.ok || !higher.ok) throw new Error('expected ok')
    expect(lower.minLiquidity).toBe(r.minLiquidity) // env below computed ⇒ ignored
    expect(lower.envFloorApplied).toBe(false)
    expect(higher.minLiquidity).toBe(r.minLiquidity * 3n) // env above ⇒ raises the bar
    expect(higher.envFloorApplied).toBe(true)
  })

  it('out of range (spot at/below the lower tick or at/above the upper) ⇒ refuse out_of_range', () => {
    expect(computeDeployMinLiquidity({ ...base, sqrtPriceX96: getSqrtPriceAtTick(-30000) })).toEqual({ ok: false, reason: 'out_of_range' })
    expect(computeDeployMinLiquidity({ ...base, sqrtPriceX96: getSqrtPriceAtTick(30000) })).toEqual({ ok: false, reason: 'out_of_range' })
    expect(computeDeployMinLiquidity({ ...base, sqrtPriceX96: A })).toEqual({ ok: false, reason: 'out_of_range' })
    expect(computeDeployMinLiquidity({ ...base, sqrtPriceX96: B })).toEqual({ ok: false, reason: 'out_of_range' })
  })

  it('a computed floor of 0 ⇒ refuse (fail-closed, never switches M-03 off) — even with an env floor set', () => {
    expect(computeDeployMinLiquidity({ ...base, quoteToDeploy: 0n, pairedOut: 0n })).toEqual({ ok: false, reason: 'min_liquidity_unset' })
    expect(computeDeployMinLiquidity({ ...base, quoteToDeploy: 0n, pairedOut: 0n, envFloor: 10n ** 12n })).toEqual({ ok: false, reason: 'min_liquidity_unset' })
    // one empty leg in range ⇒ min(L0, L1) = 0 ⇒ refuse
    expect(computeDeployMinLiquidity({ ...base, pairedOut: 0n })).toEqual({ ok: false, reason: 'min_liquidity_unset' })
  })

  it('different pools get different floors (the whole point — one global L cannot fit both)', () => {
    const wide = computeDeployMinLiquidity(base)
    const narrow = computeDeployMinLiquidity({ ...base, tickLower: -600, tickUpper: 600 })
    if (!wide.ok || !narrow.ok) throw new Error('expected ok')
    expect(narrow.minLiquidity > wide.minLiquidity).toBe(true) // same amounts, tighter range ⇒ more L
  })
})
