// POST /api/kyc/webhook — Persona inquiry webhook (WS1, RWA three-role trader gate).
//
// Verifies the Persona HMAC signature, maps the inquiry to a KYC decision, mirrors it to
// `kyc_records`, then pushes a verified decision on-chain to SPVBeneficiaryRegistry (the
// `kycProvider`), which is what MintwareVRWA._update reads to gate vRWA transfers for Reg D.
//
// The on-chain write is env-gated (see lib/rwa/kyc.ts) — until PERSONA_WEBHOOK_SECRET,
// RWA_KYC_ORACLE_PRIVATE_KEY, SPV_REGISTRY_ADDRESS are set it records intent and reports
// `skipped: not_configured`, so this ships safely ahead of the secrets.

import { createHandler } from '@/lib/web2/routeHandler'
import {
  verifyPersonaSignature,
  parsePersonaInquiry,
  decisionFromInquiry,
  writeBeneficiaryOnChain,
  type OnChainResult,
} from '@/lib/rwa/kyc'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  const raw = await req.text()
  if (!verifyPersonaSignature(raw, req.headers.get('Persona-Signature'))) {
    ctx.log.warn('kyc', 'invalid Persona signature')
    return ctx.json({ success: false, error: 'invalid signature' }, 401)
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return ctx.json({ success: false, error: 'invalid json' }, 400)
  }

  const parsed = parsePersonaInquiry(body)
  if (!parsed) return ctx.json({ success: true, skipped: 'unparseable_event' })

  const decision = decisionFromInquiry(parsed)
  if (!decision) return ctx.json({ success: true, skipped: 'no_actionable_decision', event: parsed.event })

  const now = new Date().toISOString()

  // Mirror the decision (pending on-chain).
  await ctx.supabase.from('kyc_records').upsert(
    {
      address:        decision.address,
      status:         decision.status,
      level:          decision.level,
      provider:       'persona',
      inquiry_id:     decision.inquiryId,
      provider_hash:  decision.providerHash,
      country_code:   decision.countryCode || null,
      restricted:     decision.restricted,
      expires_at:     decision.expiresAt,
      onchain_status: 'pending',
      updated_at:     now,
    },
    { onConflict: 'address' },
  )

  // Push on-chain (env-gated; never throws out of the route).
  const chain: OnChainResult = await writeBeneficiaryOnChain(decision).catch((e): OnChainResult => {
    ctx.log.error('kyc', 'on-chain verifyBeneficiary failed', { address: decision.address, err: String(e) })
    return { onchain_status: 'failed' }
  })

  await ctx.supabase
    .from('kyc_records')
    .update({ onchain_status: chain.onchain_status, onchain_tx: chain.onchain_tx ?? null, updated_at: new Date().toISOString() })
    .eq('address', decision.address)

  ctx.log.info('kyc', 'processed inquiry', {
    address: decision.address, status: decision.status, onchain: chain.onchain_status,
  })
  return ctx.json({ success: true, address: decision.address, status: decision.status, onchain: chain })
}, { rateLimit: { max: 60, windowMs: 60_000 } })
