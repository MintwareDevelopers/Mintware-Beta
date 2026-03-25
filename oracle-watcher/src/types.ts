// =============================================================================
// oracle-watcher — shared types
// =============================================================================

export interface Env {
  OW_STATE:                  KVNamespace
  SUPABASE_URL:              string
  SUPABASE_SERVICE_ROLE_KEY: string
  BASE_SEPOLIA_RPC_URL:      string
  ORACLE_SECRET:             string  // AI_ATTRIBUTION_ORACLE_SECRET
  ORACLE_API_BASE_URL:       string  // https://mintware-beta.vercel.app
  WETH_ADDRESS:              string  // 0x4200000000000000000000000000000000000006
}

export interface TransferLog {
  transactionHash: string
  blockNumber:     string   // hex
  address:         string   // token contract (WETH)
  topics:          string[] // [Transfer sig, from (padded), to (padded)]
  data:            string   // amount (hex)
}

export interface PendingSignature {
  address:     string
  tx_hash:     string
  signature:   string
  nonce:       string
  deadline:    string
  volume_wei:  string
  campaign_id: number
}

export interface PnlLog {
  transactionHash: string
  agentAddress:    string
  direction:       'in' | 'out'   // in = WETH received, out = WETH sent
  amountWei:       string          // raw hex amount from log.data
}
