// Guardrail: attribution and reputation are not inputs to any active x402 spend decision.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')
const SPEND_PATH_MODULES = [
  'lib/x402/directFacilitator.ts',
  'lib/x402/directSettler.ts',
  'app/api/x402/settle/route.ts',
]
const FORBIDDEN_IMPORT = /from\s+['"][^'"]*(attribution|reputation)[^'"]*['"]/i
const FORBIDDEN_SCORE_IMPORT = /from\s+['"][^'"]*\/(?:server)?score['"]/i
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('Attribution remains outside the active x402 DIRECT spend path', () => {
  for (const rel of SPEND_PATH_MODULES) {
    const code = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))
    it(`${rel} has no attribution or reputation inputs`, () => {
      expect(FORBIDDEN_IMPORT.test(code)).toBe(false)
      expect(FORBIDDEN_SCORE_IMPORT.test(code)).toBe(false)
      expect(/\b(attribution|reputation)\b/i.test(code)).toBe(false)
    })
  }

  it('x402 config exposes only DIRECT facilitator mode', () => {
    const config = readFileSync(path.join(ROOT, 'lib/x402/config.ts'), 'utf8')
    expect(config).toContain("!== 'direct'")
    expect(config).not.toMatch(/oracleSettler|httpSettler|relayer/)
  })
})
