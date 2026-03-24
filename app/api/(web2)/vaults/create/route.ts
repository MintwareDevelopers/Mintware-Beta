// =============================================================================
// POST /api/vaults — create a new social vault record
// Called from /vault/create after team reviews config.
// On-chain seedTeamTokens() is wired in T3.5 — this records the DB entry.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

interface CreateVaultPayload {
  name:             string
  team_wallet:      string
  project_token:    string
  seed_amount:      number
  pool_key:         Record<string, unknown>
  chain_id:         number
  contract_address: string | null
  status:           string
}

function validate(b: unknown): b is CreateVaultPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.name          === 'string' && p.name.length > 0 &&
    typeof p.team_wallet   === 'string' && (p.team_wallet as string).startsWith('0x') &&
    typeof p.project_token === 'string' && (p.project_token as string).startsWith('0x') &&
    typeof p.seed_amount   === 'number' && p.seed_amount > 0 &&
    typeof p.pool_key      === 'object' && p.pool_key !== null &&
    typeof p.chain_id      === 'number'
  )
}

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!validate(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase
    .from('social_vaults')
    .insert({
      name:             body.name,
      team_wallet:      body.team_wallet.toLowerCase(),
      project_token:    body.project_token.toLowerCase(),
      seed_amount:      body.seed_amount,
      pool_key:         body.pool_key,
      chain_id:         body.chain_id,
      contract_address: body.contract_address ?? null,
      status:           body.status ?? 'seeding',
      tvl_usdc:         0,
    })
    .select('id, name, status')
    .single()

  if (error || !data) {
    console.error('[POST /api/vaults]', error?.message)
    return NextResponse.json({ error: 'Failed to create vault' }, { status: 500 })
  }

  // Open epoch 1 for the new vault
  await supabase.from('vault_epochs').insert({
    vault_id:     data.id,
    epoch_number: 1,
    total_pool:   0,
    bonus_pool:   0,
    status:       'active',
  })

  return NextResponse.json({ id: data.id, name: data.name, status: data.status }, { status: 201 })
}
