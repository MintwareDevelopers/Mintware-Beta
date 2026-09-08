#!/usr/bin/env node
/**
 * Round-3 adversarial PoC for the IDLE-MODE operator-error class in
 *   scripts/preflight-lp-gateway-mainnet.mjs   (resolveConfig — the validating reader)
 *   scripts/deploy-lp-gateway-mainnet.mjs      (its OWN, independent reader)
 *
 * Two readers, two different rules, no cross-check. This prints the exact divergence table
 * quoted in docs/developers/audits/round3/idle-adapter-adversarial.md.
 *
 *   node scripts/__audit__/idle-mode-env-poc.mjs
 */
import { resolveConfig } from '../preflight-lp-gateway-mainnet.mjs'

// VERBATIM copies of the deploy script's own two lines (deploy-lp-gateway-mainnet.mjs:144-147).
function deployReader(env) {
  const IDLE_MODE = (env.LP_GATEWAY_IDLE_MODE ?? '').toLowerCase() === 'true'
  if (IDLE_MODE && env.LP_GATEWAY_DEPOSIT_CAP == null) return { die: 'requires LP_GATEWAY_DEPOSIT_CAP' }
  try {
    return { cap: IDLE_MODE ? BigInt(env.LP_GATEWAY_DEPOSIT_CAP) : undefined }
  } catch (e) {
    return { throws: e.constructor.name }
  }
}

// The preflight's row-235 verdict for the same env.
function preflightVerdict(env) {
  let cfg
  try {
    cfg = resolveConfig(env)
  } catch (e) {
    return { throws: e.constructor.name }
  }
  if (!cfg.idleMode) return { row: 'n/a (not idle mode)' }
  const passes = cfg.depositCap != null && cfg.depositCap >= 0n
  return { cap: cfg.depositCap, row: passes ? 'PASS' : 'FAIL' }
}

const base = { LP_GATEWAY_IDLE_MODE: 'true' }
const cases = [
  ['unset', {}],
  ["'0'  (deliberately closed)", { LP_GATEWAY_DEPOSIT_CAP: '0' }],
  ["''   (set-but-empty / unresolved $VAR)", { LP_GATEWAY_DEPOSIT_CAP: '' }],
  ["'  ' (whitespace only)", { LP_GATEWAY_DEPOSIT_CAP: '  ' }],
  ["'10000000000' (10,000 USDG)", { LP_GATEWAY_DEPOSIT_CAP: '10000000000' }],
  ["'10000e6' (human shorthand)", { LP_GATEWAY_DEPOSIT_CAP: '10000e6' }],
  ["'10_000' (JS-style separator)", { LP_GATEWAY_DEPOSIT_CAP: '10_000' }],
  ["'-1'", { LP_GATEWAY_DEPOSIT_CAP: '-1' }],
  ['2^256-1 (fat-finger / no ceiling)', { LP_GATEWAY_DEPOSIT_CAP: (2n ** 256n - 1n).toString() }],
]

const fmt = (r) => (r.throws ? `THROWS ${r.throws}` : r.die ? `die("${r.die}")` : `cap=${r.cap}${r.row ? ` row=${r.row}` : ''}`)

console.log('\nLP_GATEWAY_DEPOSIT_CAP — preflight reader vs deploy reader (LP_GATEWAY_IDLE_MODE=true)\n')
console.log(`  ${'env value'.padEnd(40)} ${'preflight (validating)'.padEnd(34)} deploy (independent)`)
console.log('  ' + '-'.repeat(100))
for (const [label, extra] of cases) {
  const env = { ...base, ...extra }
  const p = fmt(preflightVerdict(env))
  const d = fmt(deployReader(env))
  const flag = p.replace(/ row=\w+/, '').split('cap=')[1] !== d.split('cap=')[1] ? '  <-- DIVERGENT' : ''
  console.log(`  ${label.padEnd(40)} ${p.padEnd(34)} ${d}${flag}`)
}

console.log('\nIdle mode + a REAL yield source configured at the same time:')
const both = resolveConfig({
  LP_GATEWAY_IDLE_MODE: 'true',
  LP_GATEWAY_DEPOSIT_CAP: '10000000000',
  LP_GATEWAY_YIELD_SOURCE: '0x1111111111111111111111111111111111111111',
})
console.log(`  resolveConfig -> idleMode=${both.idleMode}  yieldSource=${both.yieldSource}`)
console.log('  preflight row (line 231) is emitted with info(...), and finish() computes')
console.log("    ok = rows.every(r => r.status !== 'FAIL')")
console.log('  => an INFO row can never block the deploy. The configured real source is SILENTLY IGNORED')
console.log('     (deploy-lp-gateway-mainnet.mjs:141 sets SOURCE = null in idle mode) and a ZERO-YIELD')
console.log('     adapter ships instead, with a deployment record that says "no external yield source".\n')

// ── Target 3(c): does the post-wire assertion actually catch a JS/uint256 type mismatch? ──
// VERBATIM copy of deploy-lp-gateway-mainnet.mjs:253-258.
const assertEq = (label, got, want) => {
  const g = typeof got === 'string' ? got.toLowerCase() : String(got)
  const w = typeof want === 'string' ? want.toLowerCase() : String(want)
  return g === w ? `OK   ${label}` : `DIE  ${label} — got ${got}, expected ${want}`
}
console.log('Post-wire assertEq("adapter.depositCap()") behaviour:')
const cap = 10_000_000_000n
console.log(`  bigint == bigint (the real path, viem returns uint256 as bigint)`)
console.log(`    ${assertEq('depositCap', cap, cap)}`)
console.log(`  a 1-wei on-chain difference is caught`)
console.log(`    ${assertEq('depositCap', cap - 1n, cap)}`)
console.log(`  a Number/BigInt mix would be caught too, once past 2^53 (String(1e21) === '1e+21')`)
console.log(`    ${assertEq('depositCap', 10n ** 21n, 1e21)}`)
console.log(`  …but IS silently equal below 2^53 — Number and BigInt stringify identically`)
console.log(`    ${assertEq('depositCap', 10_000_000_000n, 10_000_000_000)}   <-- lossless here, so harmless`)
console.log('')
