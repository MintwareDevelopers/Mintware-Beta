// Round-4 audit fix (High): the LP Gateway V1 deposit-amount `<input>` used to sanitize typed/pasted
// text by just deleting any non-digit/non-period character (`e.target.value.replace(/[^0-9.]/g, '')`).
// On a comma-decimal locale, "1,25" (meaning 1.25 USDG) silently became "125" — a 100x-inflated deposit
// with no error at review or wallet confirmation (both stages just display the corrupted, internally
// self-consistent number). A lone comma with NO period already present is almost certainly a decimal
// separator, so normalize it to '.' first; a comma alongside an existing period (e.g. "1,234.56", a US
// thousands-grouped amount) is left as a thousands separator and simply stripped, matching the prior
// (already-correct) behavior for that shape — don't regress it by blindly converting every comma.
// Whatever's left is then collapsed to at most one '.' so a still-ambiguous multi-separator input fails
// loudly via `parseUnits` throwing (caught by the caller's existing try/catch) instead of silently
// truncating to a wrong-order-of-magnitude amount. Kept as a pure function so it can be unit-tested
// directly (V1PoolDetail.tsx is a 'use client' component with wallet/Privy imports unsuitable for a
// plain Node vitest environment).
export function sanitizeAmountInput(raw: string): string {
  const hasPeriod = raw.includes('.')
  const commaCount = (raw.match(/,/g) || []).length
  let s = !hasPeriod && commaCount === 1 ? raw.replace(',', '.') : raw
  s = s.replace(/[^0-9.]/g, '')
  const firstDot = s.indexOf('.')
  return firstDot === -1 ? s : s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
}
