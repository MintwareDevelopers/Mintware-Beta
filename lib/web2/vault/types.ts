// Phase 2 — Social Vault types (Web2 layer)

export type VaultStatus = 'seeding' | 'active' | 'paused' | 'closed'
export type LockTier    = 'flex' | 'committed' | 'aligned' | 'core'
export type EpochStatus = 'active' | 'settling' | 'published' | 'finalized' | 'swept'

export interface SocialVault {
  id:               string
  name:             string
  team_wallet:      string
  project_token:    string
  seed_amount:      number
  pool_key:         PoolKey
  contract_address: string | null
  status:           VaultStatus
  chain_id:         number
  tick_lower:       number | null
  tick_upper:       number | null
  tvl_usdc:         number
  created_at:       string
  updated_at:       string
  // Phase-3 two-surface columns (nullable on legacy rows)
  surface?:         'defi' | 'rwa'
  vault_standard?:  'legacy' | 'erc4626'
  provider?:        string | null
  // joined from vault_epochs (latest active)
  current_epoch?:   VaultEpoch | null
}

export interface PoolKey {
  token0:      string
  token1:      string
  fee:         number
  tickSpacing: number
  hooks:       string
}

export interface LpDeposit {
  id:                string
  vault_id:          string
  wallet:            string
  usdc_amount:       number
  lock_tier:         LockTier
  locked_until:      string | null
  deposited_at:      string
  compounded_amount: number
  status:            'active' | 'withdrawal_pending' | 'withdrawn'
}

export interface WithdrawalQueueEntry {
  id:               string
  deposit_id:       string
  wallet:           string
  vault_id:         string
  requested_amount: number
  notice_given_at:  string
  executable_at:    string
  penalty_pct:      number
  penalty_amount:   number
  status:           'pending' | 'executed' | 'cancelled'
  executed_at:      string | null
}

export interface VaultEpoch {
  id:            string
  vault_id:      string
  epoch_number:  number
  total_pool:    number
  bonus_pool:    number
  total_claimed: number
  deadline:      string | null
  merkle_root:   string | null
  ipfs_cid:      string | null
  tx_hash:       string | null
  status:        EpochStatus
  opened_at:     string
  closed_at:     string | null
}

// Lock tier display metadata
export const LOCK_TIERS: Record<LockTier, {
  label:      string
  period:     string
  multiplier: string
  notice:     string
  color:      string
}> = {
  flex:      { label: 'Flex',      period: 'No lock',  multiplier: '1.0×', notice: '7 days', color: 'var(--color-mw-ink-3)' },
  committed: { label: 'Committed', period: '30 days',  multiplier: '1.15×', notice: '7 days', color: 'var(--color-mw-brand)' },
  aligned:   { label: 'Aligned',   period: '90 days',  multiplier: '1.3×', notice: '7 days', color: 'var(--color-mw-teal)' },
  core:      { label: 'Core',      period: '180 days', multiplier: '1.5×', notice: '7 days', color: 'var(--color-mw-amber)' },
}
