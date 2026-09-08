# Web3

## Wagmi Config (`lib/wagmi.ts`)

- Chains: Mainnet, Base, Arbitrum
- Reown (WalletConnect) project ID: `580f461c981a43d53fc25fe59b64306b`
- SSR: true
- `getDefaultConfig` from RainbowKit

## Providers (`components/providers.tsx`)

```
WagmiProvider → QueryClientProvider → RainbowKitProvider (lightTheme, accentColor #0052FF)
```

## Auth Guard (`components/web2/MwAuthGuard.tsx`)

- Wrap auth-required pages: `<MwAuthGuard><PageContent /></MwAuthGuard>`
- Redirects to `/` if `status === 'disconnected'` (uses status string, NOT boolean flags — avoids race condition)
- Shows lavender blank during check
- **Dev bypass:** skips redirect when `NODE_ENV === 'development'`

## Nav (`components/web2/MwNav.tsx`)

- **Logged-out:** "Connect Wallet" button only
- **Logged-in:** Earn → /dashboard, Swap → /swap, Leaderboard → /leaderboard, Agents → /agents, Profile → /profile, wallet pill
- **Wallet pill:** hover reveals red "✕ disconnect" → `disconnect()` + `router.push('/')`
- Agents tab is always shown (no auth gate on nav item)

## Reown Cloud

- `localhost:3000` and `mintware-beta.vercel.app` allowlisted
- Project ID: `580f461c981a43d53fc25fe59b64306b`

## EAS (Ethereum Attestation Service)

Schema UIDs — live on Base mainnet:

| Schema | UID |
|---|---|
| `AttributionScore` | `0xb7f78793ee9f0547c30b77778e66fd2402a40467dabfbc6df472a1587387648d` |
| `SwapActivity` | `0x4ae2ad860f4f96d9eb09180fdddc8e7d06de4336756bd9b65bd2fc986df4b26a` |
| `ReferralLink` | `0x19723450b54493a3c408c7c787c65c2d5c7cee0daf3f3923343e320ef0cf7e22` |
| `CampaignReward` | `0x1b4d67d4932b1da46bc81ca8ffe3745173dfe04b66b39205f726e512809b6209` |

Base uses `encodePacked` not `encode` for schema encoding.

## WalletDisplay

`components/web3/WalletDisplay.tsx` — silent basename resolution in nav, leaderboard, profile. No error state shown.

## 2026-04-02 — Privy trial stays additive to the wallet-native stack

Privy now sits behind `components/web2/providers.tsx` as an optional onboarding/session layer, gated by `NEXT_PUBLIC_PRIVY_APP_ID`. Keep RainbowKit + wagmi as the default EVM execution path, let Privy feed embedded-wallet sessions into wagmi only when enabled, and keep auth/product logic keyed to wallet addresses rather than Privy user ids. `MwAuthGuard` should wait for Privy readiness before redirecting so embedded-wallet sessions do not flash-disconnect on load.

## 2026-04-02 — App code should read wallet state through Mintware identity, not wagmi directly

`lib/web3/useMintwareIdentity.ts` is now the client-side source of truth for active wallet state. It wraps wagmi, Solana wallet-adapter, and the optional Privy session context so pages/components can consume one `address / evmAddress / walletType / isConnected / isAuthenticated` surface without baking provider-specific assumptions into product code. Outside provider internals, new wallet-aware UI should prefer this hook over raw `useAccount()`.
