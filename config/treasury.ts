// Multi-tenant YPN Treasury Vault Factory — the on-chain foundation for team treasuries.
//
// A team's treasury is a `MintwareTreasuryVault` (senior/junior tranche, earning + spendable). The
// factory deploys the vault + JIT hook + payment gateway per org and registers it. v1 access:
// `createVault` is `onlyOwner` (Mintware-curated / whitelisted teams) — so teams are OPERATOR-
// PROVISIONED for now (owner records the deployed address via PATCH /api/orgs/:id/treasury, then
// funds it). Open self-serve deploy is a v2 (permissionless factory) milestone.
//
// ⚠ Testnet + unaudited. Deployed to Base Sepolia 2026-08-19. External audit gates real value.

export const TREASURY_FACTORY = {
  baseSepolia: {
    chainId: 84532,
    poolManager:     '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408', // live V4 PoolManager on Base Sepolia
    factory:         '0x45e4f020A002C9B4302C6F2DA59e61C2a85b44F7',
    registry:        '0x0f6a05666C554671bbFFA2079778Ae47ec3F30E4',
    hookDeployer:    '0x42A32787595D9f47A369B3b11ac24b8D0552c4a7',
    gatewayDeployer: '0xFbF781676FE93Cd8D8d8e17716461C29f549a644',
    owner:           '0x9c646C48a302f4725450669f1218d3FDb3e933AD', // factory owner (curated createVault)
    explorer:        'https://sepolia.basescan.org',
  },
} as const

export type TreasuryFactoryChain = keyof typeof TREASURY_FACTORY
