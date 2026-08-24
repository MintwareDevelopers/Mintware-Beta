// Payer-keyed store for x402 standing spend-permits — the agent twin of the card permit columns on
// `org_cards`. An x402 agent registers ONE long-lived DelegatedSpendPermit (lib/org/spendPermit.ts)
// against a gateway; the settle path (app/api/x402/settle) fetches it and threads it into the
// relayer's `SettleParams.permit`. Table + deny-all RLS: supabase/migrations/20260824000001.
//
// `getStandingPermit` returns the RelayerPermit wire shape the relayer expects (snake_case, decimal
// strings) — exactly what `httpSettler` puts on the relayer `/settle` body — so the settle path can
// pass it straight through. Server-only (service-role client); never import into client code.

import type { getServiceClient } from '@/lib/web2/supabase'
import type { RelayerPermit } from './facilitator'

type SupabaseClient = ReturnType<typeof getServiceClient>

/** The full permit record a payer registers once and reuses across many settlements. */
export interface StandingPermitInput {
  payer: string
  gateway: string
  chainId: number
  /** DelegatedSpendPermit.user — must equal `payer` (enforced by the registration route). */
  user: string
  maxDailySpendUsdc: string
  nonce: string
  deadline: string
  signature: string
}

/** Store (upsert) a payer's standing permit, keyed by (payer, gateway). Re-registering overwrites the
 *  prior permit for that gateway — the newest signed permit wins, matching the card re-activate flow. */
export async function putStandingPermit(
  supabase: SupabaseClient,
  input: StandingPermitInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payer = input.payer.toLowerCase()
  const gateway = input.gateway.toLowerCase()
  const { error } = await supabase
    .from('x402_standing_permits')
    .upsert(
      {
        payer,
        gateway,
        chain_id: input.chainId,
        permit_user: input.user.toLowerCase(),
        max_daily_spend_usdc: input.maxDailySpendUsdc,
        nonce: input.nonce,
        deadline: input.deadline,
        signature: input.signature,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'payer,gateway' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Fetch a payer's standing permit for a gateway in the relayer's `SettleParams.permit` wire shape,
 *  or null when none is registered. Returns null (fail-closed) on any query error — the settle path
 *  then refuses to settle rather than submitting without a permit. Deadline is NOT filtered here (the
 *  Gateway enforces it on-chain); this is a straight round-trip of the stored signed values. */
export async function getStandingPermit(
  supabase: SupabaseClient,
  payer: string,
  gateway: string,
): Promise<RelayerPermit | null> {
  const { data, error } = await supabase
    .from('x402_standing_permits')
    .select('permit_user, max_daily_spend_usdc, nonce, deadline, signature')
    .eq('payer', payer.toLowerCase())
    .eq('gateway', gateway.toLowerCase())
    .maybeSingle()
  if (error || !data) return null
  return {
    user: data.permit_user as string,
    max_daily_spend_usdc: data.max_daily_spend_usdc as string,
    nonce: data.nonce as string,
    deadline: data.deadline as string,
    signature: data.signature as string,
  }
}
