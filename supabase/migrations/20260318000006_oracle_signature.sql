-- =============================================================================
-- Migration: 20260318000006_oracle_signature.sql
-- Date: 2026-03-18
--
-- Adds oracle_signature column to distributions.
--
-- Context
-- -------
-- The MintwareDistributor contract has been redesigned to use a zero-oracle-gas
-- model. Instead of the oracle calling createDistribution() on-chain (paying gas
-- per epoch), the oracle now signs the Merkle root off-chain using EIP-712.
--
-- The oracle_signature is stored here and returned by GET /api/claim so users
-- can submit it alongside their proof in a single claim() transaction.
--
-- Old flow (expensive):
--   Oracle txn: createDistribution(root, token, amount) → emits DistributionCreated
--   DB: onchain_id = distributionId (uint256 from event), status = 'published'
--   User calls: claim(distributionId, amount, proof)
--
-- New flow (zero oracle gas):
--   Oracle signs: EIP-712({ campaignId, epochNumber, merkleRoot }) — zero gas
--   DB: oracle_signature stored, status = 'published'
--   User calls: claim(campaignId, epochNumber, merkleRoot, oracleSig, amount, proof)
--
-- Changes
-- -------
--   ADD oracle_signature TEXT  — EIP-712 signature, NULL until oracle signs
--
-- onchain_id is kept (not dropped) to avoid breaking anything that may reference
-- it. It is no longer written by the new onchainPublisher and is deprecated.
-- =============================================================================

ALTER TABLE distributions
  ADD COLUMN IF NOT EXISTS oracle_signature TEXT;
  -- EIP-712 signature over (campaignId, epochNumber, merkleRoot)
  -- NULL while status = 'pending' (oracle has not yet signed)
  -- Set when status transitions to 'published'

COMMENT ON COLUMN distributions.oracle_signature IS
  'EIP-712 signature over RootPublication(campaignId, epochNumber, merkleRoot). '
  'Set by the oracle signer (onchainPublisher.ts) at epoch settlement. '
  'Returned by /api/claim and submitted by the user in claim().';

COMMENT ON COLUMN distributions.onchain_id IS
  'DEPRECATED. Was the uint256 distribution ID from the old createDistribution() call. '
  'No longer written. Use (campaign_id, epoch_number) to identify distributions on-chain.';
