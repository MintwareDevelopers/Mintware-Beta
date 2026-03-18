export interface ReferralStats {
  address:       string
  ref_code:      string
  ref_link:      string
  tree_size:     number
  tree_quality:  number   // 0-1 float
  sharing_score: number   // 0-125
}

export interface ReferralRecord {
  id:           string
  referrer:     string
  referred:     string
  ref_code:     string
  status:       'pending' | 'active'
  created_at:   string
  activated_at: string | null
}

export interface WalletProfile {
  address:         string
  ref_code:        string
  created_at:      string
  last_seen_at:    string
  total_referred:  number
  active_referred: number
}
