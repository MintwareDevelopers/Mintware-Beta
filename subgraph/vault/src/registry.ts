import { BigInt } from "@graphprotocol/graph-ts"
import {
  VaultRegistered,
  VaultDeactivated,
} from "../generated/MintwareVaultRegistry/MintwareVaultRegistry"
import { Vault, VaultLookup } from "../generated/schema"
import { MintwareVault } from "../generated/templates"

// Registry emits VaultRegistered(vaultId, surface, vault, feeVault, provider).
// We key the Vault entity by its *contract address* (so per-vault Deposit/Withdraw
// handlers can load it by event.address) and stash the registry vaultId as a field.
export function handleVaultRegistered(event: VaultRegistered): void {
  let id = event.params.vault.toHexString()
  let v = new Vault(id)
  v.vaultId = event.params.vaultId
  v.surface = event.params.surface
  v.address = event.params.vault
  v.feeVault = event.params.feeVault
  v.provider = event.params.provider
  v.active = true
  v.createdAt = event.block.timestamp
  v.createdBlock = event.block.number
  v.totalShares = BigInt.zero()
  v.totalAssets = BigInt.zero()
  v.depositorCount = 0
  v.save()

  // Record vaultId → address so VaultDeactivated (vaultId-only) can resolve the vault.
  let lookup = new VaultLookup(event.params.vaultId.toHexString())
  lookup.vault = event.params.vault
  lookup.save()

  // Spin up a dynamic data source that indexes this vault's own events.
  MintwareVault.create(event.params.vault)
}

export function handleVaultDeactivated(event: VaultDeactivated): void {
  let lookup = VaultLookup.load(event.params.vaultId.toHexString())
  if (lookup == null) return
  let v = Vault.load(lookup.vault.toHexString())
  if (v == null) return
  v.active = false
  v.save()
}
