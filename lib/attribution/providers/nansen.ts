// =============================================================================
// Attribution Engine v2 — Nansen graded-risk adapter.
//
// Adds graded illicit-exposure to the Risk signal BEYOND the free sanctions
// oracle: mixer / scam / hack / wash labels from Nansen's 500M+ labeled
// addresses. Inert without `NANSEN_API_KEY` (returns no flags) — exactly like
// the Zerion adapter, so it lights up the moment a key is set and never blocks a
// score if the vendor is down. The label→RiskFlag mapper is pure + unit-tested.
// =============================================================================

import type { RiskFlag, RiskType } from '../types'

export interface NansenLabel {
  label?: string | null
  category?: string | null
}

// Keyword → risk mapping over a label's text + category. Ordered by severity;
// first match per RiskType wins (deduped) so one wallet yields at most one flag
// of each kind. Conservative — only fires on unambiguous illicit terms.
const RISK_RULES: { re: RegExp; type: RiskType; severity: number }[] = [
  { re: /sanction|ofac|\bsdn\b/i, type: 'sanctioned', severity: 1 },
  { re: /mixer|tornado|tumbler|blender/i, type: 'mixer', severity: 0.9 },
  { re: /hack|exploit|drainer|stolen|theft/i, type: 'scam', severity: 0.9 },
  { re: /scam|phish|fraud|rug\s?pull|ponzi/i, type: 'scam', severity: 0.85 },
  { re: /wash[\s-]?trad/i, type: 'wash_trading', severity: 0.7 },
]

/** Pure: Nansen labels → deduped RiskFlags. Clean labels → no flags. */
export function mapNansenLabelsToRiskFlags(labels: NansenLabel[]): RiskFlag[] {
  const byType = new Map<RiskType, number>()
  for (const l of labels) {
    const text = `${l.label ?? ''} ${l.category ?? ''}`
    for (const rule of RISK_RULES) {
      if (rule.re.test(text)) {
        const prev = byType.get(rule.type) ?? 0
        if (rule.severity > prev) byType.set(rule.type, rule.severity)
      }
    }
  }
  return [...byType.entries()].map(([type, severity]) => ({ type, severity }))
}

export type RiskFetcher = (address: string) => Promise<RiskFlag[]>

export function nansenConfigured(): boolean {
  return Boolean(process.env.NANSEN_API_KEY)
}

// Injected reader keeps the fetcher unit-testable without a live vendor.
export type NansenLabelReader = (address: string, apiKey: string) => Promise<NansenLabel[]>

const defaultNansenReader: NansenLabelReader = async (address, apiKey) => {
  const res = await fetch(
    `https://api.nansen.ai/api/v1/profiler/address/labels?address=${address}`,
    { headers: { apiKey, accept: 'application/json' } },
  )
  if (!res.ok) return []
  const json = (await res.json()) as { data?: NansenLabel[] } | NansenLabel[]
  return Array.isArray(json) ? json : (json.data ?? [])
}

/**
 * Bind a graded-risk fetcher. Returns [] (no flags) when `NANSEN_API_KEY` is
 * unset or the vendor errors — a score is never blocked on the paid risk tier.
 */
export function buildNansenRiskFetcher(reader: NansenLabelReader = defaultNansenReader): RiskFetcher {
  return async (address: string) => {
    const apiKey = process.env.NANSEN_API_KEY
    if (!apiKey) return []
    try {
      return mapNansenLabelsToRiskFlags(await reader(address, apiKey))
    } catch {
      return []
    }
  }
}
