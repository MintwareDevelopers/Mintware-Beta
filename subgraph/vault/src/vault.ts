import { Address, BigInt } from "@graphprotocol/graph-ts"
import {
  Deposit as DepositEvent,
  Withdraw as WithdrawEvent,
  LockRecorded,
} from "../generated/templates/MintwareVault/MintwareDeFiVault4626"
import { Vault, Position, Deposit, Withdraw } from "../generated/schema"

function positionId(vault: Address, user: Address): string {
  return vault.toHexString() + "-" + user.toHexString()
}

function loadOrCreatePosition(vault: Address, user: Address, ts: BigInt): Position {
  let id = positionId(vault, user)
  let p = Position.load(id)
  if (p == null) {
    p = new Position(id)
    p.vault = vault.toHexString()
    p.user = user
    p.shares = BigInt.zero()
    p.netAssets = BigInt.zero()
    p.lockTier = 0
    p.lockedUntil = BigInt.zero()
  }
  p.lastActivity = ts
  return p
}

function eventId(txHash: string, logIndex: BigInt): string {
  return txHash + "-" + logIndex.toString()
}

export function handleDeposit(event: DepositEvent): void {
  let vault = Vault.load(event.address.toHexString())
  if (vault == null) return

  let d = new Deposit(eventId(event.transaction.hash.toHexString(), event.logIndex))
  d.vault = vault.id
  d.sender = event.params.sender
  d.owner = event.params.owner
  d.assets = event.params.assets
  d.shares = event.params.shares
  d.timestamp = event.block.timestamp
  d.block = event.block.number
  d.txHash = event.transaction.hash
  d.save()

  let p = loadOrCreatePosition(event.address, event.params.owner, event.block.timestamp)
  let isNew = p.shares.equals(BigInt.zero())
  p.shares = p.shares.plus(event.params.shares)
  p.netAssets = p.netAssets.plus(event.params.assets)
  p.save()

  vault.totalShares = vault.totalShares.plus(event.params.shares)
  vault.totalAssets = vault.totalAssets.plus(event.params.assets)
  if (isNew) vault.depositorCount = vault.depositorCount + 1
  vault.save()
}

export function handleWithdraw(event: WithdrawEvent): void {
  let vault = Vault.load(event.address.toHexString())
  if (vault == null) return

  let w = new Withdraw(eventId(event.transaction.hash.toHexString(), event.logIndex))
  w.vault = vault.id
  w.sender = event.params.sender
  w.receiver = event.params.receiver
  w.owner = event.params.owner
  w.assets = event.params.assets
  w.shares = event.params.shares
  w.timestamp = event.block.timestamp
  w.block = event.block.number
  w.txHash = event.transaction.hash
  w.save()

  let p = loadOrCreatePosition(event.address, event.params.owner, event.block.timestamp)
  p.shares = p.shares.minus(event.params.shares)
  p.netAssets = p.netAssets.minus(event.params.assets)
  if (p.shares.lt(BigInt.zero())) p.shares = BigInt.zero()
  if (p.netAssets.lt(BigInt.zero())) p.netAssets = BigInt.zero()
  p.save()

  vault.totalShares = vault.totalShares.minus(event.params.shares)
  vault.totalAssets = vault.totalAssets.minus(event.params.assets)
  if (vault.totalShares.lt(BigInt.zero())) vault.totalShares = BigInt.zero()
  if (vault.totalAssets.lt(BigInt.zero())) vault.totalAssets = BigInt.zero()
  vault.save()
}

export function handleLockRecorded(event: LockRecorded): void {
  let p = loadOrCreatePosition(event.address, event.params.owner, event.block.timestamp)
  p.lockTier = event.params.tier
  p.lockedUntil = event.params.lockedUntil
  p.save()
}
