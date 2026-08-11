# MintWare ULV — Status & Roadmap (living doc)

**Single source of truth** for the ULV product: the vision, what's actually built vs. not, what's
deployed, and the ordered path forward. This exists because work drifts across sessions and gets
lost — **update this doc as things land** so no session has to reconstruct reality from scratch.

_Last updated: 2026-08-11._

---

## The vision (what we're building toward)

**MintWare ULV (Uniswap Liquidity Vault):** LP capital sits **idle in a lending market (Aave)
earning yield by default**; when a swap hits the Uniswap V4 pool, a **hook pulls just the needed
liquidity from Aave into a concentrated range, executes the swap, and returns unused capital to
Aave — atomically**. Value is captured from trading fees + **MEV/arbitrage recapture** + optional
impact fees, and routed via a **flexible fee template** (LPs / treasury / buyback / burn). Ranges,
rebalancing, and compounding are auto-managed.

## The one-line reality (read this before trusting anything)

> We have built the productive-liquidity **CHASSIS** — a solvent dual-sided vault + V4 hook +
> am-AMM MEV recapture + reputation-weighted rewards — **deployed on Base Sepolia testnet**.
> We have **NOT** built the ULV **ENGINE** — idle-capital-in-Aave + JIT-liquidity-on-swap. That is
> **zero lines of code.** The deployed stack is real and wired, but **empty, unproven with real
> value, and testnet-only.**

## Vision → reality scorecard

| ULV piece | Reality | Status |
|---|---|---|
| Idle capital → Aave earning yield | Only an abstract `IYieldAdapter` + a mock. No Aave adapter. | ❌ **Not started** |
| JIT liquidity pulled from Aave on swap | `_rebalanceIdleCapital()` is an empty stub. | ❌ **Not started** |
| Vault (deposit → shares, solvent) | Dual-sided `MintwareDeFiPairVault` deployed; frontend points at it | 🟡 Live but **empty** (testnet) |
| MEV recapture (am-AMM) | Built, deployed, wired, **fork-proven**; no live swap has run through it yet | 🟡 Deployed, **not exercised** |
| Fee routing (LPs/treasury/buyback/burn) | LP + reputation/lock-weighted routing works; **no buyback/burn sinks** | 🟡 Partial |
| Slippage / impact fee | Real **deviation-priced** dynamic fee; **no trade-size/impact fee** | 🟡 Partial (different lever) |
| Auto-managed range / rebalance | **Manual only** (`rebalanceToProfile`, provider-gated); off-chain optimizer was deleted | 🟡 Manual |
| Mainnet | Everything is Base Sepolia | ❌ **Testnet only** |

## What's actually deployed (Base Sepolia, chainId 84532)

| Contract | Address |
|---|---|
| `MintwareDeFiPairVault` (vault) | `0x983c11b4afb39766ada3a69c66addbc73b456f6e` |
| `MWHookCoordinator` (hook, bits 0xAC8) | `0xe752305538189D2A56A067106373CD6d36dC8aC8` |
| `MWAmAuction` (am-AMM MEV recapture) | `0xcea883efd3a66fc11e3ee53dc83e50a2896773bc` |
| `MintwareWeightedDistributor` (rewards) | `0x8cb41291b336e0ee6a4703c5cf18fbda04fa9ed2` |
| poolId | `0xefea262c0c893396a1a2759be2fa4fd2211840cfc5feba9bb114023bf1a3e370` |
| tokens | USDC `0x036CbD…7e` (6dp) / WETH `0x4200…06` (18dp), **dynamic-fee** pool |

- **Frontend:** `mintware.finance` is cut over to this vault (`NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS`,
  Vercel prod, verified in the live bundle). The retired `SocialVault` ghost is gone from prod.
- **On-chain state (cast-verified):** pool initialized, `amAmmEnabled = true`, `rentFunder` →
  auction, `weightedDistributor` wired. **`totalLiquidity = 0` — no deposits, no swap or rent has
  flowed through the live instance.** The full loop is proven only in a fork test
  (`contracts-v4/test/MWPairVaultAmAmmFork.t.sol`).
- **Deploy path:** `POST /api/oracle/deploy-pair-full-testnet` (Privy-signed, re-runnable).
- **Mainnet:** not deployed. Gated on external audit.

## Roadmap (ordered — each is a real gate)

### Phase 0 — Prove what's deployed (small, do first)
Run one **live money-round** on the testnet vault: deposit both tokens → swap → am-AMM manager
fee skim + rent → rent lands with an LP → `claimFees`. Turns "fork-proven" into "watched it happen
on the live contracts." Requires the Privy wallet to hold test USDC + WETH.

### Phase 1 — Build the ULV engine (the big net-new work)
The actual ULV thesis. Its own fuzzed + audited design session:
- Production **Aave-v3 `IYieldAdapter`** (supply/withdraw against `IPool`, aToken accounting).
- **JIT liquidity in the hook**: `beforeSwap` withdraws from Aave → adds concentrated liquidity →
  swap → `afterSwap` removes → re-supplies, inside V4 flash-accounting.
- **Graceful fallback** when Aave liquidity is unavailable (withdrawal can fail mid-swap).
- **Gas break-even analysis** (Aave withdraw+resupply per swap can exceed fee revenue on small swaps).

### Phase 2 — Complete value capture
- Buyback / burn fee-template sinks (the "flexible template" the pitch promises).
- Impact fee (fee scaled by trade size) if wanted — distinct from today's deviation fee.

### Phase 3 — Mainnet
External audit of the whole stack → mainnet. **Non-negotiable gate** (per the am-AMM
flagged-decisions doc).

## Open cleanup PRs (merge when ready)
- **#131** — doc banner: retired SocialVault/MWSocialHook stack → live pair vault
- **#132** — delete verified-dead layer (`FeeLib`, `LockLib`, `DeployPhase3`)
- **#134** — decision doc for the single-sided vault + factory
- **#138** — remove single-sided deployment vectors; demote vault to TEST-ONLY harness

## Deferred / operator actions
- 🔒 **Rotate `ORACLE_PRIVATE_KEY`** on-chain (the July-audit exposed key) + drop its dead
  `range`/`agent` fallback in `lib/web3/oracleKeys.ts`.
- Full outright deletion of the single-sided vault (needs the hook-suite security-test rewrite).
- A permissionless **pair-vault factory** for self-serve vault launch (SDK phase) — see #134.

## Working-tree hazards (for future sessions)
- **Two concurrent Claude sessions share this working directory.** Do isolated/contract work in a
  `git worktree`, not the shared tree, or branch switches collide.
- **RTK proxy truncates `git diff` output** — you cannot save a real patch via `git diff > file`
  (it writes a lossy summary). Edit files directly instead.
- Foundry deps are **git submodules** (v4-core/forge-std/OZ/v4-periphery, with nested solmate/
  ds-test) — a fresh worktree needs `git submodule update --init --recursive` to `forge build`.
