/** Normalize a typed token amount while preserving a single decimal separator. */
export function sanitizeAmountInput(raw: string): string {
  const hasPeriod = raw.includes('.')
  const commaCount = (raw.match(/,/g) || []).length
  let value = !hasPeriod && commaCount === 1 ? raw.replace(',', '.') : raw
  value = value.replace(/[^0-9.]/g, '')
  const firstDot = value.indexOf('.')
  return firstDot === -1 ? value : value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '')
}
