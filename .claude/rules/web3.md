# Web3 — Wallet Layer, Wagmi, EAS, Auth Guard

> **Privy is the single wallet layer. RainbowKit was removed (PR #175).** Do not reintroduce
> RainbowKit / `ConnectButton` / `useConnectModal`. The npm package may still sit unused in
> `package.json`; that's not an invitation to use it.

## Wallet stack

- **Privy** for auth + embedded/external wallets, composed with **wagmi** via `@privy-io/wagmi`
  (`createConfig`, **not** RainbowKit's `getDefaultConfig`). Provider tree in
  `components/web2/providers.tsx`; wagmi config in `lib/web3/wagmi.ts`.
- Identity is read through `useMintwareIdentity()` (`lib/web3/useMintwareIdentity.ts`) — the EVM
  address + connection/disconnect, unifying Privy session + external wallet. Prefer it over raw
  `useAccount` in app UI.
- Mainnet RPC = `ethereum-rpc.publicnode.com` (CORS-open; fixes ENS/basename reads). Don't
  revert to `eth.merkle.io` (CORS-blocked in browser).
- **Embedded-wallet gotcha (PR #172):** Privy `createOnLogin` must be `'off'`; wallets are created
  headless via `useCreateWallet()` in the session bridge. Never re-enable auto-create on this
  version — it throws a whole-app client exception after email login.

## Auth guard

- `components/web2/MwAuthGuard.tsx` gates authenticated app pages. Dev bypass:
  skips the redirect when `NODE_ENV === 'development'`.
- Note the **soft-gate** direction: the User/Team split is showcase-friendly (no hard sign-in yet);
  hard gating (Privy RBAC + middleware) is Phase 2. See `.claude/STATE.md`.

## EAS

- Offchain score/attestation helpers in `lib/eas.ts`; attest route `/api/eas/attest-score`.
- `NEXT_PUBLIC_EAS_CHAIN_ID` selects the EAS chain (see the generated env-flag list in
  `.claude/STATE.md`).

## Contract addresses / chains

Contract addresses (AIAttribution v3, vault stack) live in their one home,
[`smart-contracts.md`](smart-contracts.md) — not duplicated here.
