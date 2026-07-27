import { Address, BigInt } from "@graphprotocol/graph-ts"
import {
  FeesReceived,
  EpochOpened,
  EpochClosed,
} from "../generated/FeeVault/FeeVault"
import { FeeEpoch, FeeReceipt } from "../generated/schema"

function epochId(feeVault: Address, id: BigInt): string {
  return feeVault.toHexString() + "-" + id.toString()
}

function loadOrCreateEpoch(feeVault: Address, id: BigInt, ts: BigInt): FeeEpoch {
  let key = epochId(feeVault, id)
  let e = FeeEpoch.load(key)
  if (e == null) {
    e = new FeeEpoch(key)
    e.feeVault = feeVault
    e.epochId = id
    e.status = "open"
    e.feesReceived = BigInt.zero()
    e.totalAllocated = BigInt.zero()
    e.openedAt = ts
  }
  return e as FeeEpoch
}

export function handleEpochOpened(event: EpochOpened): void {
  let e = loadOrCreateEpoch(event.address, event.params.epochId, event.block.timestamp)
  e.status = "open"
  e.openedAt = event.block.timestamp
  e.save()
}

export function handleFeesReceived(event: FeesReceived): void {
  let e = loadOrCreateEpoch(event.address, event.params.epochId, event.block.timestamp)
  e.feesReceived = e.feesReceived.plus(event.params.amount)
  e.save()

  let r = new FeeReceipt(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  )
  r.epoch = e.id
  r.amount = event.params.amount
  r.source = event.params.source
  r.timestamp = event.block.timestamp
  r.txHash = event.transaction.hash
  r.save()
}

export function handleEpochClosed(event: EpochClosed): void {
  let e = loadOrCreateEpoch(event.address, event.params.epochId, event.block.timestamp)
  e.status = "closed"
  e.totalAllocated = event.params.totalAllocated
  e.merkleRoot = event.params.merkleRoot
  e.closedAt = event.block.timestamp
  e.save()
}
