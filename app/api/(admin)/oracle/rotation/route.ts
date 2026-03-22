// =============================================================================
// GET /api/admin/oracle/rotation?contract=<address>&chain=<slug>
//
// Returns the current oracle signer and pending rotation state from the
// MintwareDistributor contract. Allows operator dashboards to surface a warning
// when a rotation is pending (so operators know to confirm or cancel within 48h).
//
// The contract exposes these as public state variables:
//   oracleSigner              — currently active oracle address
//   pendingOracleSigner       — proposed new signer; zero address if no rotation
//   oracleRotationAvailableAt — unix timestamp when confirmOracleSigner() can be called
//
// Response 200:
//   {
//     oracle_signer:               string          // active oracle address
//     pending_oracle_signer:       string | null   // null if no rotation is pending
//     rotation_available_at:       number | null   // unix timestamp or null
//     rotation_pending:            boolean         // true if pendingOracleSigner != address(0)
//     rotation_available_in_secs:  number | null   // seconds until rotation can be confirmed
//   }
// Response 400: missing params
// Response 500: RPC error
//
// Security: this endpoint is read-only — no state changes, no auth token.
// The data it returns is public on-chain. In production, add IP allowlist or
// admin JWT guard before deploying to a public-facing host.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

// Minimal ABI — only the public state getters we need
const ABI_FRAGMENTS = [
  { name: 'oracleSigner',              type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'pendingOracleSigner',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'oracleRotationAvailableAt', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
]

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function getRpcUrl(chain: string): string | null {
  switch (chain.toLowerCase()) {
    case 'base':         return process.env.BASE_RPC_URL         ?? 'https://mainnet.base.org'
    case 'base_sepolia': return process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
    case 'core_dao':     return process.env.CORE_DAO_RPC_URL     ?? 'https://rpc.coredao.org'
    case 'bnb':          return process.env.BNB_RPC_URL          ?? 'https://bsc-dataseed.binance.org'
    default:             return null
  }
}

/** eth_call wrapper — calls a no-input view function and returns the raw result */
async function ethCall(rpcUrl: string, contract: string, selector: string): Promise<string | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: contract, data: selector }, 'latest'],
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.result ?? null
  } catch {
    return null
  }
}

// Function selectors (keccak256 of function signature, first 4 bytes)
// oracleSigner()              → 0x3bb76391
// pendingOracleSigner()       → 0xac2c2916
// oracleRotationAvailableAt() → 0x0e0f9bb5
const SEL_ORACLE_SIGNER              = '0x3bb76391'
const SEL_PENDING_ORACLE_SIGNER       = '0xac2c2916'
const SEL_ROTATION_AVAILABLE_AT      = '0x0e0f9bb5'

function decodeAddress(raw: string | null): string | null {
  if (!raw || raw === '0x') return null
  // ABI-encoded address: 32 bytes, address is in the last 20 bytes
  return ('0x' + raw.slice(-40)).toLowerCase()
}

function decodeUint256(raw: string | null): bigint | null {
  if (!raw || raw === '0x') return null
  return BigInt(raw)
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const contract = searchParams.get('contract')
  const chain    = searchParams.get('chain')

  if (!contract || !chain) {
    return NextResponse.json(
      { error: 'contract and chain params are required' },
      { status: 400 }
    )
  }

  const rpcUrl = getRpcUrl(chain)
  if (!rpcUrl) {
    return NextResponse.json(
      { error: `Unknown chain: ${chain}` },
      { status: 400 }
    )
  }

  // Fetch all three values in parallel
  const [rawOracle, rawPending, rawAvailableAt] = await Promise.all([
    ethCall(rpcUrl, contract, SEL_ORACLE_SIGNER),
    ethCall(rpcUrl, contract, SEL_PENDING_ORACLE_SIGNER),
    ethCall(rpcUrl, contract, SEL_ROTATION_AVAILABLE_AT),
  ])

  if (!rawOracle) {
    return NextResponse.json(
      { error: 'Failed to read oracle state from chain — RPC error or wrong contract address' },
      { status: 500 }
    )
  }

  const oracleSigner        = decodeAddress(rawOracle)
  const pendingOracleSigner = decodeAddress(rawPending)
  const availableAt         = decodeUint256(rawAvailableAt)

  const rotationPending = (
    pendingOracleSigner !== null &&
    pendingOracleSigner !== ZERO_ADDRESS
  )

  const nowSecs = Math.floor(Date.now() / 1000)
  const availableAtNum = availableAt !== null ? Number(availableAt) : null
  const rotationAvailableInSecs = (rotationPending && availableAtNum !== null)
    ? Math.max(0, availableAtNum - nowSecs)
    : null

  return NextResponse.json({
    oracle_signer:              oracleSigner,
    pending_oracle_signer:      rotationPending ? pendingOracleSigner : null,
    rotation_available_at:      rotationPending ? availableAtNum : null,
    rotation_pending:           rotationPending,
    rotation_available_in_secs: rotationAvailableInSecs,
  })
}
