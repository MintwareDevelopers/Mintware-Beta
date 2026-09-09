# V1 pass 2: gateway money-path context

Source snapshot: `c9c03dde2db4dd2de6ec657b643aee2b2c45b80e`, 2026-09-09. Context analysis only: no vulnerability verdict, severity, or fix is asserted here. No applicable AGENTS.md was found in repository or checked ancestor paths. Applied `audit-context-building` and read its format/example/domain resources.

Line shorthand: **PM** = `contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol`; **S** = sibling `MintwareLpGatewayStaging.sol`; **F** = sibling `MintwareLpGatewayFactory.sol`; **IA** = `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol`; **EA** = sibling `MintwareERC4626YieldAdapter.sol`; **M** = `contracts-v4/src/lib/SeniorSharesMath.sol`; **UPM** = `contracts-v4/lib/v4-periphery/src/PositionManager.sol`. All line references refer to this snapshot.

## Architecture, actors and state

- Factory owner creates one gateway per pool and rejects reuse of an adapter in that factory (F L81-L119). Staging receives its controller exactly once from its immutable deployer (S L41-L54); factory sets controller to the new PM (F L114). Adapter vault must subsequently be bound to staging by its owner (IA L102-L107; EA L93-L98); factory only probes that a reported vault is not already bound (F L136-L147).
- Public users deposit quote and redeem their own non-transferable share balances (PM L503-L562, L580-L584). Owner alone deploys, harvests, compounds, adjusts the principal cap and pauses new deposits (PM L775-L778, L990, L1017-L1059). Permissionless `poke` advances reference memory (PM L756-L758). Factory deactivation changes its registry flag, while PM pause changes deposit admission (F L149-L154; PM L514).
- Self-only `lpLegExit`, `idleLegExit`, `sweepFeesExternal` isolate revert boundaries (PM L723-L750). Swap callback checks immutable PoolManager caller (PM L942-L946); swap state is set/cleared around one unlock (PM L951-L962).
- Aggregate state consists of shares, LP NFT/liquidity, quote and paired cost trackers, cached idle NAV, reference and entry-price buckets, owner controls and recipient rotation (PM L99-L193). LP NFT custody is PM; mint encodes `address(this)` recipient (PM L1154-L1159). Quote custody spans PM, staging during transfers, and the adapter/source (S L56-L85; EA L108-L113).
- Constructor requires initialized hookless ERC20 pool, quote membership, nonzero dependencies, ordered/aligned ticks, and deviation in (0,5000] bps (PM L270-L320). Exact deployed-code identity and trustworthy market depth are operational assumptions, not established by these address/nonzero checks.

## `_deposit` (PM L513-L546)

**Purpose:** Turn newly staged quote into entry-NAV shares.

**Inputs & assumptions:** User amount/minimum are untrusted. Pause, nonzero amount and one action per caller per block are checked before pricing (L514-L517). Idle read must succeed; share math assumes aggregate NAV denominates the same asset units (L522-L524; M L24-L27). LP is marked at the most holder-favourable of spot, reference and retained entry memory (PM L487-L493, L1080-L1084).

**Outputs & effects:** Transfers quote through staging/adapter, then increments caller and total shares and updates reference (L528-L545). Reverts roll back preceding transfers/state.

**Block order:** Price and share floor checks precede external funding; funding precedes strict refreshed NAV; reserve growth must reach amount less 50 bps tolerance and live idle plus both cost trackers must fit cap before minting (L528-L543; tolerance L189). S.stage transfers then approves/deposits to adapter without locally measuring credit (S L56-L62); the PM post-stage check establishes aggregate reserve growth.

**Dependencies/open questions:** IA supplies exact requested nominal amount and tracks it against cap (IA L123-L129); EA asks an external ERC4626 to mint shares to itself (EA L108-L113), and its NAV is fee-net previewRedeem (EA L165-L167). Exact quote transfer semantics/source previews, growth attribution when balances are donated, and correspondence between curated source code and deployed source require validation; nothing found enforcing all possible ERC20/ERC4626 behaviours. Outer nonReentrant applies to both deposit wrappers (PM L503, L509); poke remains separately callable.

## `_withdraw` (PM L576-L719)

**Purpose:** Deliver the user's share of idle and LP; restore shares for unsuccessful delivery.

**Inputs & assumptions:** User shares/minima are untrusted. Nonzero shares, sufficient caller balance and caller block separation checked L580-L584. `lastHolder` means requested shares equal aggregate shares (L587). Source-readable NAV is live; unreadable idle uses 80% cached value (L595-L601, haircut L186). LP liquidity and holder-favourable weight are read before payout calls (L606-L611).

**Outputs & effects:** Burn then deliver legs and re-credit (L632-L714); enforce aggregate returned-token minima at end (L715), so unmet minima atomically undo any tentative partial payout. Cost trackers decrease only on successful LP delivery (L675-L680). Withdrawn event reports net burned shares (L718).

**Block order/invariants:** One virtual-offset asset claim, capped to available weighted NAV, is split into idle and LP weights; liquidity removal is capped to actual liquidity (L620-L627; M L31-L34). Final-holder path bypasses offset dust. Unreadable source with zero removable LP explicitly reverts before burn (L630). Parked quote is paid first; readable source can unstage the remainder (L641-L643). The final idle transfer and whole LP leg have separate self-call/catch boundaries (L654-L683). Nothing delivered restores every share; other shortfalls use high/low LP weights, cap re-credit to requested shares and add it back (L695-L712).

**Dependencies:** S.unstage catches adapter withdrawal reverts and measures actual inbound balance; its own balance reads and transfer to controller remain outside that catch (S L71-L81). EA.withdraw catches the entire read/redeem self-call (EA L126-L157). IA.withdraw caps to balance and uses a low-level transfer; balance read/return decoding are distinct operations (IA L144-L151). LP exit first sweeps fees and then decreases principal; either failure rolls back that entire self-call (PM L727-L729). `_decreaseAndTake` requests zero token minima internally, measures balance deltas and forwards both assets; user minima apply later at PM L715 (PM L1181-L1194).

**Open questions:** How much reserve loss can occur while unreadable versus the fixed haircut; whether external token balance/transfer behaviour can escape intended best-effort boundaries; value fairness when only one leg is delivered; rounding under repeated partial exits and final-holder failures. No global proof of these assumptions is established in this context pass. All price/NFT reads and final `_anchorFollow` are still required operations, so comments saying withdrawals never brick are not treated as an unconditional guarantee.

## `deploy` (PM L775-L927)

**Purpose:** Owner converts idle quote into a two-sided aggregate LP position.

**Inputs & assumptions:** Owner-selected size, swap amount, minimum paired output/liquidity and deadline are trusted policy inputs, with explicit bounds (L780-L789, L838, L862-L863). `_syncIdle` is strict. Best-effort fee sweep occurs before acquiring parked/staged quote; full requested funding is then required (L797-L809).

**Block order:** Reference band bounds starting pool price and swap limits (L811-L833); quote-to-paired swap runs and output minimum is checked (L835-L840). Spot is re-read and checked against the same band before liquidity sizing (L844-L863). Temporary Permit2 authorization precedes mint/increase, then periphery allowance is revoked (L865-L881). Cost trackers grow using measured token outflows and paired valuation at pre-mint spot, subject to two-sided 50% checks (L883-L898; L193). Remaining paired is swapped toward quote; quote restaging is best-effort; strict final idle/cap check and reference update finish transaction (L903-L926).

**Dependencies:** `_executeSwap` sends negative exact-input amount, settles each actual PoolManager delta and returns output only (PM L951-L982). `_permit` casts authorization to uint160 and mint maxima to uint128 (PM L1133-L1136, L873-L876). UPM increase calls core modification and separately derives principal slippage from delta minus accrued fees (UPM L289-L303, L501-L514); it does not promise no fee accrual during increase. Core swap processing can stop at price limit; requested input consumption is not asserted in `_executeSwap`. PoolManager, Permit2 and PositionManager are immutable but externally trusted dependencies.

**Open questions:** Track requested versus actually consumed input when either swap reaches a limit; treatment of any residual paired balance; actual mint net balances when pre-sweep fails; safe numeric domain before casts; economic sufficiency of owner minima and follower band. No enforcement of external oracle accuracy or proof that every swap exhausts specified input was found in this function.

## `harvest` / `_sweepFees` (PM L990-L1010)

**Purpose:** Send accrued fees to the configured recipient independently of principal shares.

**Inputs & effects:** Owner supplies deadline; missing NFT causes harvest to revert. Sweep skips missing/empty position, otherwise requests zero liquidity decrease, measures both received assets, transfers each to current recipient and emits only when nonzero (L999-L1009). No share mint/burn occurs here.

**Dependencies/invariants:** Fee isolation depends on zero-delta Uniswap modification (UPM L336-L349), balance-delta measurement (PM L1181-L1191) and successful recipient transfers. Harvest propagates a sweep failure; LP exit catches it as part of whole LP leg; deploy catches it independently (PM L992, L728, L797). Recipient replacement is owner proposal then owner acceptance after 48 hours, with cancellation/reproposal paths (PM L126-L127, L346-L372).

**Open questions:** Off-chain attribution, paired conversion, buffer credit and compensation after an interrupted pipeline are outside this contract dossier; the transfer event alone does not establish user credit. Behaviour of increase after an unsuccessful sweep needs separate execution tracing.

## `compoundQuote` (PM L1049-L1060)

**Purpose:** Add owner-supplied quote pro rata without minting shares.

**Inputs & effects:** Nonzero owner amount; token pulled, staging approved and attempted. Stage failure clears approval and emits CompoundDeferred, leaving quote parked. A strict `_syncIdle` follows either branch, then Compounded emits (L1050-L1059). No totalShares guard or fee-origin attestation appears in these lines: provenance of supplied funds and desirability of compounding with zero holders are operational assumptions, `nothing found` enforcing them on-chain.

**Dependencies/open questions:** `_idle` counts staged NAV plus PM raw quote only on a successful staged read (L395-L400); therefore deferred staging does not itself imply success if final source NAV read fails (L405-L409). Determine recovery policy for temporary source unreadability, zero-holder compounding and caps already full. No principal-cap admission check exists in this path, by stated accretion design.

## Cross-function invariants and external boundaries

1. Share accounting changes only through deposit mint and withdrawal burn/re-credit in examined money paths (PM L542-L543, L633-L634, L710-L711); fees route separately to recipient. Off-chain distribution must reconcile with this separation.
2. Idle NAV on a successful read includes PM parked quote plus adapter-reported value; staging's own raw balance is not included by stagedAssets (PM L395-L400; S L84-L86). Attribution and token transfer exactness are therefore relevant across all legs.
3. Deposit, deploy and compound require final source readability; withdrawal and display implement different fallback policies (PM L405-L409, L601, L1068-L1072). Cached idle is an observed value, not a source solvency guarantee.
4. Reference moves at most once per block by bounded sqrt-price step (PM L424-L445); entry high reads both buckets without a current-time expiry check (L467-L482). Public poke participates. Time-to-block equivalence and depth/price manipulation cost are operational assumptions.
5. Adapter cap is distinct from PM total principal cap (IA L125, PM L540/L923); EA per-block cap is another liquidity bound and zero means unlimited (EA L173-L190). Admin settings need deployment-specific review.
6. Factory verifies reported asset/binding by staticcall but has a legacy fallback accepting readable totalAssets when asset getter is absent (F L136-L147). It is not an adapter-code attestation. Deployed adapters, upgradeability, issuer freeze controls and external source solvency remain outside source-only guarantees.

## Coverage and next-phase queue

Read PM constructor, administrative controls, pricing helpers, deposit, withdrawal/re-credit, deploy/swaps, fee sweep, compounding and periphery encoders; staging in full; IA/EA supply and withdrawal/binding/value paths; factory creation/binding/deactivation; share formulas; selected called Uniswap modification paths. This compact dossier groups closely coupled functions rather than claiming exhaustive independent per-function proofs.

Not established: actual deployment addresses/configuration, codehash alignment with vendored Uniswap, complete pool/Permit2 internals, live source semantics, frontend/API/DB/keeper accounting, gas-exhaustion behaviours or systematic adversarial tests. These are open scope, not clean bills of health. Hunt only after combining this record with the service and fee-credit context.
