# Closeout — profile picture upload + chain-truth leaderboard (O-11)

_2026-09-08 · branch `feat/lp-gateway-audit-closeout` · scope: consolidated audit §3 **O-11** + the two parked product items (true PFP upload; Portfolio/leaderboard read chain truth)._

## What changed

### 1. Profile picture — true file upload (was URL-only)

| File | Change |
|---|---|
| `lib/profile/avatarUpload.ts` **(new)** | Pure, client+server shared: `sniffImageMime` (magic bytes — PNG/JPEG/WebP; SVG/GIF/HTML rejected), `validateAvatarBytes` (≤ 2 MB), `buildProfileAvatarMessage` (canonical JSON, action `mintware-profile-avatar`, binds **wallet + issuedAt + sha256 + size** — one signature per exact file), `avatarObjectPath` (`<wallet>/<uuid>.<ext>`), `avatarPathFromPublicUrl` (only OUR bucket URLs parse, for cleanup). |
| `app/api/(web2)/profile/avatar/route.ts` **(new)** → `POST /api/profile/avatar` | Multipart `file` + `address/authMessage/authSignature/issuedAt`. Early Content-Length 413 · magic-byte sniff (declared type ignored) · ≤ 2 MB · signed-message auth with the **same checks as `createHandler`** (15-min freshness, signed `issuedAt` == body, `action` bound, signer == address) **plus** content binding (signed sha256/size must equal the bytes) · upload via the service client (`upsert:false`, 1-year cache) · writes `wallet_profiles.avatar_type='upload'`, `avatar_ref=<public url>` (creates the row if absent, same posture as `POST /api/profile`) · best-effort removal of the replaced object when it was ours **and** this wallet's · returns `{ success, url, mime, size, path }`. |
| `supabase/migrations/20260908000010_profile_avatars_storage.sql` **(new)** | Bucket `avatars` (public-read, `file_size_limit` 2 MB, `allowed_mime_types` png/jpeg/webp) + `storage.objects` SELECT policy for `public` scoped to the bucket. **No** insert/update/delete policies → writes are service-role only. Wrapped in `DO` blocks that downgrade `insufficient_privilege`/`undefined_table` to a NOTICE (hosted projects may not let the migration role write `storage.*` — see dashboard steps). |
| `components/web2/v1/V1EditProfile.tsx` | File picker (click the avatar or "Upload image") → client pre-checks (size, magic bytes) → local preview → sha256 → sign → **XHR multipart with real upload progress** (bar under the avatar + `Uploading… N%`) → returned URL drops into the URL field so the normal "Save profile" signature re-affirms it; `onSaved()` fires immediately so the header refreshes. States: idle / preparing / signing / uploading / done / error (over-size, wrong type, signature cancelled, server error). URL field kept as the fallback. Dark V1 skin unchanged. |

**Why the route does NOT use `createHandler`:** the factory's request-size guard rejects any body > 256 KB before parsing and its `signed-message` mode reads the body as JSON — both right for every JSON route, both wrong for the one binary upload. The route re-implements the factory's exact auth sequence inline and keeps its response conventions (`X-Request-Id`, BigInt-safe JSON, `{success:false,error,code}`). A comment in the route says to keep it in lockstep with `lib/web2/routeHandler.ts`.

**Gotcha found in testing:** multipart/form-data normalises text-field newlines to CRLF (HTML spec), so the LF-only canonical message arrived as `\r\n` and failed both the equality and signature checks. The route normalises `\r\n → \n` on `authMessage` (lossless — the builder never emits CRLF).

### 2. O-11 — leaderboard from chain (never Σ `entry_nav`)

| File | Change |
|---|---|
| `lib/gateway/leaderboard.ts` **(new)** | Pure math. `rankProviders(holdings)`: per wallet Σ over instances of `positionValueAtomic(shares, totalShares, totalNav)` (the contract's offset-consistent floor, imported from `positionReader.ts`), `pools` = instances with > 0 shares, zero-share wallets dropped, sort desc by value then wallet asc, **competition ranking** on ties (1, 2, 2, 4). `rankProvidersFromDb(rows)`: the old Σ `entry_nav` aggregation, kept ONLY as the explicitly-flagged degraded path. `totalValueAtomic`. |
| `lib/gateway/chainTruth.ts` **(new)** | `readInstanceHoldings({ client, instances:[{poolAddress, positionManager, wallets}] })` → `{ blockNumber, holdings }`. Reads `totalShares` + `totalNav` + `sharesOf(w)` per instance **pinned to one block** (latest at call time). Multicall3 `aggregate3` first (`LP_GATEWAY_MULTICALL3` overrides the address; `off` disables; default canonical `0xcA11…CA11`), chunked per-call fallback if multicall reverts/unsupported. Wallets deduped case-insensitively. **Throws on any failure** so the caller degrades explicitly — never a silently-partial board. |
| `app/api/gateway/leaderboard/route.ts` | `gateway_positions` is now the **address source only** (per pool, capped 500 wallets/pool); active instances from the registry; chain snapshot → `rankProviders`. Response adds `source:'chain'|'db'|'none'`, `degraded`, `degradedReason` (`chain_read_failed` / `gateway_not_configured`), `chainId`, `blockNumber`, `computedAt`, `ageMs`, `stale`, `cacheTtlMs`; provider rows keep `capitalAtomic` (now = on-chain value) and gain `shares`. In-memory cache: **60 s** for a chain board, **15 s** for a degraded one (fast recovery). Referrers board unchanged. Backward-compatible with the current `V1Leaderboard.tsx` (not mine to edit — see hand-offs). |

## Verification

```
bash -c 'npx vitest run lib/profile/avatarUpload.test.ts lib/gateway/leaderboard.test.ts lib/gateway/chainTruth.test.ts "app/api/gateway/leaderboard/route.test.ts" "app/api/(web2)/profile/avatar/route.test.ts"'
# 5 files · 46 tests · all green
```

- `lib/profile/avatarUpload.test.ts` (11) — sniff png/jpeg/webp, reject svg/gif/html/short/RIFF-WAVE; size bounds incl. exactly-max; message canonicalisation + content binding; path build + public-URL parse (foreign bucket / host / traversal rejected).
- `app/api/(web2)/profile/avatar/route.test.ts` (16, mocked storage + profile table, real EIP-191 signatures) — happy path (bucket/path/contentType/upsert:false, row update, URL shape), row-create-if-absent, replaced-object cleanup (ours only; foreign/external never removed), **415 on spoofed content-type**, 413 (bytes) + 413 (early Content-Length), 400 missing file / non-multipart / bad address, **401** wrong signer · swapped bytes (content binding) · expired · cross-action replay · malformed · missing envelope, 502 storage failure leaves the row untouched.
- `lib/gateway/leaderboard.test.ts` (8) — 6dp value math vs `positionValueAtomic`, never overstates NAV, multi-instance sums + pool counts, **zero-share (withdrawn) wallets drop off**, ties share rank + deterministic order, empty pool / empty input, case normalisation, DB fallback ranking.
- `lib/gateway/chainTruth.test.ts` (6) — multicall single round-trip pinned to block, fallback to chunked per-call on revert, env off/custom address, dedupe, hard failure rejects, missing `getBlockNumber` tolerated.
- `app/api/gateway/leaderboard/route.test.ts` (6) — **ranks by chain value while the DB says otherwise** (stale 100-USDG `entry_nav` row ranks nowhere; DB used as address source only), explicit `source:'db', degraded:true` on RPC failure, `gateway_not_configured`, 60 s cache then re-read, 15 s degraded cache, instances with no depositors skipped.

`tsc --noEmit` over all files above + `V1EditProfile.tsx` / `V1WalletCoins.tsx` (scoped config, extends `tsconfig.json`): **0 errors**. (`V1WalletCoins.tsx` is unchanged — nothing in this scope needed it.)

Hard copy lines held: no deposit/savings/guaranteed/APY language added; the leaderboard header/route comments keep "ranks observable activity only — never a trust/credit signal"; the board is labelled Season 0 / testnet / illustrative.

## To apply

1. **Migration:** `supabase/migrations/20260908000010_profile_avatars_storage.sql` (`supabase db push` or paste into the SQL editor). Watch for the two NOTICEs — if either prints, do the dashboard steps.
2. **Dashboard fallback (only if the migration NOTICEd):** Storage → New bucket → name `avatars`, **Public bucket ON**, file size limit `2 MB`, allowed MIME types `image/png, image/jpeg, image/webp` → Create. Then Storage → Policies → `avatars` → New policy → "SELECT" for role `public`/`anon` with `bucket_id = 'avatars'`. Do **not** add insert/update/delete policies (the service role bypasses RLS; nothing else may write).
3. **Env:** none new. `NEXT_PUBLIC_SUPABASE_URL` (already set) is what the route uses to recognise its own object URLs for cleanup. Optional: `LP_GATEWAY_MULTICALL3=<addr>` if Robinhood testnet's Multicall3 isn't at the canonical address, or `off` to force per-call reads (the fallback already handles a revert, this just skips the wasted attempt).
4. Nothing on Vercel/prod was touched. No `.claude/STATE.md` / rules edits were made from this seat (other agents own the context layer this round) — the reconcile list for whoever does: `api.md` gets `POST /api/profile/avatar`; `deployments.md` gets `LP_GATEWAY_MULTICALL3` (optional); `schema.md` gets the storage migration line.

## Hand-offs for other owners

- **Portfolio owner (`V1Portfolio.tsx` / `positions` route):** for chain-truth totals import
  ```ts
  import { readInstanceHoldings } from '@/lib/gateway/chainTruth'
  import { positionValueAtomic } from '@/lib/gateway/positionReader'
  ```
  `readInstanceHoldings({ client: gatewayPublicClient(cfg), instances: [{ poolAddress, positionManager, wallets: [address] }] })` returns `{ blockNumber, holdings }` in ONE pinned block; value per pool = `positionValueAtomic(holdings[i].shares.get(address)!, holdings[i].totalShares, holdings[i].totalNav)`. Use `gateway_positions` only for addresses / cost basis (`entry_nav`) — never for the value. Show `blockNumber` as provenance.
- **`V1Leaderboard.tsx` owner:** the response now carries `source` / `degraded` / `blockNumber` / `ageMs` / `stale`. Suggested: a small pill next to "Season 0 · Testnet" — `on-chain · block N` when `source==='chain'`, and an amber `DB fallback — chain unreadable` when `degraded`. Row shape is backward-compatible (`capitalAtomic` = on-chain value now; `shares` added).
- **Deposit/withdraw route owner:** nothing required — the board no longer depends on withdraws being recorded (that was O-11). Recording them still matters for cost basis / PnL.

## Residuals (honest)

- Old avatar cleanup is best-effort; a failed `remove` leaves an orphan (public, ≤ 2 MB, wallet-scoped path) — a periodic sweep is a follow-up if it ever matters.
- The leaderboard cache is per serverless instance (same as every module-level cache here); different instances may be up to 60 s apart. `blockNumber` in the payload makes that visible.
- Wallets that deposited on-chain **without** a `gateway_positions` row are invisible to the board (DB is the address source). An on-chain `Deposit` event scan would close that; out of scope here.
- `readInstanceHoldings` is not rate-limited beyond the 500 wallets/pool cap + 20-call chunks; fine for testnet volumes.
