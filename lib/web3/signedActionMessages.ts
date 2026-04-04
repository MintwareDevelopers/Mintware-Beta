export interface SignedActionEnvelope {
  issuedAt: number
  message: string
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
      address: input.address.toLowerCase(),
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
      teamWallet: input.teamWallet.toLowerCase(),
      issuedAt: input.issuedAt,
      name: input.name,
      projectToken: input.projectToken.toLowerCase(),
      seedAmount: input.seedAmount,
      chainId: input.chainId,
      poolKey: {
        currency0: input.poolKey.currency0.toLowerCase(),
        currency1: input.poolKey.currency1.toLowerCase(),
        fee: input.poolKey.fee,
        tickSpacing: input.poolKey.tickSpacing,
        hooks: input.poolKey.hooks.toLowerCase(),
      },
    },
    null,
    2,
  )
}
