# Mainnet USDG yield-source survey — Robinhood Chain (4663)

**Date:** 2026-09-08 · **Author:** Claude (research session, read-only) · **Block at time of query:** 57,388,699
(RPC `https://rpc.mainnet.chain.robinhood.com`). **Nothing was written on-chain; no file was edited except this
one.** Triggered by: both known Morpho USDG vaults (`Steakhouse USDG`, `Steakhouse Turbo USDG`) reporting
`maxDeposit(seat) == 0`, and a request to look at T-bill/RWA alternatives.

Companion reading: [`lp-gateway-pool-curation-policy.md`](../../lp-gateway-pool-curation-policy.md) (curation
rules — R6 covers the yield source), [`lp-gateway-mainnet-runbook.md`](../../lp-gateway-mainnet-runbook.md) (§1
item 3, where the cap-full finding was first recorded), [`mainnet-path.md`](mainnet-path.md) (the closeout
record), `scripts/preflight-lp-gateway-mainnet.mjs` (the actual check — read verbatim below).

---

## 0. What the preflight actually checks (confirmed by reading the script, not assuming)

`scripts/preflight-lp-gateway-mainnet.mjs` §3 ("yield source") is **generic ERC-4626, not Morpho-specific**:

```js
const asset = await tryRead(cfg.yieldSource, ERC4626_ABI, 'asset')
expect(asset.ok && asset.value.toLowerCase() === cfg.usdg.toLowerCase(), 'source', 'asset() == USDG', ...)
const ta = await tryRead(cfg.yieldSource, ERC4626_ABI, 'totalAssets')
expect(ta.ok && ta.value > 0n, 'source', 'totalAssets() > 0', ...)
const md = await tryRead(cfg.yieldSource, ERC4626_ABI, 'maxDeposit', [signer])
expect(md.ok && md.value > 0n, 'source', 'maxDeposit(signer) > 0 (supply cap open)', ...)
const sh = await tryRead(cfg.yieldSource, ERC4626_ABI, 'convertToShares', [1_000_000n])
const pr = await tryRead(cfg.yieldSource, ERC4626_ABI, 'previewRedeem', [sh.value])
expect(pr.ok && pr.value > 0n, 'source', 'previewRedeem(...) works [C-10]', ...)
```

Four checks, all against the standard `ERC4626_ABI` (`asset`, `totalAssets`, `maxDeposit`, `convertToShares`,
`previewRedeem` — see lines 70–77). **No Morpho-specific selector, curator check, or brand string appears
anywhere in the script.** Any contract that answers these four calls correctly would pass. The Morpho
restriction is a **policy-layer** rule (curation doc R6), not a code-layer one — the adapter constructor only
enforces `asset() == USDG` (`AssetMismatch`), nothing about the source's origin.

---

## 1. Morpho vault enumeration on chain 4663

### 1.1 Finding the real factory (docs.morpho.org's published address was wrong for this chain)

`docs.morpho.org/get-started/resources/addresses/` lists, for "Robinhood Chain": `Morpho` core
`0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`, `Adaptive Curve Irm` `0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1`,
`ChainlinkOracleV2 Factory` `0xB7c16F6F8cF531447Bf27Ca7220f981E79C9cdF2` — **all three confirmed to have code**
on 4663 via `cast code`. A separate WebFetch pass of the same page also returned a `VaultV2Factory`
(`0x07Fc3E2cdbbE9b0d55F33Db21F45eEf78E7f3472`) and `MorphoRegistry` (`0xDCaf4a43b0999342E5C0f7f67cda4eCb39c5eF97`)
"for Robinhood Chain" — **both come back `0x` (no code) on 4663**, and a second, more careful re-fetch of the
same doc page found no Robinhood row in the Vault V2 table at all. **Conclusion: those two addresses were
table-bleed from another chain's row in the scrape, not real for 4663 — treat any single-pass page-scrape of a
multi-chain address table with suspicion; re-verify with `cast code` before trusting it.**

The canonical cross-chain MetaMorpho v1.1 factory addresses (Ethereum `0x1897a89972...35c24`, Base
`0xFf62A7c2...5918`) also have **no code** on 4663 — Robinhood Chain does not inherit Morpho's usual
CREATE2-uniform factory addresses; it has its own, chain-specific deployment.

**Both known vaults (`0xBeEff033...5409dd`, `0xbeefff13...73a4fd`) revert on `MORPHO()`, `guardian()`, `fee()`,
`DECIMALS_OFFSET()`** (classic MetaMorpho v1/v1.1 getters) but answer `curator()`, `owner()`,
`adapterRegistry()` (`0xe785a2eFD384BA7B95BaEd3851BC76aeD67C676f`) — **these are Morpho Vault V2 (`vault-v2`),
not MetaMorpho v1.1**, despite both docs and the runbook calling them "Morpho vaults" generically. This matters
for R6's specific rationale (previewRedeem-never-reverts) — see §4.

The real factory was found by searching **event logs with no address filter** — `CreateVaultV2(address indexed
owner, address indexed asset, bytes32 salt, address indexed newVaultV2)`, topic0
`0x341ce009267aa0d78cc12b34155e223904a51ed49d144beb6eb8be87813edb4e`, filtered by topic3 = the known Steakhouse
USDG address:

```bash
cast logs --rpc-url https://rpc.mainnet.chain.robinhood.com --from-block 0 --to-block latest \
  0x341ce009267aa0d78cc12b34155e223904a51ed49d144beb6eb8be87813edb4e '' '' \
  0x000000000000000000000000BeEff033F34C046626B8D0A041844C5d1A5409dd
```

→ one hit: `address: 0x0FBad98595b0186dA120E41f77C102beb49f803c` at **block 22,721** (very early — consistent
with the July 1 2026 mainnet launch). **`0x0FBad98595b0186dA120E41f77C102beb49f803c` is the real
`VaultV2Factory` on Robinhood Chain mainnet** (46,251 bytes of code; not in any Morpho doc page found). The
official on-chain `MorphoRegistry` has no code on this chain, which plausibly explains why Morpho's own indexer
doesn't have these vaults (§1.3) — there's nothing on-chain to register them against yet.

### 1.2 Every USDG Vault V2 on chain 4663 (39 found, exhaustive by event log — not a sample)

```bash
cast logs --rpc-url https://rpc.mainnet.chain.robinhood.com --from-block 0 --to-block latest \
  0x341ce009267aa0d78cc12b34155e223904a51ed49d144beb6eb8be87813edb4e '' \
  0x0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d168
```

(topic2 = `asset`, filtered to the Paxos USDG address — `''` in topic1 leaves owner unfiltered, no address
filter on the log at all so it catches every factory, not just the one found above; in practice all 39 came
from `0x0FBad9...803c`.) This is **every** `CreateVaultV2` event for a USDG-asset vault ever emitted on this
chain through block 57,388,699 — not a sample, not the app.morpho.org listing (which showed only 1).

Each row below: `asset()==USDG` (guaranteed by the topic filter), `maxDeposit(seat)` where seat =
`0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c` (the gateway's Privy oracle signer per the runbook), read live via
`cast call <vault> "maxDeposit(address)(uint256)" <seat> --rpc-url ...` on 2026-09-08.

| Address | Name / symbol | Curator | totalAssets (atomic, 6dp) | maxDeposit(seat) | Status |
|---|---|---|---|---|---|
| `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` | Steakhouse USDG / steakUSDG | `0x9023...D2Fb` (Steakhouse) | 455,151,740,041,398 (≈455M) | **0** | Real, curated, capacity **CLOSED** |
| `0xbeefff136e3684273e6aa75a1669b784b373a4fd` | Steakhouse Turbo USDG / bbqUSDGturbo | `0x9023...D2Fb` (Steakhouse) | 8,076,542,327,898 (≈8.1M) | **0** | Real, curated, capacity **CLOSED** |
| `0xbeeff0db1d6c020e525c09af1a4e6fba94190c2f` | RHNC x Steakhouse USDG / rhncUSDG | `0xfeed46c1...C9a` | 0 | **0** | Real curator, empty/unlaunched |
| `0xbeeff039907422219fb367e525954ddc092854d9` | Grove x Steakhouse USDG / groveUSDG | `0x9023...D2Fb` (Steakhouse) | 101,717,835,816 (≈102k) | **0** | Real, curated, capacity **CLOSED** |
| `0xbeeff0fb1dc19344a87b8479dab60a2e16160737` | Ethena x Steakhouse USDG / ethenaUSDG | `0x9023...D2Fb` (Steakhouse) | 23,541,831,266,029 (≈23.5M) | **0** | Real, curated, capacity **CLOSED** |
| `0xb97a135c344862bbacbb585a3b0db051698cf905` | Ethena USDG Turbo / ethenaUSDGturbo | `0x9023...D2Fb` (Steakhouse) | 988,563 | **0** | Real, curated, tiny, capacity **CLOSED** |
| `0x2007b597b730546eb885ad7b589bee2f5dc07052` | Ethena USDG Turbo / ethenaUSDGturbo (dup name) | `0x9023...D2Fb` (Steakhouse) | 2,985,503 | **0** | Real, curated, tiny, capacity **CLOSED** |
| `0xcf14caf9d30d7abf8738ea8fceec27ed0506d6c3` | RH Test 2 / RT2 | `0x1FfD14...15B` | 0 | 0 | Test vault |
| `0x1b8e79ff8e9f3cde068223bc3fb0098c376618e6` | Robinhood Test 3 / RT3 | **none set (0x0)** | 0 | 0 | Test vault, unconfigured |
| `0xd4758a91443d321787db1a147bf9daf8a9e9f81f` | Robinhood Test 4 / RT 4 | `0x1FfD14...15B` | 0 | 0 | Test vault |
| `0xa2e7f2fa795cd6fddbf913848a5d642e0434035f` | test1 / test1 | `0xaA5CBC...217c9` | 0 | 0 | Test vault |
| `0xd71aed1f34383e4bef0cd37281a8425a8b4cfa05` | Robinhood Test 5 / RH 5 | `0x1FfD14...15B` | 1,000,000 (≈$1) | 0 | Test/dust |
| `0x1439b925fc414c404d6d7d70b48ef0a15d00fc7a` | USDG Test Vault / UTV | `0x7d788C...2DdE` | 1,000,000 (≈$1) | 0 | Test/dust |
| `0x37788ff0c1d4e45a7fe06bc7e71e0cc00121d0a8` | Purinta USDG / PurintaUSDG | `0x370EC5...134c` | 50,253,753,077 (≈50k) | 0 | Unknown curator, permissionless |
| `0x1950ba61f8d523fe75fa32b2a71150b7cfd6f160` | RHVault / HOODV2 | `0x19Bf7e...6ca7` | 1,000,000 (≈$1) | 0 | Test/dust |
| `0xdf06045abae69d6e73a7f0197fed917032d22194` | hoodbet.fun / hoodbet | `0x5FF989...117` | 230,451,131 (≈$230) | 0 | **Gambling site, not a yield product** |
| `0x75999324313103e54540dc040050fc823e0ef4ef` | Feather ETF Vault / fETF | `0x511304...82CC` | 0 | 0 | Unknown/empty |
| `0xd8722375c8f54c3730212cda3cdd8eee722e3ee4` | RH Yield Vault USDG / rhUSDG | `0x5dF771...658Ae3a` | 1,000,000 (≈$1) | 0 | Dust |
| `0x5c8cd8026f29f446f8b268990a8ac48085ba5327` | testusdg / grwaUSDG | `0xD742FF...4fb3` | 1,000,000 (≈$1) | 0 | Test/dust |
| `0x6e9ab95ce03040350d3035c30447e89e9bf909c9` | TestVaultUSDG / TestUSDG | `0x381672...056` | 1,000,000 (≈$1) | 0 | Test/dust |
| `0x47ee7d30dd5ef6d5719b9ec14cb08fd8e61582ae` | *(empty name/symbol)* | **none set (0x0)** | 0 | 0 | Unconfigured shell |
| `0x30b77ea564ebfe425fbcb20bffefe604394940cd` | Predifi USDG V1 / pUSDG | `0xA7CeAe...aC30c` | 1,000,000 (≈$1) | 0 | Dust |
| `0x5fe15021a7c0ff4a9965b400e474f616451ba128` | Sharewoods RWA USDG / swRWAUSDG | `0x374ba8...1DB54` | 1,006,510 | 0 | Dust |
| `0xf8f8654a26bfe134ee290d0b6a749ba45f03a104` | Sharewoods Classic USDG / swCUSDG | `0x374ba8...1DB54` | 1,005,125 | 0 | Dust |
| `0x8046118a5b0d1bcbcbd4d5f2c9aa9eecc5bf771d` | EARN / EARNVAULT | `0x75741D...059D` | 144,040,224 (≈$144) | 0 | Unknown curator, small |
| `0xa62622357e7b82bad30ba92e7912bf4f45d369ca` | RAVE USDG Equity Credit / rvUSDG | `0xf5e8c8...0FeB5` | 0 | 0 | Empty |
| `0x3c8ab25826fbba1389b6d4e00b6c6d167b95d119` | T3tris - USDG / T3TIS-USDG | `0x9999BC...9B35` | 1,032,772 | 0 | Dust |
| `0x3537a4d0d3c3b581945c203a7182e6351098a1ba` | Raven USDG / rUSDG | `0xf5e8c8...0FeB5` | 100,000,000 (≈$100) | 0 | Small |
| `0x767c349caf97c1d269d78fd41f85d5bb9d9724cf` | Castle of Katies: Morpho Vault / katsUSD | `0x25Ea0a...5E1e` | 0 | 0 | Empty |
| `0x026df18fbd2a7639089d0a16293383ec687a5ca1` | *(empty)* | `0xe60045...4Bb` | 65,135,635,898 (≈65k) | 0 | Unknown curator |
| `0x65dc90cd3a0bcde967c8ae6019d6790b616e78f7` | *(empty)* | `0xe60045...4Bb` | 63,956,208,022 (≈64k) | 0 | Unknown curator |
| `0x2667f32eea12ea1e55fcd22708037c079cac4139` | oklewr / qwrmtle | `0xC9104F...D543` | 0 | 0 | Junk name, empty |
| `0x51043c2f2155ab547f9497eaf655ec6ccc54e59f` | rtyhj / ghjkn | `0xC9104F...D543` | 0 | 0 | Junk name, empty |
| `0x8c0432175fa40e84a52e9b9828303ab68bb5e613` | rgtrw / gfsg | `0xC9104F...D543` | 0 | 0 | Junk name, empty |
| `0x70189d5ed17d1d5807f4ca424224e1d1e6968f50` | TestRobin / dnTestRobin | `0xC9104F...D543` | 0 | 0 | Junk name, empty |
| `0x19d55f7fe2d3962796f5825cbdae2dd493be0986` | MonkeyHood USDG / lbmonkUSDG | `0x1bf704...93770` | 1,225,750,385 (≈$1.2k) | 0 | Small |
| `0x338b2f252dae1deb00afb700128e592a19f8918c` | Denar USDG / dnUSDG2 | `0xdCB002...c6F` | 38,697,943 (≈$39) | 0 | Small |
| `0x002e0d4d1c23c4e5186b782a058567f21828c705` | Stable USDG / stableUSDG | `0xcF1454...6377` | 332,141,485 (≈$332) | 0 | Small |
| `0xcbb61788fb5a1969c93a222b1a12e4d1a50c6d99` | Solon USDG Vault / solUSDG | `0xD0340F...cC84` | 101,250,000 (≈$101) | 0 | Small |

**Every single one of the 39 shows `maxDeposit == 0` for the gateway seat.** This was re-checked against
`address(0)`, `0x...dEaD`, the vault's own curator, and the vault's own owner for `Steakhouse USDG` specifically
— **0 for every address, not signer-specific** (rules out a per-address gate; `receiveAssetsGate()` is
`0x0000...0000` — unset — on Steakhouse USDG, confirming there's no address-specific allow/deny list in play).
`previewRedeem` was independently re-confirmed non-reverting on both Steakhouse vaults (`convertToShares(1
USDG)` → `previewRedeem(shares)` returns a sane 6dp value on both).

Recent on-chain activity shows Steakhouse's curator (`0x9023...D2Fb`) actively raising **per-market allocation
caps** on both vaults as recently as block 51,877,225 (`IncreaseAbsoluteCap` events, encoding specific
collateral/market ids) — so curation is live and active, not abandoned. Whether that activity extends to
raising the vault's own top-level deposit cap (the thing `maxDeposit` gates) could not be confirmed from the
event data alone in the time available; what's confirmed is that **as of this exact query, it hasn't**.

**Read on the 37 non-Steakhouse vaults:** these were created permissionlessly (anyone can call
`createVaultV2`) by unrelated EOAs — dust test vaults, placeholder/junk names ("rtyhj", "oklewr"), and at least
one that is explicitly **not a yield product** (`hoodbet.fun`, a gambling site squatting on the
`CreateVaultV2` mechanism to get an ERC-4626 wrapper). None carry a recognizable curator identity and none
would pass the curation policy's human-review bar (§5) even if their `maxDeposit` were open. **They are listed
here for completeness of the enumeration, not as candidates.**

### 1.3 On-chain-vs-API discrepancy (the fallback the task asked for)

Morpho's GraphQL API (`blue-api.morpho.org`) **does register "Robinhood Chain" as chain id 4663** (`{ chains {
id network } }` → `{"id":4663,"network":"Robinhood Chain"}`), but:

- `vaults(where: { chainId_in: [4663] })` → `{"items":[]}` (confirmed the filter mechanism itself works — the
  same query against `chainId_in: [8453]` returns real Base vaults).
- `vaultByAddress(address: "0xBeEff033...", chainId: 4663)` → `{"errors":[{"message":"No results matching given
  parameters","status":"NOT_FOUND"}]}` for **both** known Steakhouse vaults, queried directly by address —
  not a `listed`/whitelist filtering artifact, a genuine "doesn't exist in our index" response.
- A 1000-row unfiltered `vaults` dump (sorted by address) contained chain ids `1, 10, 56(?), 137, 480, 999,
  8453, 42161` etc. but **zero** rows with `chain.id == 4663`.

**Conclusion: the on-chain factory and all 39 vaults are real and exist; Morpho's own API does not index this
chain's vaults at all yet** (plausibly because the on-chain `MorphoRegistry` — the contract the indexer likely
watches — has no code on 4663; see §1.1). This is the "factory exists on-chain, API doesn't index it" case, not
the reverse. Do not trust `app.morpho.org`'s "Available Liquidity" figure ($53.23M shown for Steakhouse USDG in
that UI) as a stand-in for `maxDeposit` — that figure is unborrowed *withdrawal* liquidity, a different
quantity from the deposit-side supply cap the gateway actually needs open.

---

## 2. T-bill / RWA candidates — web research (honest about what search alone can confirm)

| Protocol / product | Confirmed on Robinhood Chain (4663)? | USDG-denominated? | ERC-4626? | Deposit gate | Verified on-chain |
|---|---|---|---|---|---|
| Ondo Finance — USDY / OUSG | **Not found.** USDY circulates on ~8 other chains; OUSG is Solana/Ethereum. No RH-chain mention in any source found. | No (USDC/other) | USDY: no (rebasing token, not 4626). OUSG: fund-share token, KYC-gated, not a public 4626. | OUSG: $100k min, qualified purchasers only (KYC) | **No** — not attempted, no address found to probe |
| Superstate — USTB / USCC | **Not found on RH chain** — issued natively on Ethereum. Superstate + Robinhood co-authored ERC-8056 (on-chain corporate actions standard) — a working relationship exists, but that's a standards collaboration, not a deployed vault. | No | Unclear/unconfirmed — Superstate's fund tokens are typically a bespoke transfer-restricted token, not a bare 4626 | Accredited/qualified-purchaser gating (fund entry, not a smart-contract permission) | **No** |
| Backed Finance — bIB01 / bIBTA / bCSPX | **Not found on RH chain** — issuance seen on Gnosis Chain (market-maker minted, CowSwap-distributed) | No | Backed's tokens are typically ERC-20 wrappers, not 4626 | Unclear from search | **No** |
| Matrixdock — STBT | **Not found on RH chain** — listed on InvestaX; Chainlink CCIP/PoR integration announced, no RH-chain mention | No | Not a standard 4626 (own STBT-contracts repo, custom transfer/whitelist logic) | KYC/whitelist (`STBT-contracts` repo implies allowlisted transfers) | **No** |
| Franklin Templeton — BENJI | **Not found on RH chain.** Confirmed live on 8 chains (Stellar, Ethereum, Arbitrum, Solana, Avalanche, BNB Chain, Base, Polygon) as of the search results — Robinhood Chain is not among them. | No | BENJI shares are a proprietary fund-record token, not 4626 | Regulated fund entry (not purely permissionless) | **No** |
| Circle / "Spiko" | **No such product found** — search returned nothing under this name; likely a misremembered/conflated product name. Circle's own USDC reserve yield is not distributed as an on-chain vault to third parties. | n/a | n/a | n/a | **No** |
| Robinhood's own "Earn" (7% APY, USDG) | **Yes — this is exactly the Morpho Vault V2 stack in §1.** Morpho's own blog: *"Robinhood Chooses Morpho to Power New Earn Product."* | Yes | Yes (Vault V2, §1) | Open (permissionless deposit at the contract level — subject to the vault's own `maxDeposit`) | **Yes — this is what's already enumerated above** |
| PAIR (RWA launchpad, per a 2026-08-31 press release) | Yes, PAIR itself is real and live on RH chain | Unclear | Unclear — described as pairing new tokens with baskets of *tokenized stocks*, not a yield/lending product | n/a | Not probed — **out of scope**: it's a token-launch/liquidity-pairing product for equities, not a USDG yield source |

**Bottom line for §2/§3: no T-bill/RWA money-market protocol (Ondo, Superstate, Backed, Matrixdock, BENJI, or
any Circle-branded fund) was found deployed on Robinhood Chain by web search, and none had a specific contract
address to go probe with `cast` — so none were tested on-chain.** This is a negative result from search, not a
certainty; a protocol could deploy tomorrow without yet being indexed by search engines. Robinhood's own
public yield narrative for this chain (Robinhood Earn, ~7% APY) **is** Morpho — there is currently no
second yield rail on this chain at all, T-bill-flavored or otherwise. Every ERC-4626-over-USDG contract that
exists on 4663 today is one of the 39 rows in §1.2.

---

## 3. Policy question — is "Morpho only" a considered rule or just what was known?

The curation policy's exact text (`lp-gateway-pool-curation-policy.md` R6):

> **R6 | Yield source is a real ERC-4626 over USDG with open capacity**: `asset()==USDG`, `totalAssets()>0`,
> `maxDeposit(adapter)>0`, `previewRedeem` does not revert. **Morpho vaults only (their previews don't
> revert).** A full supply cap (`maxDeposit==0`) makes `deposit`, `compoundQuote` and the `deploy` re-stage
> revert — DOA, no loss, but ineligible until capacity opens.

And the exclusion-list rationale (§6, row "C-10 / RT-5f"):

> **C-10 / RT-5f** — a 4626 source whose `previewRedeem` reverts | Every NAV read bricks (`totalAssets` is in
> the deposit *and* withdraw path). | **Morpho vault previews are total functions; an arbitrary 4626 is not.
> Source = Morpho only.**

**Read: this is a considered rule, but narrowly considered.** The stated justification is specifically about
one property — `previewRedeem`/`totalAssets` being *total functions* (never revert, by Morpho's own design
choice) — not a broader endorsement of Morpho's isolated-market risk model, its curator-trust assumptions, or
its economic security. The rule brands the property "Morpho," but §0 above shows the code-level preflight
check is generic ERC-4626, and my own probing in §1.1 found the two "known Morpho vaults" are actually Vault
V2 (a materially different, more modular architecture than the MetaMorpho v1/v1.1 the rest of the policy
document's language evokes) — so even "Morpho" isn't one fixed interface here. The rule is doing real work
(closing a specific revert-DoS class, C-10), but it is pinned to a brand name rather than to the underlying
property, and it hasn't been tested against a non-Morpho 4626 because — per §2 — **none exist on this chain to
test against.** So it is simultaneously: a real, cited, closes-a-real-finding rule (not just "only option
found" laziness) — *and* current practical fact (Morpho genuinely is the only game on this chain) rather than
a deliberately-chosen restriction that was tested against alternatives and rejected them.

**Recommendation (not authorized to edit the policy file):**

1. **Keep "Morpho only" as the operative rule today** — there is nothing else to widen to (§2), so changing
   the rule right now would be a paper change with zero practical effect, and would remove a guardrail for no
   gain.
2. **When a future candidate appears**, don't widen the rule to "any ERC-4626 passing preflight" outright —
   the preflight's four checks (§0) are necessary but the real gate Morpho happens to satisfy
   (`previewRedeem`/`totalAssets` provably total, never revert under any state) is an *architectural*
   property, not something the generic preflight actually proves (it only proves the call didn't revert
   *right now*, once, for one specific share amount — it can't prove non-reversion under all future states).
   Recommend reframing R6 in two parts: (a) keep the mechanical preflight checks as the floor for anyone, and
   (b) add an explicit **human review step**, mirroring the paired-token two-person sign-off in §5, that
   requires reading the *candidate source's own contract* (or its audited spec) to confirm `previewRedeem`
   really is a total function by construction — not just "it didn't revert when I called it once." That
   converts "Morpho only" from a brand allowlist into "any source that clears the same bar Morpho clears,"
   without weakening R6's actual protection.
3. **Separately track that "Morpho" here silently means Vault V2**, an architecture the rest of
   `lp-gateway-pool-curation-policy.md` and the runbook describe in MetaMorpho-v1-flavored language
   (`curator`, no mention of `adapterRegistry`/`vic`/gates). Worth a follow-up doc note (not this file) so a
   future reader isn't surprised that "MORPHO()" and "guardian()" revert on the very vaults the runbook calls
   "the Morpho vault."

---

## 4. Bottom line

**No.** There is currently **no ERC-4626-over-USDG source on Robinhood Chain mainnet with open deposit
capacity for the gateway** — not the 2 previously-known Steakhouse vaults, and not any of the other 37 USDG
Vault V2 instances discovered by exhaustively walking `CreateVaultV2` events from block 0 to the current head
(57,388,699). Every one of the 39 returns `maxDeposit == 0` for every address tested, right now
(2026-09-08). No T-bill/RWA protocol (Ondo, Superstate, Backed, Matrixdock, BENJI, or any Circle-branded fund)
was found deployed on this chain at all, so there is no alternative interface to fall back to either — Morpho
Vault V2 is not just the *preferred* yield rail on this chain, it is currently the *only* one that exists.
The gateway's staging adapter has nowhere to deploy idle USDG into today; the only levers are (a) wait for
Steakhouse's curator to raise a vault-level deposit cap (recent on-chain activity shows they're actively
managing per-market allocation caps, so they are not dormant — just not yet reopening top-level deposits), or
(b) watch for a new, curated USDG Vault V2 instance to appear via the same factory
(`0x0FBad98595b0186dA120E41f77C102beb49f803c`) with `maxDeposit > 0` and a real (non-anonymous) curator behind
it.
