export interface ReferralStats {
  address:       string
  ref_code:      string
  ref_link:      string
  tree_size:     number
  tree_quality:  number
  sharing_score: number
}

export interface ReferralRecord {
  id:         string
  referrer:   string
  referred:   string
  ref_code:   string
  status:     'pending' | 'active'
  created_at: string
}

export interface WalletProfile {
  address:      string
  ref_code:     string
  last_seen_at: string
  created_at:   string
}
