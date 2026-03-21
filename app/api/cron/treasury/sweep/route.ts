// =============================================================================
// GET /api/cron/treasury/sweep
//
// Auto-claims all unclaimed platform_fee leaves (Mintware treasury share) from
// published distributions. Runs daily at 03:00 UTC.
//
// Platform fees accumulate in daily_payouts rows where wallet = MINTWARE_TREASURY_ADDRESS.
// The pool-settle cron attempts auto-claim at settlement time, but if DISTRIBUTOR_PRIVATE_KEY
// ≠ MINTWARE_TREASURY_ADDRESS the auto-claim is skipped. This sweep route uses
// TREASURY_PRIVATE_KEY to submit those claims.
//
// Authorization: Bearer <CRON_SECRET>
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, bsc } from 'viem/chains'

export const maxDuration = 300

const DISTRIBUTOR_ABI = parseAbi([
  'function claim(string calldata campaignId, uint256 epochNumber, bytes32 merkleRoot, bytes calldata oracleSignature, uint256 deadline, uint256 amount, bytes32[] calldata merkleProof)',
])

const CORE_DAO: Chain = {
  id: 1116,
  name: 'Core DAO',
  nativeCurrency: { name: 'CORE', symbol: 'CORE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.coredao.org'] },
    public:  { http: ['https://rpc.coredao.org'] },
  },
}

function getChain(slug: string): Chain | null {
  switch (slug) {
    case 'base':         return base
    case 'base_sepolia': return baseSepolia
    case 'core_dao':     return CORE_DAO
    case 'bnb':          return bsc
    default:             return null
  }
}

function getRpcUrl(slug: string): string {
  switch (slug) {
    case 'base':         return process.env.BASE_RPC_URL         ?? 'https://mainnet.base.org'
    case 'base_sepolia': return process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
    case 'core_dao':     return process.env.CORE_DAO_RPC_URL     ?? 'https://rpc.coredao.org'
    case 'bnb':          return process.env.BNB_RPC_URL          ?? 'https://bsc-dataseed.binance.org'
    default:             return 'https://mainnet.base.org'
  }
}

export async function GET(req: NextRequest) {
  // Auth
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  }

  const treasuryWallet = (process.env.MINTWARE_TREASURY_ADDRESS ?? '').toLowerCase()
  const treasuryKey    = process.env.TREASURY_PRIVATE_KEY

  if (!treasuryWallet || !treasuryKey) {
    return NextResponse.json({
      ok: false,
      error: 'MINTWARE_TREASURY_ADDRESS or TREASURY_PRIVATE_KEY not set',
    }, { status: 500 })
  }

  const startedAt = Date.now()
  const supabase = createSupabaseServiceClient()

  // Find all unclaimed treasury payout rows with published distributions
  const { data: payoutRows, error: fetchErr } = await supabase
    .from('daily_payouts')
    .select(`
      id,
      campaign_id,
      epoch_number,
      amount_wei,
      claimed_at
    `)
    .eq('wallet', treasuryWallet)
    .is('claimed_at', null)

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  }

  if (!payoutRows || payoutRows.length === 0) {
    return NextResponse.json({ ok: true, swept: 0, duration_ms: Date.now() - startedAt })
  }

  // Load matching distributions and campaigns
  const campaignIds = [...new Set(payoutRows.map(r => r.campaign_id))]

  const { data: distributions } = await supabase
    .from('distributions')
    .select('id, campaign_id, epoch_number, oracle_signature, merkle_root, deadline, tree_json, status, campaigns(contract_address, chain, token_contract, token_symbol)')
    .in('campaign_id', campaignIds)
    .eq('status', 'published')

  if (!distributions || distributions.length === 0) {
    return NextResponse.json({ ok: true, swept: 0, message: 'no published distributions found', duration_ms: Date.now() - startedAt })
  }

  // Build lookup: `${campaign_id}:${epoch_number}` → distribution
  const distMap = new Map<string, typeof distributions[0]>()
  for (const d of distributions) {
    distMap.set(`${d.campaign_id}:${d.epoch_number}`, d)
  }

  const privateKey = (treasuryKey.startsWith('0x') ? treasuryKey : `0x${treasuryKey}`) as `0x${string}`
  const account = privateKeyToAccount(privateKey)

  let swept = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of payoutRows) {
    const dist = distMap.get(`${row.campaign_id}:${row.epoch_number}`)
    if (!dist || !dist.oracle_signature || !dist.tree_json) { skipped++; continue }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaign = Array.isArray(dist.campaigns) ? dist.campaigns[0] : (dist.campaigns as any)
    if (!campaign?.contract_address || !campaign?.chain) { skipped++; continue }

    const chain = getChain(campaign.chain)
    if (!chain) { skipped++; continue }

    try {
      // Reconstruct proof for treasury wallet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tree = StandardMerkleTree.load(dist.tree_json as any)
      let proof: string[] | null = null
      let amountWei: string | null = null

      for (const [i, [leafAddr, leafAmt]] of tree.entries()) {
        if ((leafAddr as string).toLowerCase() === treasuryWallet) {
          proof = tree.getProof(i)
          amountWei = leafAmt as string
          break
        }
      }

      if (!proof || !amountWei) { skipped++; continue }

      const deadline = dist.deadline ?? Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60

      const transport    = http(getRpcUrl(campaign.chain))
      const publicClient = createPublicClient({ chain, transport })
      const walletClient = createWalletClient({ account, chain, transport })

      const claimTxHash = await walletClient.writeContract({
        address: campaign.contract_address as `0x${string}`,
        abi:     DISTRIBUTOR_ABI,
        functionName: 'claim',
        args: [
          row.campaign_id,
          BigInt(row.epoch_number),
          dist.merkle_root as `0x${string}`,
          dist.oracle_signature as `0x${string}`,
          BigInt(deadline),
          BigInt(amountWei),
          proof as `0x${string}`[],
        ],
      })

      await publicClient.waitForTransactionReceipt({ hash: claimTxHash })

      // Mark as claimed in DB
      await supabase
        .from('daily_payouts')
        .update({ claimed_at: new Date().toISOString() })
        .eq('id', row.id)

      console.log(`[treasury/sweep] ✓ claimed campaign=${row.campaign_id} epoch=${row.epoch_number} amount=${amountWei} tx=${claimTxHash}`)
      swept++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[treasury/sweep] ✗ campaign=${row.campaign_id} epoch=${row.epoch_number}: ${msg}`)
      errors.push(`${row.campaign_id}#${row.epoch_number}: ${msg}`)
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    swept,
    skipped,
    errors,
    duration_ms: Date.now() - startedAt,
  })
}

export async function POST() {
  return NextResponse.json({ error: 'method not allowed — use GET' }, { status: 405 })
}
