export interface SignedActionEnvelope {
  issuedAt: number
  message: string
}

function normalizeAddress(value?: string | null) {
  return (value ?? '').toLowerCase()
}

function normalizeNumericString(value: number | string | bigint) {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return String(value)
  return value
}

function normalizeServices(
  services?: { name: string; endpoint: string; version?: string }[],
) {
  return (services ?? []).map((service) => ({
    name: service.name,
    endpoint: service.endpoint,
    version: service.version ?? null,
  }))
}

export function buildAgentRegisterMessage(input: {
  address: string
  issuedAt: number
  erc8004TokenId?: number | null
  agentName?: string | null
  agentDescription?: string | null
  x402Support?: boolean | null
  operationalStatus?: 'active' | 'paused' | 'offline' | null
  services?: { name: string; endpoint: string; version?: string }[]
}): string {
  return JSON.stringify(
    {
      action: 'mintware-agent-register',
      address: normalizeAddress(input.address),
      issuedAt: input.issuedAt,
      erc8004TokenId: input.erc8004TokenId ?? null,
      agentName: input.agentName ?? null,
      agentDescription: input.agentDescription ?? null,
      x402Support: input.x402Support ?? null,
      operationalStatus: input.operationalStatus ?? null,
      services: normalizeServices(input.services),
    },
    null,
    2,
  )
}

export function buildVaultCreateMessage(input: {
  teamWallet: string
  issuedAt: number
  name: string
  projectToken: string
  seedAmount: number
  chainId: number
  poolKey: {
    currency0: string
    currency1: string
    fee: number
    tickSpacing: number
    hooks: string
  }
}): string {
  return JSON.stringify(
    {
      action: 'mintware-vault-create',
      teamWallet: normalizeAddress(input.teamWallet),
      issuedAt: input.issuedAt,
      name: input.name,
      projectToken: normalizeAddress(input.projectToken),
      seedAmount: input.seedAmount,
      chainId: input.chainId,
      poolKey: {
        currency0: normalizeAddress(input.poolKey.currency0),
        currency1: normalizeAddress(input.poolKey.currency1),
        fee: input.poolKey.fee,
        tickSpacing: input.poolKey.tickSpacing,
        hooks: normalizeAddress(input.poolKey.hooks),
      },
    },
    null,
    2,
  )
}

export function buildAdminMessage(input: {
  wallet: string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-admin-session',
      wallet: normalizeAddress(input.wallet),
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildRedeemRequestMessage(input: {
  vaultId: string
  wallet: string
  sharesUsd: number | string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-redeem-request',
      vaultId: input.vaultId,
      wallet: normalizeAddress(input.wallet),
      sharesUsd: normalizeNumericString(input.sharesUsd),
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildIssuerRegisterMessage(input: {
  wallet: string
  issuedAt: number
  id: string
  name: string
}): string {
  return JSON.stringify(
    {
      action: 'mintware-issuer-register',
      wallet: normalizeAddress(input.wallet),
      issuedAt: input.issuedAt,
      id: input.id,
      name: input.name,
    },
    null,
    2,
  )
}

export function buildRwaDealMessage(input: {
  issuerWallet: string
  issuedAt: number
  name: string
  issuerId: string
  chainId: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-rwa-deal-create',
      issuerWallet: normalizeAddress(input.issuerWallet),
      issuedAt: input.issuedAt,
      name: input.name,
      issuerId: input.issuerId,
      chainId: input.chainId,
    },
    null,
    2,
  )
}

export function buildVaultDepositMessage(input: {
  vaultId: string
  wallet: string
  usdcAmount: number | string
  lockTier: string
  txHash: string
  referrer?: string | null
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-vault-deposit',
      vaultId: input.vaultId,
      wallet: normalizeAddress(input.wallet),
      usdcAmount: normalizeNumericString(input.usdcAmount),
      lockTier: input.lockTier,
      txHash: input.txHash.toLowerCase(),
      referrer: input.referrer ? normalizeAddress(input.referrer) : null,
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildVaultWithdrawMessage(input: {
  depositId: string
  wallet: string
  requestedAmount: number | string
  txHash: string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-vault-withdraw',
      depositId: input.depositId,
      wallet: normalizeAddress(input.wallet),
      requestedAmount: normalizeNumericString(input.requestedAmount),
      txHash: input.txHash.toLowerCase(),
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildCampaignCreateMessage(input: {
  wallet: string
  issuedAt: number
  form: {
    type: string
    chainId: number
    durationDays: number
    schedule: string
    startAt?: string | null
    poolUsd: number
    buyerRewardPct?: number
    referralRewardPct?: number
    useScoreMultiplier?: boolean
    dailyWalletCapUsd?: number
    dailyPoolCapUsd?: number
    // RWA incentive layer (R0 surface foundation) — see docs/developers/rwa-incentive-layer.md
    surface?: string
    linkedDealId?: string | null
    minKycTier?: string
    durationMatchDays?: number
    token: {
      address: string
      symbol: string
      name: string
      decimals: number
    }
  }
}): string {
  return JSON.stringify(
    {
      action: 'mintware-campaign-create',
      wallet: normalizeAddress(input.wallet),
      issuedAt: input.issuedAt,
      form: {
        type: input.form.type,
        chainId: input.form.chainId,
        durationDays: input.form.durationDays,
        schedule: input.form.schedule,
        startAt: input.form.startAt ?? null,
        poolUsd: input.form.poolUsd,
        buyerRewardPct: input.form.buyerRewardPct ?? 0,
        referralRewardPct: input.form.referralRewardPct ?? 0,
        useScoreMultiplier: input.form.useScoreMultiplier ?? false,
        dailyWalletCapUsd: input.form.dailyWalletCapUsd ?? 0,
        dailyPoolCapUsd: input.form.dailyPoolCapUsd ?? 0,
        surface: input.form.surface ?? 'defi',
        linkedDealId: input.form.linkedDealId ?? null,
        minKycTier: input.form.minKycTier ?? 'NONE',
        durationMatchDays: input.form.durationMatchDays ?? 0,
        token: {
          address: normalizeAddress(input.form.token.address),
          symbol: input.form.token.symbol,
          name: input.form.token.name,
          decimals: input.form.token.decimals,
        },
      },
    },
    null,
    2,
  )
}

export function buildCampaignManageMessage(input: {
  campaignId: string
  wallet: string
  action: 'pause' | 'resume' | 'end'
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-campaign-manage',
      campaignId: input.campaignId,
      wallet: normalizeAddress(input.wallet),
      intent: input.action,
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildCampaignManageViewMessage(input: {
  campaignId: string
  wallet: string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-campaign-manage-view',
      campaignId: input.campaignId,
      wallet: normalizeAddress(input.wallet),
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildWalletConnectMessage(input: {
  address: string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-wallet-connect',
      address: normalizeAddress(input.address),
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildReferralApplyMessage(input: {
  referred: string
  refCode: string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-referral-apply',
      referred: normalizeAddress(input.referred),
      refCode: input.refCode,
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildWalletLinkMessage(input: {
  evmAddress: string
  solAddress: string
  solMessage: string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-wallet-link',
      evmAddress: normalizeAddress(input.evmAddress),
      solAddress: input.solAddress,
      solMessage: input.solMessage,
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

export function buildAgentMwpMessage(input: {
  address: string
  mwpHash: string
  issuedAt: number
}): string {
  return JSON.stringify(
    {
      action: 'mintware-agent-mwp-submit',
      address: normalizeAddress(input.address),
      mwpHash: input.mwpHash.toLowerCase(),
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}
