# Round 3 — Equivalence checks (scope-doc §8 Q7 + Q8) + testnet-rig re-verification

**Date:** 2026-09-08 · **Branch:** `audit/round3-exploit-replay` (read-only; no repo file touched except this report) ·
**Mode:** read-only RPC (`eth_getCode` / `eth_getStorageAt` / `eth_call` / `eth_getLogs`), Sourcify public API, Blockscout
public API, local `forge build` of the vendored submodules with their **own** `foundry.toml` (artifacts written to the
session scratchpad via `FOUNDRY_OUT` / `FOUNDRY_CACHE_PATH`; both submodule trees stayed `git status`-clean).

Endpoints that worked from this host: RH testnet `https://rpc.testnet.chain.robinhood.com` (chainId `0xb626` = 46630),
RH mainnet `https://rpc.mainnet.chain.robinhood.com` (`0x1237` = 4663), Ethereum `https://ethereum.publicnode.com`
(code/storage/call — but **rejects `eth_getLogs` from old blocks without a token**), `https://eth.drpc.org` (receipts;
`eth_getLogs` capped at 10k blocks), `https://eth.blockscout.com/api?module=logs&action=getLogs&…` (topic-filtered logs,
no key — this is what made the Ethereum history possible). Dead/limited: `eth.llamarpc.com` (TLS/empty), `rpc.ankr.com`
(key required), `1rpc.io` (50-block log window), `cloudflare-eth.com` (`Internal error` on logs), Etherscan v2 (key
required), RH Blockscout (`explorer.mainnet.chain.robinhood.com` 301/Cloudflare — not needed, RH RPC serves full logs).
`python3 urllib` fails TLS on this machine (no CA bundle) — every request went through `curl -s -X POST`.

---

## Verdicts

| Q | Verdict |
|---|---|
| **Q7 (a)** RH testnet vs RH mainnet | **PoolManager: byte-identical** (same keccak). **PositionManager: equivalent** — the only differing bytes are the two constructor-cached EIP-712 immutables (`chainId` 0xb626→0x1237 and the derived `DOMAIN_SEPARATOR`). **Permit2: equivalent** — same two cached-EIP-712 bytes differ, nothing else. |
| **Q7 (b)** vendored commit vs deployed | **EXACT MATCH.** Compiling the vendored `v4-core` (`d153b048`) and `v4-periphery` (`686f621`) with their own `foundry.toml` reproduces the deployed runtime bytecode **with zero residual bytes** after masking only the compiler-declared `immutableReferences`; even the 12-byte CBOR tails are identical (`bytecode_hash="none"` → `a164736f6c634300081a000a` = solc 0.8.26). |
| **Q7 (c)** which canonical release matches | **Moot** — the vendored commits *are* what is deployed (bit-for-bit compiled code), so there is no action-set / decoder / view drift to analyze. Uniswap's official deployments page lists exactly these RH-mainnet addresses (PoolManager, PositionManager, PositionDescriptor `0x9639…dC06` = the deployed `tokenDescriptor` immutable). **No behavioral difference can affect the gateway.** |
| **Q7 Permit2 canonical** | **Yes.** RH-testnet, RH-mainnet and Ethereum-mainnet Permit2 at `0x…78BA3` are byte-identical apart from the cached `chainId`/`DOMAIN_SEPARATOR`, and each embedded separator **recomputes exactly** from `keccak(abi.encode(EIP712Domain(name,chainId,verifyingContract) typehash, keccak("Permit2"), chainId, 0x…78BA3))`. |
| **Q8 impl equivalence** | **Equivalent code.** RH impl `0x6818…6f8f` and ETH impl `0xFACd…a65F` are the same 18,644-byte runtime; the only differences are (i) the UUPS `__self` immutable (the impl's own address, 5 occurrences) and (ii) the 32-byte IPFS hash inside the 53-byte CBOR metadata. Both are Sourcify-verified `contracts/stablecoins/USDG.sol:USDG` (solc 0.8.28, optimizer 200, paris) and **the 43-file verified source trees are identical** (`diff -rq` clean). |
| **Q8 roles** | **Same operational key set on both chains; same admin *shape* (OZ `TimelockController`, 24h, identical bytecode) but different timelock *instances*; RH has one extra, unverified supply controller.** Details + "what an upgrade could do" below. |
| **Rig** | `robinhood-testnet` rig re-verified — every wiring check passes (table at the end). |

---

## Q7 — Deployed-periphery equivalence

### 7.1 Vendored commits (read with `git -C <submodule> rev-parse HEAD`)

| Submodule | Commit | `git describe` | Date / subject |
|---|---|---|---|
| `contracts-v4/lib/v4-core` | `d153b048868a60c2403a3ef5b2301bb247884d46` | `v4.0.0-19-gd153b048` | 2025-10-23 "Merge PR #989 add-trusted-publishing" |
| `contracts-v4/lib/v4-periphery` | `686f621d9b675fc78bf02781f59ec1ad36921706` | (untagged) | 2026-03-20 "docs: update BaseHook in README (#519)" |
| `v4-periphery/lib/v4-core` (nested, what the periphery compiles against) | `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` | `v4.0.0-12-g59d3ecf5` | 2025-05-13 |
| `v4-periphery/lib/permit2` (nested; **not compiled** by the gateway) | `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` | — | — |

`git -C contracts-v4/lib/v4-core diff --stat 59d3ecf5..d153b048 -- src` is **empty** — the 7 commits between the
nested core and the top-level core are CI/tooling only (Foundry pins, prettier, trusted publishing). So the gateway's
`IPoolManager`/`StateLibrary` and the periphery's are the same source.

### 7.2 Deployed runtime bytecode (a)

```
python3 rpc.py code <rpc> <addr> <out.hex>      # eth_getCode latest → hex file; prints len + cast keccak
```

| Contract | Address | Chain | Length | keccak256(runtime) |
|---|---|---|---|---|
| PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | RH testnet 46630 | 24,009 | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` |
| PoolManager | same | RH mainnet 4663 | 24,009 | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` **(identical)** |
| PositionManager | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` | RH testnet | 23,877 | `0xf3a0edb689229fa4bf135a728f2ec2eb4a2fbee2e41e3e74ffadb7b4c56e8a6d` |
| PositionManager | same | RH mainnet | 23,877 | `0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | RH testnet | 9,152 | `0x0117e0ed818bc3f2a8729ffc336c837e63e965f04b473047b39b35ad86aac259` |
| Permit2 | same | RH mainnet | 9,152 | `0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca` |
| Permit2 | same | Ethereum 1 | 9,152 | `0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131` |

**Cross-chain byte diff** (`python3 bcdiff.py cmp A.hex B.hex` — lists every differing byte range):

| Pair | Differing ranges | What they are |
|---|---|---|
| PositionManager testnet vs mainnet | `[9421:9423]` = `b626`→`1237`; `[9429:9461]` 32 bytes | cached `block.chainid` and cached `DOMAIN_SEPARATOR` (EIP712_v4 immutables). **Nothing else.** |
| Permit2 RH testnet vs RH mainnet | `[6975:6977]` = `b626`→`1237`; `[6983:7015]` 32 bytes | `_CACHED_CHAIN_ID` / `_CACHED_DOMAIN_SEPARATOR`. **Nothing else.** |
| Permit2 RH mainnet vs Ethereum | `[6975:6977]` = `1237`→`0001`; `[6983:7015]` 32 bytes | same two immutables. **Nothing else.** |

Permit2 separator recomputation (`cast keccak $(cast abi-encode "f(bytes32,bytes32,uint256,address)" <typehash> $(cast keccak Permit2) <chainId> 0x…78BA3)`):

| Chain | Embedded / `DOMAIN_SEPARATOR()` | Recomputed | Match |
|---|---|---|---|
| 46630 | `0x385ef69ffea4b42e91eff23e95ef22db58d3ad382de54eedf9bf9ff2ed24173f` | same | ✅ |
| 4663 | `0x448684463b1f7965c1ec7c249cee11520df24c07242efc2b20f6e54c85614fad` | same | ✅ |
| 1 | `0x866a5aba21966af95d6c7ab78eb2b2fc913915c28be3b9aa07cc04ff903e3f28` | same | ✅ |

### 7.3 Vendored compile vs deployed (b)

Compiler settings used (**the submodules' own** `foundry.toml`, not the repo root's `optimizer_runs=200`):

| Contract | Source of settings | solc | via-IR | optimizer runs | evm | `bytecode_hash` |
|---|---|---|---|---|---|---|
| PoolManager | `contracts-v4/lib/v4-core/foundry.toml` | 0.8.26 | yes | 44,444,444 | cancun | none |
| PositionManager | `contracts-v4/lib/v4-periphery/foundry.toml` → `compilation_restrictions` for `src/PositionManager.sol` | 0.8.26 (`0.8.26+commit.8a97fa7a`) | yes | **30,000** | cancun | none |

```bash
export PATH="$HOME/.foundry/bin:$PATH"          # forge 1.8.0 (61ae26a)
S=<scratchpad>
cd contracts-v4/lib/v4-core      && FOUNDRY_OUT=$S/build/v4-core/out      FOUNDRY_CACHE_PATH=$S/build/v4-core/cache      forge build --skip test --skip script --skip "*/test/**"
cd contracts-v4/lib/v4-periphery && FOUNDRY_OUT=$S/build/v4-periphery/out FOUNDRY_CACHE_PATH=$S/build/v4-periphery/cache forge build --skip test --skip script --skip "*/test/**"
python3 bcdiff.py art $S/build/v4-core/out/PoolManager.sol/PoolManager.json           bc/pm.testnet.hex
python3 bcdiff.py art $S/build/v4-periphery/out/PositionManager.sol/PositionManager.json bc/posm.testnet.hex   # and posm.mainnet.hex
```

**Diff method (`bcdiff.py art`):** take `deployedBytecode.object` from the artifact and `deployedBytecode.immutableReferences`
(the compiler's exact `{start,length}` list per immutable AST id); zero those ranges in *both* the artifact and the
on-chain code; strip the CBOR tail (length = last 2 bytes + 2); compare the rest byte-for-byte and report any residual
ranges. Nothing else is masked — no fuzzy matching, no PUSH-normalization.

| Contract | Immutable slots masked | Deployed immutable values (confirmed by `eth_call` on the matching view) | CBOR tail (artifact = deployed) | Residual differing bytes | keccak(masked+stripped) — artifact = deployed |
|---|---|---|---|---|---|
| PoolManager (T = M) | 1 immutable, 1 slot: self-address `0x8366…0951` (`Extsload`/`ImmutableState`-style `address(this)` cache) | — | `a164736f6c634300081a000a` | **0** | `0x30a50a0e9a9ab97e1487d083ae49cab8fe5a49f1bb597f4df1f6435d6b8492f9` |
| PositionManager (testnet) | 8 immutables, 40 slots | `poolManager()`=`0x8366…0951` · `permit2()`=`0x…78BA3` · `tokenDescriptor()`=`0x9639443158E8C5efa35Bd45287bf2EFfd3D8dC06` · `WETH9()`=`0x0bd7d308f8e1639fab988df18a8011f41eacad73` · `unsubscribeGasLimit()`=`300000` · cached chainId `0xb626` · `DOMAIN_SEPARATOR()`=`0xaac1…419f` · `_HASHED_NAME`=`0x7cdd…913e` = `keccak("Uniswap v4 Positions NFT")` ✅ | `a164736f6c634300081a000a` | **0** | `0x497424cae93c181f4e5989f1d290b89068a70445c62e7eeae33ce0cd3219c545` |
| PositionManager (mainnet) | same 8 / 40 | identical except chainId `0x1237`, `DOMAIN_SEPARATOR()`=`0x0619…15dd` | same | **0** | same `0x4974…c545` |

**Conclusion (b):** deployed PoolManager ≡ vendored `v4-core@d153b048` `PoolManager.sol` and deployed PositionManager ≡
vendored `v4-periphery@686f621` `PositionManager.sol`, **compiled code bit-for-bit**. Therefore `Actions`
(`MINT_POSITION`/`INCREASE_LIQUIDITY`/`DECREASE_LIQUIDITY`/`SETTLE_PAIR`/`TAKE_PAIR`), `CalldataDecoder`,
`getPositionLiquidity`, `nextTokenId`, `poolKeys`, and PoolManager `getSlot0`/`extsload`/`initialize`/`modifyLiquidity`/
`swap`/`unlock` are exactly the code the gateway was written and tested against. Re-audit gap #12 ("nobody has diffed
the bytecode") is closed.

### 7.4 (c) — not applicable, plus one observation

Because (b) is an exact match, there is no "which Uniswap release matches" search to do and no per-function source diff.
Confirmed against Uniswap's official [deployments page](https://developers.uniswap.org/deployments): Robinhood Chain
mainnet rows — PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`, PositionManager
`0x58daec3116aae6D93017bAAea7749052E8a04fA7`, PositionDescriptor `0x9639443158E8C5efa35Bd45287bf2EFfd3D8dC06`, V4Quoter
`0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94`, StateView `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b`. The page lists **no
testnet rows** and no release/commit — the testnet's legitimacy rests on this bytecode equivalence, which is stronger.

Observation (not a gateway risk, worth knowing): PoolManager `owner()` differs by chain — testnet `0x9701fb0a…3a52`,
mainnet `0x2bad8182…46cd`; `protocolFeeController()` is `0x0` on testnet and `0x6d0009504d129cf5002dba61d9ae8575aa79314c`
on mainnet. So mainnet **can** have protocol fees set (v4 max 0.1% of LP fee); the gateway's harvest math should tolerate
a non-zero protocol fee (it only receives what the position accrues, so this is a yield-level not a safety-level item).

---

## Q8 — USDG implementation equivalence

### 8.1 Proxies + implementations

| | Ethereum mainnet (1) | Robinhood Chain mainnet (4663) |
|---|---|---|
| Proxy | `0xe343167631d89B6Ffc58B88d6b7fB0228795491D` — 708 B, Sourcify **exact_match** `ERC1967Proxy` (OZ, solc 0.8.9), deployed block 20,915,336 (2024-10-07) by `0x4b39f384422A5F1281E80e54f219d3e13b076aE5` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` — **170 B** minimal ERC-1967 proxy (solc 0.8.29; disassembly = `sload(impl slot) → delegatecall → return/revert`, no admin path, no receive logic), deployed block 57 by `0xBe498aad9c6fd0E4Cd6d1E3fBb395026c5D28215`. Sourcify labels it `ERC1155CollectionProxy` (generic minimal-proxy match; behaviorally just a proxy). |
| EIP-1967 impl slot `0x3608…bbbc` | `0x000…facd5ff359adf87822374275699dd518aaf9a65f` | `0x000…68184c449e1a8f34fa18d289737129fd27b66f8f` |
| EIP-1967 admin slot `0xb531…6103` | `0x0` (UUPS — no ProxyAdmin) | `0x0` (UUPS) |
| Impl runtime | 18,644 B · keccak `0xaf82cbcc5fde32768fd5802ceed9ba54960f941176eb9a79ba2751bd6c41afa8` | 18,644 B · keccak `0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf` |
| Impl Sourcify | **exact_match** (runtime + creation), `contracts/stablecoins/USDG.sol:USDG`, solc `0.8.28+commit.7893614a`, optimizer 200, evm paris; impl deployed block 24,551,115 (2026-02) | **match** (runtime + creation), same FQN/compiler/settings; impl deployed block 56 |
| CBOR tail (53 B) | `…ipfs 6eafb5d58c1ae7d33b0b8cd8069264c5c8cbe407ca5585afb033eac337722013 … solc 0.8.28` | `…ipfs fa818128a3d29c03498befcd6b54cfc3c63dbffb971acd52df893931763117aa … solc 0.8.28` |
| `name()/symbol()/decimals()` | Global Dollar / USDG / 6 | Global Dollar / USDG / 6 |
| `paused()` | false | false |
| `totalSupply()` | `0x142fe6bf4e96d` ≈ 355.6 M | `0x25cd6c78a787a` ≈ 664.9 M |

**Byte diff of the two impls** (`bcdiff.py cmp`): 6 ranges — five 20-byte ranges at offsets 4714/4778/5090/5154/5297
each equal to the impl's *own* address (OZ `UUPSUpgradeable.__self` immutable, used by `onlyProxy`/`notDelegated`), and
one 32-byte range at 18601 inside the metadata tail (the IPFS hash). After zeroing the five `__self` slots and stripping
the 53-byte CBOR tail: **equal**, keccak `0x0b2ef7f804d440e3df4b15d4163c701802bd34558d6e223fa251185218b2f6a6` on both.

**Source diff:** fetched both Sourcify source bundles (`/server/v2/contract/{1|4663}/{impl}?fields=sources,compilation`)
— 43 files each (`contracts/stablecoins/USDG.sol`, `PaxosTokenClaimableRewards.sol`, `SupplyControl.sol`, `lib/*`,
OZ upgradeable 4.x) — `diff -rq` reports **identical trees**. The differing IPFS hash is therefore metadata-only
(e.g. absolute source paths / remappings in the metadata JSON), not code.

**Verdict:** the RH USDG implementation is the *same program* as the Ethereum one at the time of check.

### 8.2 Privileged roles — enumerated from `RoleGranted`/`RoleRevoked` logs

RH: `eth_getLogs` from block 0 on the RH RPC (complete — all grants happened in the deploy tx at block 57; **zero
`RoleRevoked`**, **one `Upgraded`** (creation, → `0x6818…6f8f`), no `RoleAdminChanged`).
Ethereum: creation receipt (drpc) + Blockscout v1 topic-filtered `getLogs` from block 20,915,336. Role hashes resolved
from the verified source (`contracts/lib/Roles.sol` etc.).

**Current holders (verified with `hasRole(role, account)` `eth_call` on both proxies):**

| Role | RH holder | Same address holds it on ETH? |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` (= `_authorizeUpgrade`, = `defaultAdmin()`/`owner()`) | `0xcfa0388f5ddf905fdc08c45c716c15dc10a14c6f` — OZ **TimelockController**, `getMinDelay()`=86,400 s (24 h), self-administered | **No — different instance.** ETH `defaultAdmin()` = `0x9036566eaa5f83e0b9e1161c6c602b0adf997654`, also a TimelockController, 24 h, **byte-identical bytecode** to the RH one (keccak `0xe616a4f6…c554b`). |
| `PAUSE_ROLE` | `0x3af3e85f4f97de7ad0f000b724fb77fe5ffc024b` | ✅ |
| `ASSET_PROTECTION_ROLE` (freeze/seize) | `0x3af3…024b` | ✅ |
| `MULT_ADMIN_ROLE` | `0x3af3…024b` | ✅ |
| `PAYOUT_GROUP_ADMIN_ROLE` | `0x3af3…024b` | ✅ |
| `CLAIM_ADMIN_ROLE` | `0x3af3…024b` | ✅ |
| `MULT_RATE_ROLE` | `0x4e4336d068df68000d6d6ab326feef9ad4faeef8` | ✅ (ETH additionally granted it to `0x3af3…` on 2026-04) |
| `PAYOUT_GROUP_REGISTRAR_ROLE` | `0x55f78e37adb9d1f6931c1da7314b374558ae9684` | ✅ |
| `CLAIM_OPERATOR_ROLE` | `0x5fd949b0fd3a994a6d7e364c82e43be23de22e38` | ✅ |
| `SUPPLY_CONTROLLER_MANAGER_ROLE` | lives on the separate **SupplyControl** contract (`supplyControl()` = RH `0xdf5fff9cb88b3cab50572fae73e2eb08599d25d4` / ETH `0x9a7164112029b81c07636ab7b59fa813e0883bbf`, both UUPS proxies, both `defaultAdmin()` = the respective timelock): holder `0x3af3…024b` on **both** | ✅ |
| `SUPPLY_CONTROLLER_ROLE` (mint/burn) | RH: `0xf845a0a05cbd91ac15c3e59d126de5dfbc2aabb7`, `0x2fb074fa59c9294c71246825c1c9a0c7782d41a4` (EOAs; **both also supply controllers on ETH**) and `0x0d54755f5106bfdb43f7a35f5d49a23f940628d1` (**RH-only**, added block 33,411 by `0x3af3…`; an ERC1967Proxy → unverified impl `0x0e0cdcd065d885a36586a0706bdeab31a5c09150`, `owner()`=`0x3af3…`, `token()`=USDG — presumably Paxos's RH mint/burn agent; **could not verify its source**) | 2 of 3 ✅; third is RH-only |
| `TOKEN_CONTRACT_ROLE` (on SupplyControl) | USDG proxy `0x5fc5…d168` | (by construction) |

**Timelock role holders** (both chains): `PROPOSER_ROLE`, `CANCELLER_ROLE`, `EXECUTOR_ROLE` = **`0x3af3…024b` alone**;
`DEFAULT_ADMIN_ROLE` of each timelock = the timelock itself. `0x3af3…024b` has **no code on either chain** (plain EOA or
off-chain-custodied key — MPC/HSM custody is not observable on-chain).

**Ethereum admin history** (Blockscout v1): `DEFAULT_ADMIN` initial `0x137dcd97872de27a4d3bf36a4643c5e18fa40713`
(`SimpleMultiSig`, Sourcify-verified) → **2025-08-07 transferred to the EOA `0x3af3…024b`** (`DefaultAdminTransferScheduled`
then accepted at block 23,097,747; `defaultAdminDelay()` = 10,800 s = 3 h) → **2026-02-04/05 transferred to the timelock
`0x9036…7654`** (accepted block 24,391,308). Pauser/asset-protection moved from `0x0644bd02…5d33` to `0x3af3…` on the
same 2025-08 date. **ETH `Upgraded` history (6 impls):** `0x568c…07f7` (2024-10-07, creation) → `0xddf9…fea0` (2024-10-31)
→ `0x6db4…9445` (2024-11-14) → `0x2d41…cfc6` (2025-12-19) → `0x8b73…1897` (2026-02-26) → `0xFACd…a65F` (2026-02-28,
current). RH was born (block 56/57) directly on the impl that equals ETH's current one.

**Are they "the same Paxos multisigs as on Ethereum"?** The *operating* key set is identical across chains (`0x3af3…`,
`0x4e43…`, `0x55f7…`, `0x5fd9…`, supply controllers `0xf845…`/`0x2fb0…`). The *upgrade authority* is not a multisig on
either chain today — it is a 24-hour OZ `TimelockController` whose sole proposer *and* executor is the same
`0x3af3…024b` key that also holds pause/freeze/supply-manager. RH and ETH use **separate timelock instances** with
identical code and identical parameters.

### 8.3 What a UUPS upgrade could do, and who can trigger it

- **Path:** `0x3af3…024b` → `timelock.schedule(USDG.upgradeToAndCall(newImpl, data), delay ≥ 24 h)` → after 24 h
  `timelock.execute(...)` (same key) → `USDG._authorizeUpgrade` passes `onlyRole(DEFAULT_ADMIN_ROLE)` because
  `msg.sender` is the timelock. No second party is structurally required; the only guard is **time (24 h)** and the
  fact that `CANCELLER_ROLE` is also that key. Compromise of `0x3af3…` = ability to replace the entire token logic on
  both chains after a 24-hour public notice window. (The default-admin *transfer* itself carries a 3-hour
  `AccessControlDefaultAdminRules` delay on top.)
- **Blast radius for a holder** (including the gateway's staging reserve, the Morpho-shaped adapter, the LP position's
  USDG leg and the buffer): a new implementation can do anything — rewrite balances, disable `transfer`, mint/burn at
  will, redirect `transferFrom` allowances (so Permit2/PositionManager pulls could be made to fail or over-pull), change
  `decimals`, or brick the contract. Storage layout is preserved only by Paxos's discipline (`BaseStorageV3`/gap
  patterns in the verified source).
- **Without an upgrade**, the already-live levers are: `PAUSE_ROLE` (all transfers halt → gateway deposits/withdraws/
  harvest revert while paused; NAV reads still work), `ASSET_PROTECTION_ROLE` (freeze an address and **seize** its
  balance — the PositionManager, PoolManager, staging contract or adapter could each be frozen/wiped as an address),
  and `SUPPLY_CONTROLLER_ROLE` (mint/burn to whitelisted addresses via `SupplyControl` limits). These are standard for a
  regulated fiat-backed stablecoin and identical on Ethereum; they are **issuer risk**, not gateway code risk, and the
  gateway cannot mitigate them on-chain — only disclose them (the `/legal` + risk-copy line "USDG is a third-party
  issuer-controlled asset") and keep exposure curated/capped.
- **Monitoring recommendation (ops, not code):** watch `Upgraded` on `0x5fc5…d168`, `CallScheduled` on the RH timelock
  `0xcfa0…4c6f`, and `RoleGranted/Revoked` on both the token and `SupplyControl`; a scheduled upgrade gives 24 h to
  pause gateway deposits.

---

## Testnet rig re-verification (`config/deployments.json` → `robinhood-testnet`, RPC 46630)

| Check | Result |
|---|---|
| Code present | PM `0x259a9f1cdcf8d2172964d151366b2c7c9ea6f442` 16,331 B · Staging `0x24f69ca370e85e7f18799161bc6b0267d6ac00cc` 2,176 B · Adapter `0xd6866f00684b2ea1219bc6d91caf61dbd591bc94` 3,469 B · Mock 4626 source `0x804ae0d2fa81ab9cafe12b1a60e88bdbe201ac72` 4,141 B · tUSDG `0xd2af3d6e58d0caec184548e465e10fa63968ebfd` 1,731 B |
| `pm.quoteAsset()` | `0xd2af…ebfd` (tUSDG) ✅ |
| `pm.staging()` | `0x24f6…00cc` ✅ |
| `staging.controller()` | `0x259a…f442` = PM ✅ |
| `staging.adapter()` / `staging.deployer()` | adapter `0xd686…bc94` ✅ / `0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c` (gateway seat) |
| `adapter.vault()` | `0x24f6…00cc` = staging ✅ · `adapter.yieldSource()` = `0x804a…ac72` (mock 4626) · `adapter.owner()` = gateway seat |
| `pm.owner()` / `pm.pendingOwner()` | `0x18AE…663c` / `0x0` ✅ |
| `pm.harvestRecipient()` | `0x18AE…663c` ✅ |
| `pm.MAX_DEPLOY_BPS()` | `0x1388` = **5000** ✅ |
| `pm.maxDeviationBps()` | `0x1f4` = **500** ✅ |
| `pm.deployedPrincipal()` | **0** ✅ |
| `pm.paused()` | **false** ✅ |
| `pm.poolManager()` / `pm.positionManager()` | `0x8366…0951` / `0x58da…4fA7` (the canonical pair verified above) ✅ |
| `pm.poolKey()` | currency0 `0x4b60b01014227795b660c105e38993104ec4a629`, currency1 tUSDG, fee `0xbb8`=3000, tickSpacing 60, hooks `0x0` (hookless) ✅ |
| `pm.totalShares()` | `0x1dd4f88b` ≈ 500.6 tUSDG-shares (post-smoke) |
| keccak256(PM runtime) — for `LP_GATEWAY_PM_CODEHASHES` | `0xccb9e854c18d8a34e7bb3f861c6437dde561bec523dde7ab15a03b244e59f004` |

---

## Reproduction artefacts (scratchpad, not committed)

`rpc.py` (curl-backed JSON-RPC: `code|slot|call|<method>`), `bcdiff.py` (`cmp` / `art` / `strip`), `bc/*.hex` (all
fetched runtime code), `build/v4-core/out`, `build/v4-periphery/out` (vendored compiles), `usdg/eth`, `usdg/rh`
(Sourcify source trees), `logs.rh.*.json`, `usdg/eth_bs_*.json` (log dumps).
