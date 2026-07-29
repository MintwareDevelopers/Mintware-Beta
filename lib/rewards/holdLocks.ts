// =============================================================================
// RWA Incentive Layer · R5 — reading the vault's per-wallet lock (money-path).
//
// MintwareBaseVault4626 exposes `mapping(address => LockInfo) public locks`, where
//   struct LockInfo { uint256 depositedAt; uint256 lockedUntil; LockTier tier; bool initialized }
// so the generated getter returns FOUR ordered values: (depositedAt, lockedUntil, tier, initialized).
//
// This module exists so the field ORDER is declared once and unit-tested: a prior bug
// declared only 2 outputs and read lockedUntil from slot 0 (actually depositedAt, always
// in the past) → lockDays pinned at 0 → the duration-match bonus never fired.
// =============================================================================

import { parseAbi } from 'viem'

export const LOCK_ABI = parseAbi([
  'function locks(address) view returns (uint256 depositedAt, uint256 lockedUntil, uint8 tier, bool initialized)',
])

/** Decoded `locks(address)` tuple: [depositedAt, lockedUntil, tier, initialized]. */
export type LockTuple = readonly [bigint, bigint, number, boolean]

/**
 * Remaining lock in whole days from the getter tuple. `lockedUntil` is index **1**
 * (index 0 is `depositedAt`). Returns 0 when the lock has expired / isn't set — so a
 * Flex deposit or an unlocked wallet simply earns no duration-match bonus.
 */
export function remainingLockDays(lock: LockTuple, nowSec: number): number {
  const lockedUntil = Number(lock[1])
  if (!Number.isFinite(lockedUntil) || lockedUntil <= nowSec) return 0
  return Math.floor((lockedUntil - nowSec) / 86_400)
}
