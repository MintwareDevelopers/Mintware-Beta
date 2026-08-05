// WS1 (RWA three-role model) — KYC oracle helpers.
//
// Flow: Persona inquiry resolves → webhook (verify HMAC) → decision → mirror row in
// Supabase → push on-chain to SPVBeneficiaryRegistry.verifyBeneficiary (the `kycProvider`),
// which is what MintwareVRWA._update reads to gate vRWA transfers for Reg D assets.
//
// The on-chain write is fully env-gated and mirrors the server-keeper pattern in
// lib/web3/rwa/navKeeper.ts — it no-ops with a `skipped` reason when unconfigured, so the
// route ships and records intent before the Persona/oracle secrets are wired in prod.
//
// This module has NO Supabase dependency (pure logic + viem) so the pure helpers unit-test
// without a DB; the route owns the Supabase upsert.

import crypto from 'node:crypto'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toHex,
  stringToHex,
  type Address,
  type Hex,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { PERSONA_WEBHOOK_SECRET } from '@/lib/constants'

// KYCLevel mirrors the on-chain enum: 0 NONE, 1 BASIC, 2 ACCREDITED, 3 INSTITUTIONAL.
export type KycLevel = 0 | 1 | 2 | 3

export interface KycDecision {
  address: string            // lowercased EVM wallet (the Persona reference-id)
  status: 'verified' | 'declined'
  level: KycLevel
  countryCode: string        // ISO alpha-2, or '' if unknown
  restricted: boolean
  expiresAt: number          // unix seconds; 0 = no expiry (registry treats 0 as non-expiring)
  inquiryId: string
  providerHash: Hex          // keccak256(inquiryId) — no PII on-chain
}

const REGISTRY_ABI = parseAbi([
  'function kycProvider() view returns (address)',
  'function verifyBeneficiary(address account, uint8 level, bytes32 providerHash, bytes2 countryCode, uint64 expiresAt, bool isRestricted)',
])

// ── Persona webhook signature ────────────────────────────────────────────────
//
// Persona signs webhooks with `Persona-Signature: t=<unixts>,v1=<hex-hmac>` where the HMAC is
// HMAC-SHA256(secret, `${t}.${rawBody}`). Verify against the RAW request body (not re-serialized).
export function verifyPersonaSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string = PERSONA_WEBHOOK_SECRET,
): boolean {
  if (!secret || !signatureHeader) return false
  const parts: Record<string, string> = {}
  for (const seg of signatureHeader.split(',')) {
    const i = seg.indexOf('=')
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim()
  }
  const t = parts['t']
  const v1 = parts['v1']
  if (!t || !v1) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(v1)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ── payload parsing ──────────────────────────────────────────────────────────

export interface ParsedInquiry {
  event: string
  inquiryId: string
  status: string            // Persona inquiry status (approved / declined / completed / ...)
  referenceId: string       // we set this to the wallet address at inquiry creation
  countryCode: string
}

// Persona webhook shape is deeply nested and version-dependent; extract defensively.
export function parsePersonaInquiry(body: unknown): ParsedInquiry | null {
  const b = body as any
  const attrs = b?.data?.attributes
  const inquiry = attrs?.payload?.data ?? b?.data
  const ia = inquiry?.attributes
  if (!attrs?.name || !inquiry?.id || !ia) return null
  return {
    event:       String(attrs.name),
    inquiryId:   String(inquiry.id),
    status:      String(ia.status ?? ''),
    referenceId: String(ia['reference-id'] ?? ia.referenceId ?? ''),
    countryCode: String(
      ia['address-country-code'] ?? ia.fields?.['address-country-code']?.value ?? '',
    ),
  }
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/i
const APPROVED = new Set(['approved', 'completed'])
const DECLINED = new Set(['declined', 'failed', 'expired'])

// A Persona inquiry → a KYC decision, or null if the event/inquiry isn't actionable.
export function decisionFromInquiry(p: ParsedInquiry): KycDecision | null {
  if (!ADDRESS_RE.test(p.referenceId)) return null
  const isApproved = APPROVED.has(p.status)
  const isDeclined = DECLINED.has(p.status)
  if (!isApproved && !isDeclined) return null
  return {
    address:      p.referenceId.toLowerCase(),
    status:       isApproved ? 'verified' : 'declined',
    level:        isApproved ? 1 : 0, // BASIC on a passing inquiry; accreditation tier is a later vendor
    countryCode:  p.countryCode.toUpperCase().slice(0, 2),
    restricted:   false, // sanctions/PEP → restricted mapping is a follow-up on the Persona report
    expiresAt:    0,
    inquiryId:    p.inquiryId,
    providerHash: providerHashFor(p.inquiryId),
  }
}

export function providerHashFor(inquiryId: string): Hex {
  return keccak256(toHex(inquiryId))
}

// bytes2 ISO country code, or 0x0000 when unknown.
export function countryToBytes2(cc: string): Hex {
  const c = (cc || '').toUpperCase().slice(0, 2)
  return c.length === 2 ? stringToHex(c, { size: 2 }) : ('0x0000' as Hex)
}

// ── on-chain write (env-gated) ───────────────────────────────────────────────

export interface OnChainResult {
  onchain_status: 'written' | 'failed' | 'skipped'
  onchain_tx?: string
  skipped?: 'not_configured' | 'not_verified' | 'provider_mismatch'
}

function normKey(k: string): Hex {
  const t = k.trim()
  return `0x${t.startsWith('0x') ? t.slice(2) : t}` as Hex
}

// Push a verified decision to SPVBeneficiaryRegistry.verifyBeneficiary as the `kycProvider`.
// No-ops (skipped) when the registry/oracle key aren't configured, so it's safe pre-secrets.
export async function writeBeneficiaryOnChain(d: KycDecision): Promise<OnChainResult> {
  const registry  = process.env.SPV_REGISTRY_ADDRESS
  const oracleKey = process.env.RWA_KYC_ORACLE_PRIVATE_KEY
  const chainName = process.env.RWA_POOL_CHAIN ?? 'base_sepolia'

  if (d.status !== 'verified') return { onchain_status: 'skipped', skipped: 'not_verified' }
  if (!registry || !oracleKey) return { onchain_status: 'skipped', skipped: 'not_configured' }

  const chain: Chain = chainName === 'base' ? base : baseSepolia
  const rpc = chainName === 'base'
    ? (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org')
    : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org')

  const account = privateKeyToAccount(normKey(oracleKey))
  const publicClient = createPublicClient({ chain, transport: http(rpc) })

  // Don't broadcast a tx that will revert with OnlyKycProvider — surface the mismatch instead.
  const onChainProvider = await publicClient.readContract({
    address: registry as Address, abi: REGISTRY_ABI, functionName: 'kycProvider',
  })
  if ((onChainProvider as string).toLowerCase() !== account.address.toLowerCase()) {
    return { onchain_status: 'skipped', skipped: 'provider_mismatch' }
  }

  const walletClient = createWalletClient({ account, chain, transport: http(rpc) })
  const txHash = await walletClient.writeContract({
    address: registry as Address,
    abi: REGISTRY_ABI,
    functionName: 'verifyBeneficiary',
    args: [
      d.address as Address,
      d.level,
      d.providerHash,
      countryToBytes2(d.countryCode),
      BigInt(d.expiresAt),
      d.restricted,
    ],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') return { onchain_status: 'failed', onchain_tx: txHash }
  return { onchain_status: 'written', onchain_tx: txHash }
}
