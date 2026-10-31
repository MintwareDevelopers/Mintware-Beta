# RWA owned-pool engine: implementation spike

Local-only proof on `feat/rwa-owned-pool-engine`. No broadcast, keys, app changes or legacy deletions.

## A. Official permissioned custody and routing

Use the checked-out upstream sources, without changing the existing v4-periphery dependency:

- `v4-periphery-permissioned`: `3245c3cb99c48fa1dc2459c3b60abc37d4294aba`.
- `v4-hooks-public`: `f2aa843e266f8f9b34fdaf94ffb72eda5d9204f9`.
- Production reference: `src/permissioned-pools/PermissionedHooks.sol`, not its test mock.

The official factory creates and verifies the adapter. The issuer supplies an ERC-165 allowlist checker.
Only PoolManager holds the adapter's virtual ERC-20. The engine and idle adapters hold underlying property
and USDC. Taking virtual currency from PoolManager burns it and delivers underlying automatically.
Underlying retained by the permissions adapter is backing, plus its verification seed or external donations.
“Nothing stranded” means no extra engine funds beyond that backing; a literal empty adapter is impossible.

The tests execute the official `PermissionedV4Router`, with a small concrete test entrypoint providing
ERC-20 allowance payment and the upstream reentrancy lock. The upstream router itself is abstract.
This is a deliberate deviation from a full Universal Router installation: its command dispatcher and Permit2
are not tested or claimed. The permission checks, action decoder, swaps, wrapping and settlement are real
upstream code, not mocks. The checker and issuer token are test fixtures, not an issuer onboarding product.

The direct engine does not use PermissionedPositionManager NFTs. It does not inherit that manager's hook
registry, issuer-forced unwind or ERC-6909 fallback. Issuers must accept pooled custody and voluntary exits
to eligible recipients. If they require forced recovery, this direct position backend is insufficient.

Verification of the PM's external facts is incomplete. The local pins match, but the claimed
`audits/permissionedPools` directory is absent at the periphery pin. The upstream
[audit directory](https://github.com/Uniswap/v4-periphery/tree/main/audits/permissionedPools)
shows Cantina, OpenZeppelin and one fix-review report in the fetched listing; this is not an audit of our composition.
The fetched [PR #170](https://github.com/Uniswap/contracts/pull/170) page describes Base factory/manager
deployments but shows draft status, not the claimed September 25 merge. No mainnet bytecode or Base Sepolia
absence was independently established. Local deployments avoid depending on those claims.

## B. One permission and appraisal hook

`MintwareRwaAppraisalHook` gains a one-shot owned-pool mode. `pinPoolKey` checks exactly one verified adapter,
plain quote currency, matching PoolManager, underlying and decimals, sorted virtual currencies and dynamic fee.
Its specialized permission kernel follows the production hook: trusted wrapper, reported principal, required
permission flag, and adapter swap switch. Wrapper trust is checked before calling its `msgSender()`.
The adapter is fixed at pinning; no second eligibility registry or deployed permission dispatcher exists.

Initialization sequence:

1. Create the upstream adapter, arrange issuer-native custody permission, seed it and verify it.
2. Deploy a correctly mined hook; pin adapter/USDC and the factory before publishing any appraisal.
3. Publish a dated appraisal; the hook owner initializes inside the fresh core band.
4. Deploy the engine against the initialized pool, using this hook as `IMarketAssetMark`.
5. Bind the engine to the hook, checking pool id, PoolManager, mark and underlying asset ordering.
6. Bind the existing idle adapters, grant engine wrapper/LP permissions, and activate.
7. Qualified holders contribute both assets; the engine adds liquidity. Approve the router and enable swaps.

This resolves the original hook/engine construction cycle without a placeholder vault or deployment factory.
Mark reads, swaps and LP additions are unavailable before binding. The hook's legacy mode remains for the
unchanged legacy tests and installer; owned deployments must use `pinPoolKey` and dated publication.

For swaps, all principals including the engine need `SWAP_ALLOWED`. Owned mode has no vault swap exemption.
Freshness, guardian pause, pre-swap core/spec fee, post-swap band and same-side gap-closing exception remain.
Only the engine adds/removes liquidity. Addition requires its wrapper approval and `LIQUIDITY_ALLOWED`.
Removal and zero-liquidity fee collection authenticate pool/engine only: no checker, swap switch, appraisal
age, band, pause or current wrapper approval. Issuer-native transfer restrictions can still prevent delivery.

Dated publication takes `observedAt` and a nonzero report hash, emitted as provenance. It rejects zero,
future or non-increasing observation dates. Publication time still controls update cadence and rolling drift.
The old heartbeat entrypoints cannot refresh an owned market. MW-03's cumulative absolute rolling movement
algorithm remains unchanged, including reversal costs and individual expiry at 24 hours.

The hook is the mark: whole USDC per whole property token, scaled by 1e18, using the accepted appraisal tick
and observation time. Tick orientation follows adapter/USDC, not underlying addresses. Full-precision math
handles unequal decimals and inversion. Zero marks refuse publication; the opposite tick extreme remains
representable at the supported decimals. Stale mark reads
return dated truth; new risk requires freshness. Age/grace cannot change after pinning; other config and
keeper changes retain their 48-hour timelocks.

## C. Shared engine integration

`MintwareOwnedPoolMarketEngine` reuses the existing core, claim ledger and direct PoolManager position.
The core constructor's existing hooked-mode switch opts into mapping the non-quote settlement asset from
the mark; the concrete owned wrapper validates that mapping against the pinned factory/hook. Hookless
construction still uses identity mapping and the same constructor ABI. No caller-supplied token map exists.

Pool currencies remain adapter/USDC, sorted by those addresses. `token0/1`, NAV, contributions, idle adapters,
receipts and payouts use corresponding underlying assets in exactly that order. They are never re-sorted.
Raw adapter units are 1:1 underlying units. The constructor validates decimals and rejects native currency.

The lifecycle module opts into a new measured position helper. Negative adapter deltas execute:
`sync(adapter) → exact underlying transfer to adapter → wrapToPoolManager(amount) → settle()`.
Both engine debit and adapter receipt must equal the amount, so donations/verification seed cannot subsidize
short funding. Positive deltas use normal `take`; receipts are measured in underlying assets.
Existing unordered position helpers are untouched. Identity settlement still uses the original `pay` path.
Both concrete engine wrappers pin the rebuilt lifecycle module runtime hash.

Shared changes are limited to the opt-in asset mapping, exact dynamic-fee admission, virtual mark readers,
and the module's measured settlement calls. No copied NAV, share, withdrawal or recenter algorithm.
This is a small but real shared-engine change, not an adapter allowlisting-only integration.

The owned wrapper disables optional internal swaps. Seed both assets; public trading uses permissioned routing.
`msgSender()` always reports the engine as pooled principal, not the keeper or permissionless recenter caller.
Recenter removes and adds atomically; revoking LP permission makes re-add revert and restores the old position.

New risk uses the ordinary mark age plus hook freshness. The self-only exit reader accepts pinned age + grace.
Complete in-kind exits work without any mark, even after grace. Partial delivery needs a valid grace mark and
existing spot/minimum checks; undelivered value retains shares. No emergency price or artificial refresh exists.

## D. Shares and issuer boundaries

Owned shares are non-transferable, including `transferFrom`. Minting checks `LIQUIDITY_ALLOWED` for the
recipient and engine, plus engine wrapper approval, including quote-only contributions. Deposits currently
mint to their caller. Burns have no current allowlist gate, allowing revoked holders to exit to an eligible
recipient. Hookless share behavior remains unchanged.

The issuer must separately permit native custody for the permissions adapter, engine, property idle adapter,
contributors and output recipients. PoolManager never receives underlying property. Hook/module/checker need
no custody permissions. A router's approved principal does not waive underlying output-recipient restrictions.

Revoking engine LP/wrapper permission stops new shares and LP additions, but not harvest/removal. A failing
checker likewise cannot block those callbacks. Native token freezes, unreadable idle-adapter NAV, and incomplete
delivery beyond grace remain limitations of the existing exit model. No seizure or wallet recovery is added.

Later tickets must update deployment scripts, curated currency mapping and app readers before rollout.
`DeployMarketLifecycleModule.s.sol`, `VerifyMarketEngine.s.sol` and the existing fork rehearsal still pin
the old module hash; they were deliberately left outside this ticket's edit scope.
No claim of Uniswap UI/API inclusion follows from this local proof. Keep legacy exits discoverable.

## Evidence and measurements

Final verification: **197 passed, 0 failed, 3 existing fork skips; 200 total across 24 suites**.
This includes all 40 new tests (20 per currency orientation), all 5 MW-03 tests, and the unchanged engine
invariants (256 runs × 500 calls). Fork RPC environment variables were unset. Commands (repository root):

```sh
export PATH="$HOME/.foundry/bin:$PATH"
forge test
forge build --sizes
```

First-party nSLOC: comments/blank lines removed, imports/braces retained; diff against branch HEAD before
this spike, comparing stripped source lines. Vendor code is excluded, not counted as a saving.

| File (under contracts-v4 unless stated) | Added | Removed |
|---|---:|---:|
| src/lib/MWV4PositionEngine.sol | 13 | 0 |
| src/lib/MWV4Settlement.sol | 24 | 0 |
| src/rwa/MintwareRwaAppraisalHook.sol | 117 | 7 |
| src/vaults/MintwareMarketEngine.sol | 1 | 1 |
| src/vaults/MintwareMarketEngineCore.sol | 9 | 3 |
| src/vaults/MintwareMarketLifecycleModule.sol | 6 | 10 |
| src/vaults/MintwareOwnedPoolMarketEngine.sol | 52 | 0 |
| test/rwa/OwnedPoolEngine.t.sol | 386 | 0 |
| test/rwa/OwnedPoolFixtures.sol | 65 | 0 |
| **Solidity total** | **673** | **21** |
| foundry.toml (non-comment config lines) | 3 | 0 |

Production Solidity is +222/−21 (net +201); tests add 451. This is not a net-negative source change.
This document replaces 398 lines of proposals with fewer than 200 lines of decisions and evidence.
No existing test has been edited or removed.

`forge build --sizes` passed: 69 reported contracts, none above EIP-170 (24,576 bytes).

| Runtime | Bytes |
|---|---:|
| MintwareOwnedPoolMarketEngine | 24,169 |
| MintwareMarketEngine | 23,187 |
| MintwareMarketLifecycleModule | 7,335 |
| MintwareRwaAppraisalHook | 17,131 |
| PermissionsAdapter | 4,668 |
| PermissionsAdapterFactory | 7,639 |
| PermissionedRoutingEntrypoint (test glue + real router) | 6,580 |
| PoolManager | 17,151 |

Owned-engine headroom is only 407 bytes. Its 30,429-byte initcode also fits EIP-3860.
Both wrappers pin lifecycle runtime hash
`0x92dbd5dfe5c435cc7b4ae0c5c63e43f58356678b04986ef7747ba6396f387e56`.

| Ticket proof | Result |
|---|---|
| 1. Deploy, activate, LP, underlying/virtual custody | PASS, both orders; seed/donation isolation |
| 2. Router permissions, spoof refusal, band/gap closing | PASS using official router core; Universal Router/Permit2 not exercised |
| 3. Withdraw, harvest, recenter, revoked/stale/paused exits | PASS, including checker failure and beyond-grace full delivery |
| 4. Non-transferable shares, recipient mint permission, burns | PASS, including quote-only issuance |
| 5. Single appraisal mark, decimals/orientation, MW-03 | PASS, dated observations and unchanged rolling-drift regressions |
| 6. Full suite and EIP-170 | PASS: 197/0/3; all 69 reported runtimes fit |

Conclusion: the adapter model fits direct engine positions with limited shared changes. It does not prove
Universal Router/Permit2 installation or supply PositionManager forced recovery. Those boundaries, deployment
hash updates and the 407-byte engine margin must be addressed before rollout.

Commit attempt was blocked by the sandbox: Git could not create the parent worktree's `index.lock`.
The verified changes remain uncommitted on `feat/rwa-owned-pool-engine`; nothing was pushed.
