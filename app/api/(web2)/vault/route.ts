// =============================================================================
// GET /api/vault?id=<uuid>          — single vault + active epoch
// GET /api/vault?address=<wallet>   — all deposits for a wallet
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const id      = searchParams.get('id')
  const address = searchParams.get('address')

  const supabase = createSupabaseServiceClient()

  // ── Single vault by id ──────────────────────────────────────────────────
  if (id) {
    const { data: vault, error } = await supabase
      .from('social_vaults')
      .select(`
        *,
        current_epoch:vault_epochs(
          id, epoch_number, total_pool, bonus_pool, total_claimed,
          status, opened_at, closed_at, deadline, merkle_root
        )
      `)
      .eq('id', id)
      .single()

    if (error || !vault) {
      return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
    }
    return NextResponse.json(vault)
  }

  // ── Wallet deposits ─────────────────────────────────────────────────────
  if (address) {
    const wallet = address.toLowerCase()

    const [depositsRes, queueRes] = await Promise.all([
      supabase
        .from('lp_deposits')
        .select('*, vault:social_vaults(id,name,project_token,status,tvl_usdc)')
        .eq('wallet', wallet)
        .neq('status', 'withdrawn')
        .order('deposited_at', { ascending: false }),
      supabase
        .from('withdrawal_queue')
        .select('*')
        .eq('wallet', wallet)
        .eq('status', 'pending')
        .order('notice_given_at', { ascending: false }),
    ])

    return NextResponse.json({
      deposits:         depositsRes.data  ?? [],
      withdrawal_queue: queueRes.data     ?? [],
    })
  }

  return NextResponse.json({ error: 'Missing id or address param' }, { status: 400 })
}
