// Canonical **Ethereum mainnet** reference addresses for the YPN float-settlement deploy path
// (`contracts-v4/script/DeployFloatSettlement.s.sol` → `MintwareTreasuryFloatSettlement`).
//
// These are the go-forward settlement's real dependencies: the Lido staking tokens (wstETH/stETH) and
// the ETH/USDC pair behind the keeper's 2-hop replenish + emergency-swap legs, plus the Aave v3 Pool the
// idle-capital rehypothecation adapter routes through. They are **documented reference defaults only** —
// the deploy script reads each from an env var (see the mapping below) and these values are the
// env-overridable defaults, NOT trust-hardcoded into any audited contract.
//
// ⚠⚠ VERIFY BEFORE DEPLOY ⚠⚠  Exact-address correctness is a DEPLOY-TIME responsibility. Every address
// below MUST be re-verified against the canonical source (Etherscan / the protocol's own docs) at deploy
// time and set explicitly in the deploy env. Do not treat this file as authoritative for a mainnet
// broadcast — treat it as a checklist. A wrong address here silently routes real value to the wrong place.
//
// Env var → address mapping consumed by the Foundry deploy script (all optional; each falls back to a
// self-contained mock for the testnet stand-up — see the script header):
//   WSTETH_ADDRESS    → wstETH   (settlement ctor token, 18dp)
//   WETH_ADDRESS      → WETH     (settlement ctor token, 18dp)
//   USDC_ADDRESS      → USDC     (settlement ctor token, 6dp)
//   LIDO_RATE_SOURCE  → wstETH   (its `stEthPerToken()` is the wstETH/ETH rate reference)
//   (Aave v3 Pool + stETH are referenced by the idle-capital adapter / rate math, not the settlement ctor.)
//
// Sources (verify at deploy): Etherscan + Lido/Aave official docs.

export const SETTLEMENT_MAINNET_REFS = {
  chainId: 1,
  // ⚠ VERIFY before deploy — Lido Wrapped stETH (wstETH), 18dp. Ctor token + `stEthPerToken()` rate source.
  wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  // ⚠ VERIFY before deploy — Lido stETH (rebasing), 18dp.
  stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  // ⚠ VERIFY before deploy — Aave v3 Pool (Ethereum mainnet). Idle-capital rehypothecation entry point.
  aaveV3Pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  // ⚠ VERIFY before deploy — Wrapped Ether (WETH), 18dp. Ctor token; middle leg of the 2-hop.
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  // ⚠ VERIFY before deploy — Circle USD Coin (USDC), 6dp. Ctor token; settlement output asset.
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
} as const

// The env var each reference is threaded through in `DeployFloatSettlement.s.sol`. Keep in sync with the
// script's `vm.envOr(...)` reads so the "one home" for these addresses stays this file + deployments.md.
export const SETTLEMENT_REF_ENV = {
  wstETH: 'WSTETH_ADDRESS',
  weth: 'WETH_ADDRESS',
  usdc: 'USDC_ADDRESS',
  lidoRateSource: 'LIDO_RATE_SOURCE',
} as const

export type SettlementMainnetRefs = typeof SETTLEMENT_MAINNET_REFS
