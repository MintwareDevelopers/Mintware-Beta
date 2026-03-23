# Your Identity

Mintware resolves human-readable names for wallet addresses wherever they appear — in the nav, on the leaderboard, and on your profile.

---

## Basenames

[Basenames](https://base.org/names) are on-chain names registered on Base (e.g. `alice.base.eth`). If your connected wallet has a Basename registered, Mintware displays it in place of your truncated address.

Basenames are resolved silently in the background — no action is needed on your part.

---

## ENS

Standard Ethereum Name Service names (e.g. `alice.eth`) are also resolved and displayed where a Basename is not present.

---

## Resolution Priority

1. **Basename** — checked first (Base-native)
2. **ENS** — checked if no Basename is found
3. **Truncated address** — shown if no name resolves (e.g. `0x1234…abcd`)

---

## Where Names Appear

- **Nav wallet pill** — shows your name once connected
- **Leaderboard** — participant names displayed in rankings
- **Profile page** — shown at the top of your profile card
- **Referral links** — your ref link uses a code derived from your address, not your name

---

## Referral Codes

Your referral code is generated deterministically from your wallet address — it does not depend on your Basename or ENS. Even if you change your on-chain name, your referral code stays the same.
