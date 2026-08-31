// Buffer → vault SWEEP — the mirror of the refill. Refill redeems vault shares INTO the buffer to
// cover a deficit up to target; the sweep deposits surplus USDC (e.g. a card refund that pushed the
// buffer above target) back INTO the vault as senior shares. Together they pin the buffer AT target
// and keep everything above it earning — closing the "a refund strands idle USDC" drift.
//
// Pure decision + calldata here; the signing/broadcast orchestration is lib/org/bridgeSweep.ts. The
// deposit is signed by the member's OWN funding (Privy) wallet and credited to the member's OWN senior
// position — it never leaves the member's control. Dark-launched behind CARD_BUFFER_SWEEP_ENABLED.

import { encodeFunctionData, getAddress, isAddress, parseAbi, type Address, type Hex } from 'viem'

/** MintwareTreasuryVault senior deposit — pulls USDC from msg.sender, mints seniorShares to `to`. */
const DEPOSIT_ABI = parseAbi(['function depositUSDC(uint256 assets, uint256 minShares, address to) returns (uint256)'])

/**
 * Master runtime gate for the buffer→vault sweep. Fail-CLOSED (exact 'true' only), same posture as the
 * refill gate — moving the member's buffer surplus back on-chain is a deliberate ops act.
 */
export function bufferSweepEnabled(): boolean {
  return process.env.CARD_BUFFER_SWEEP_ENABLED === 'true'
}

/**
 * The amount (atomic USDC) to sweep from the buffer back into the vault: the surplus ABOVE target, but
 * only when it clears `minSweepAtomic` (so a few cents of drift don't trigger a gas-costly redeposit).
 * Returns 0 when at/below target or the surplus is too small. Leaves the buffer exactly at target.
 */
export function computeSweepAtomic(opts: {
  availableAtomic: bigint
  targetAtomic: bigint
  minSweepAtomic?: bigint
}): bigint {
  if (opts.availableAtomic <= opts.targetAtomic) return 0n
  const excess = opts.availableAtomic - opts.targetAtomic
  const min = opts.minSweepAtomic ?? 0n
  return excess >= min ? excess : 0n
}

/** Encoded `depositUSDC(assets, minShares, to)` call for the funding wallet to sign (pure). */
export function buildDepositCall(args: {
  vaultAddress: string
  assetsAtomic: bigint
  minShares: bigint
  to: string
}): { to: Address; data: Hex; value: '0x0' } {
  if (!isAddress(args.vaultAddress)) throw new Error('invalid vaultAddress')
  if (!isAddress(args.to)) throw new Error('invalid to')
  if (args.assetsAtomic <= 0n) throw new Error('assetsAtomic must be > 0')
  if (args.minShares < 0n) throw new Error('minShares must be >= 0')
  const data = encodeFunctionData({
    abi: DEPOSIT_ABI,
    functionName: 'depositUSDC',
    args: [args.assetsAtomic, args.minShares, getAddress(args.to)],
  })
  return { to: getAddress(args.vaultAddress), data, value: '0x0' }
}
