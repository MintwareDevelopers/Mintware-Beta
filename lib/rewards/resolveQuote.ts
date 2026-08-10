// Server-recorded-quote resolution for the swap-reward path (audit HIGH #6/#7).
//
// When the client reports a swap with a `quote_id`, the reward path trusts the SERVER-computed USD
// value recorded at quote time (bound to the quoting wallet, not expired) instead of the
// client-supplied `amount_usd` — which a client could inflate. When no quote_id is supplied, or it
// is unknown / wallet-mismatched / expired, we fall back to the client value (still bounded by the
// $10k single-trade cap + per-campaign daily caps + atomic pool deduction downstream).
import type { createSupabaseServiceClient } from '@/lib/web2/supabase'

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>

export interface QuoteLookupInput {
  quote_id?: string
  wallet: string
  amount_usd: number
}

interface SwapQuoteRow {
  wallet?: string
  amount_usd?: number | string | null
  expires_at?: string
}

/**
 * Resolve the USD value to credit for a swap. Prefers the server-recorded quote when usable.
 * `onFallback` (optional) is invoked with diagnostic info when a supplied quote_id can't be used.
 */
export async function resolveQuoteAmountUsd(
  supabase: ServiceClient,
  input: QuoteLookupInput,
  onFallback?: (info: Record<string, unknown>) => void,
): Promise<number> {
  if (!input.quote_id) return input.amount_usd

  const { data, error } = await supabase
    .from('swap_quotes')
    .select('wallet, amount_usd, expires_at')
    .eq('id', input.quote_id)
    .maybeSingle()

  const quote = data as SwapQuoteRow | null
  const qUsd = Number(quote?.amount_usd)
  const walletMatch = !!quote && String(quote.wallet ?? '').toLowerCase() === input.wallet.toLowerCase()
  const notExpired = !!quote?.expires_at && new Date(quote.expires_at).getTime() > Date.now()

  if (!error && quote && walletMatch && notExpired && Number.isFinite(qUsd) && qUsd > 0) {
    return qUsd
  }

  onFallback?.({ quote_id: input.quote_id, found: !!quote, wallet_match: walletMatch, not_expired: notExpired })
  return input.amount_usd
}
