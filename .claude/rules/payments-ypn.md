# Earn and card refill

> **Status:** testnet-only and unaudited. External audit gates real value. Arc/CCTP, Lithic, and spend-in-place
> settlement are retired and are not current payment mechanics.

## Earn vault

`MintwareYieldVault` (`contracts-v4/src/payments/MintwareYieldVault.sol`) is an ERC-4626 `mwEARN` share vault over
one `IYieldAdapter`. A pause blocks deposits and mints; withdrawals and redemptions remain callable. If the source
is illiquid, redemption pays the obtainable assets and burns only shares attributable to what was received;
unpaid shares remain with the holder. The exiting holder bears the source's exit cost through the vault's
accounting. Do not describe this as guaranteed yield or fixed APY.

## Refill gateway

`MintwarePaymentGateway` (`contracts-v4/src/payments/MintwarePaymentGateway.sol`) only refills a card buffer. A
relayer calls `refill(refillId, member, shares)` to redeem the member's Earn shares to that member's registered
buffer wallet. The member proposes a destination, waits 48 hours, then accepts; a registered destination can be
revoked at any time. Refills use per-member and global UTC-day caps; cap increases are timelocked. This contract
has no `settleSpend`, no spend-from-NAV path, and no merchant-settlement function.

Cards use Bridge + Stripe and are pre-enable. They are not a live spend rail. Do not describe purchase settlement
as coming from Earn shares or vault NAV.

## Retired payment designs

Arc/CCTP, Lithic, YPN spend-in-place, campaigns, and Treasury senior/junior issuance are retired or parked. Their
contracts, addresses, tests, and dated reports may remain in the repository as historical records; none describes
the current card-refill path.

## Pointers

- Contract map: [`smart-contracts.md`](smart-contracts.md)
- Environment and cron configuration: [`deployments.md`](deployments.md)
- Current status: [`../STATE.md`](../STATE.md)
