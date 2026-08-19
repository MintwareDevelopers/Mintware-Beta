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

// First team treasury provisioned via the factory + funded end-to-end on Base Sepolia (2026-08-19).
// Proves the loop: createVault → adapter.setVault → commitTeam (junior first-loss, activates) →
// depositUSDC (senior, par). State after: totalSeniorAssets 2 USDC · juniorUsdcBuffer 1 USDC · solvent.
// Demo/example only (mock team token + mock 4626 yield source) — testnet + unaudited.
export const TREASURY_EXAMPLE = {
  baseSepolia: {
    vault:       '0x6Ca20e28619F7C350b617027f5bc1614B81CC0D8',
    jitHook:     '0xA5657eC658e1c560aC4bb30040bb784D3Fa3E0c8', // mined V4 permission bits 0x20C8
    gateway:     '0x53b601816DACB51eb0a292C21AdB55ab13ADf12B', // settleSpend card rail
    adapter:     '0x688a05F94CD12C2A30Af0c584357fA8c5B36645e', // MintwareERC4626YieldAdapter
    yieldSource: '0xc6235766194Da60CD0bfB65e548d203151C5e56c', // MockERC4626 over USDC (demo)
    teamToken:   '0xF663923a9639f37f9E787770AEaedAb0966e3740', // MockERC20 6dp (demo junior side)
    usdc:        '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Circle testnet USDC
    // P3 L2 — the vault's ownership was transferred to a 2-of-3 Gnosis Safe (2026-08-19). In prod the
    // Safe owners are the team's Privy embedded wallets (email/passkey signers, no MetaMask). Config +
    // large-withdrawal actions now require 2-of-3 approval; the single-key owner risk is closed.
    controller:  '0x160A3cd1773904DF5D82943d2759E815FE6b4fA1', // 2-of-3 Safe (Safe 1.4.1, Base Sepolia)
  },
} as const

// Safe (Gnosis) 1.4.1 canonical contracts on Base Sepolia — used to deploy a team's treasury multisig.
export const SAFE_BASE_SEPOLIA = {
  proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  singletonL2:  '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  singleton:    '0x41675C099F32341bf84BFc5382aF534df5C7461a',
} as const

export type TreasuryFactoryChain = keyof typeof TREASURY_FACTORY
