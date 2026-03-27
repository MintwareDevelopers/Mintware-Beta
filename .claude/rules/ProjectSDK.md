# Project SDK — Embeddable Campaign Widget

## Concept

Allow any protocol to embed a live Mintware campaign directly on their own website via SDK.
A project like Jupiter puts this on `jup.ag`:

```html
<script src="mintware.finance/sdk/embed.js"></script>
<mintware-campaign id="jupiter-q2-2026" />
```

A live campaign widget renders on the protocol's official site. Users never leave to participate.

## Why It Matters

**Trust multiplier** — campaign living on `jup.ag` itself is the verification. Mintware shows a
"Verified — embedded on official protocol site" badge that only appears when the widget detects
it's served from the campaign's registered domain. A trust signal no competitor has.

**Distribution flywheel** — every embed is "Powered by Mintware" on a major DeFi protocol's
homepage. Placed where users already are, no paid acquisition needed.

**Anti-phishing** — if the real Jupiter campaign is embedded on `jup.ag`, any fake campaign
on mintware.finance is immediately obvious.

## Build Phases

### Phase 1 — iFrame Embed (3-4 days, ship first)

Minimal new code:
- `GET /api/embed/campaign?id=` — public route, no auth, CORS headers
- `/embed/campaign/[id]` page — no nav, no auth, minimal UI
- Protocol pastes one `<iframe>` tag

Ship fast. Let first 2-3 protocols embed and give feedback.

### Phase 2 — JS Widget SDK (1-2 weeks)

```html
<script src="mintware.finance/sdk/embed.js"></script>
<mintware-campaign id="xxx" theme="dark" />
```

Custom element, fetches campaign data, renders natively in protocol's page styles.
Wallet connect passes through to their existing wallet if present.

### Phase 3 — Domain Verification (1 week)

- Add `verified_domain` field to `campaigns` Supabase table
- Widget checks `window.location.hostname` against `campaign.verified_domain`
- Gold ✓ badge if match, grey badge if not
- Mintware backend logs embed impressions per domain

## Work Breakdown

| Item | Effort |
|---|---|
| `/api/embed/campaign?id=` public route | ~1 day |
| `/embed/campaign/[id]` minimal page | ~1 day |
| CORS config on embed route | 1 hour |
| `verified_domain` column on campaigns table | 30 min migration |
| "Verified embed" badge logic | ~2 hours |
| JS custom element SDK (`embed.js`) | ~1 week |

## Protocol Pitch

> "Put your Mintware campaign on your own site. Participation is 3× higher when users
> don't leave. And every participant sees the campaign was launched by you — not by
> some random link."

## Open Questions

- [ ] Should wallet connect in the embed use the protocol's existing wallet provider or Mintware's?
- [ ] White-label option — hide "Powered by Mintware" branding (premium tier)?
- [ ] Embed analytics dashboard for protocols — impressions, clicks, conversions?
- [ ] Should `verified_domain` be set at campaign creation or separately verified (DNS TXT record)?
