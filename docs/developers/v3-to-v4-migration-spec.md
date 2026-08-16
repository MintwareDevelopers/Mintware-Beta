# v3 → v4 ULV Instant Liquidity Migration — SPEC (FUTURE / parked)

> **Status: parked spec, NOT built.** Captured 2026-08-16 alongside the multi-collateral work.
> A `Mintwarev3ToV4Migrator` router lets a team pull a dormant Uniswap-v3 position and redeploy it
> into the Mintware v4 ULV in one transaction. **Read the "Caveats before building" section — the
> reference Solidity in the brief has real bugs; do not build it verbatim.**

## Concept
```
[ User ] --migrateV3ToMintware()--> [ Migration Router ]
   Step A  v3 NonfungiblePositionManager.decreaseLiquidity() + collect()  → raw token0 + token1
   Step B  v4 PoolManager.unlock() → callback: deposit token0/1 into ULV, mint hook liquidity, idle→Aave
   Step C  mint ULV shares directly to the user
```
Pitch: dormant v3 POL → Mintware active yield (v4 hook JIT fees + Aave idle) in one block; the minted
ULV shares immediately register in the Rust NAV relay → instant card-spend for the treasury/LP.

## Caveats before building (found in review of the brief's reference `Mintwarev3ToV4Migrator.sol`)
1. **NFT authorization is missing (blocking).** The router calls `decreaseLiquidity(tokenId)` /
   `collect(tokenId)`, but the v3 position NFT is owned by the USER — the NPM requires `msg.sender` to
   be the owner or `approved`. The entrypoint never takes custody. `onERC721Received` is defined but
   unused. **Fix:** flow must be `user.safeTransferFrom(NFT → router)` (triggering `onERC721Received`,
   which runs the migration) OR the router pulls the NFT after an explicit approval. As written it
   reverts.
2. **`collect` before `decreaseLiquidity` is misordered.** Step 1 collects *before* any liquidity is
   decreased → it only sweeps already-accrued fees; the principal is collected *after*
   `decreaseLiquidity`. The first `collect` is redundant. Correct order: `decreaseLiquidity` → `collect`.
3. **No slippage guard on the unwind.** `amount0Min: 0, amount1Min: 0`. Fine for a straight LP removal
   (no swap), but the ONLY guard is `minULVSharesOut` at the end — insufficient once a rebalance swap
   is introduced.
4. **No ratio rebalance — the actual hard part.** A dormant/out-of-range v3 position is ~100% ONE
   token; `depositFor(amount0, amount1)` with a lopsided ratio either mis-sizes the ULV position or
   needs an in-flight swap (slippage + MEV/sandwich). **This rebalance leg is where v4 flash
   accounting actually earns its keep** (flash-borrow to hit the vault's target ratio with no upfront
   capital) — not the v3 unwind, which is a plain multicall.
5. **Leftover/dust not handled.** Any token the vault doesn't consume stays stuck in the router →
   must be swept back to the user.
6. **The "40% gas reduction via flash accounting" claim is unsubstantiated** and the v3 unwind is NOT
   inside v4's `unlock`. The atomicity is a normal multicall; real savings come from avoiding
   intermediate approvals/transfers on the rebalance leg. Don't cite 40% without a measured benchmark.
7. **`IMintwareULVVault.depositFor(recipient, amount0, amount1)` is a new interface** the current ULV
   / `MintwareDeFiPairVault` does not expose — needs adding + audited.

## Engineering action items (from the brief, when un-parked)
1. Foundry harness: unwind a mainnet-forked v3 NFT (e.g. USDC/ETH 0.05%) into a `MintwareDeFiPairVault`
   test deployment; assert ULV shares minted + no stuck dust + slippage-bounded.
2. Oracle push infra: Pyth WS / fast-RPC into the Rust NAV relay (see the multi-collateral work).
3. Frontend: 1-click migrate widget — scan wallet for v3 NFTs, project yield delta, single-approval exec.

## Reference (brief's Solidity — for shape only; see caveats 1–7 before use)
The brief's `Mintwarev3ToV4Migrator` uses `IERC721Receiver`, `INonfungiblePositionManager`
(decrease/collect), `IPoolManager.unlock`, and `IMintwareULVVault.depositFor`. Keep it as an intent
sketch; the buildable version must fix custody (1), ordering (2), the rebalance/slippage path (3–4),
and dust (5).
