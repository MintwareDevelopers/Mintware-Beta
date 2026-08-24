// Guardrail: Attribution/reputation scores MUST NOT influence spend, authorization, or settlement.
//
// Legal confirmed (docs/legal/attribution-informational.md) that Attribution is purely informational —
// it feeds REWARDS-pool distribution multipliers only, never access / credit / spend-limit decisions.
// The card-swipe authorize path (`lib/org/cardAuthorize.ts`), the on-chain settle path
// (`lib/org/settleSwipe.ts`), and the x402 edge-auth NAV-hold client (`lib/x402/edgeHttp.ts`) decide
// purely on treasury NAV + a role/daily cap + a statistical VaR haircut. This test source-scans those
// modules so a future regression that wires a reputation score into a spend/authorize/settle decision
// fails in CI.
//
// NOTE: `lib/x402/pricing.ts` + `lib/x402/facilitator.ts` are DELIBERATELY excluded — they wire the
// OPTIONAL, off-by-default trust-tiering port (`X402_TRUST_TIERING`), where Attribution is only ever
// ONE possible pluggable signal and is off unless an operator opts in with `=parked` (which tiers by
// parked size, not Attribution). That is not a spend/authorize/settle *decision* module.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')

/** Modules that form the human/agent SPEND · AUTHORIZE · SETTLE decision path. */
const SPEND_PATH_MODULES = [
  'lib/org/cardAuthorize.ts', // card-swipe authorize decision (role cap + edge-auth NAV hold)
  'lib/org/settleSwipe.ts',   // on-chain settle (burn shares → pay merchant)
  'lib/org/standing.ts',      // Standing tier — derived from settled spend, feeds the authorize belt/headroom
  'lib/x402/edgeHttp.ts',     // edge-auth NAV-hold client (verify/settle transport)
]

// Anything matching these = a reputation/score signal leaking into the decision path.
const FORBIDDEN_IMPORT = /from\s+['"][^'"]*(attribution|reputation)[^'"]*['"]/i
const FORBIDDEN_SCORE_IMPORT = /from\s+['"][^'"]*\/(?:server)?score['"]/i

/** Strip line + block comments so a benign "no Attribution" comment can't trip the scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('Attribution is informational: no reputation score in the spend/authorize/settle path', () => {
  for (const rel of SPEND_PATH_MODULES) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8')
    const code = stripComments(src)

    it(`${rel} imports no attribution/reputation module`, () => {
      expect(FORBIDDEN_IMPORT.test(code)).toBe(false)
      expect(FORBIDDEN_SCORE_IMPORT.test(code)).toBe(false)
    })

    it(`${rel} references no attribution/reputation identifier in code`, () => {
      // Comment-stripped source must contain no attribution/reputation token at all.
      expect(/\battribution\b/i.test(code)).toBe(false)
      expect(/\breputation\b/i.test(code)).toBe(false)
    })
  }

  it('x402 trust-tiering (the only Attribution seam) is OFF unless an operator opts in', () => {
    // The default facilitator authorizes on NAV alone; the optional tiering port only turns on with
    // X402_TRUST_TIERING=parked — and even then tiers by parked size, explicitly not by Attribution.
    const config = readFileSync(path.join(ROOT, 'lib/x402/config.ts'), 'utf8')
    expect(config).toMatch(/X402_TRUST_TIERING\s*!==\s*['"]parked['"]/)
    expect(config).toMatch(/return\s+undefined/)
  })
})
