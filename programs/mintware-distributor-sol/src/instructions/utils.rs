use anchor_lang::prelude::*;

/// Build the oracle-signed message for a given claim.
///
/// Format: merkle_root[32] || deadline_i64_le[8] || epoch_number_u64_le[8] || campaign_id_utf8[N]
///
/// This must match exactly what the off-chain oracle signs.
pub fn build_oracle_message(
    campaign_id: &str,
    epoch_number: u64,
    merkle_root: &[u8; 32],
    deadline: i64,
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(48 + campaign_id.len());
    msg.extend_from_slice(merkle_root);
    msg.extend_from_slice(&deadline.to_le_bytes());
    msg.extend_from_slice(&epoch_number.to_le_bytes());
    msg.extend_from_slice(campaign_id.as_bytes());
    msg
}

/// Compute a double-keccak256 leaf hash for a (wallet, amount) pair.
///
/// Matches the EVM StandardMerkleTree leaf encoding:
///   keccak256(keccak256(abi.encode(address, uint256)))
///
/// On Solana we use keccak256 via `solana_program::keccak::hash`.
/// Payload is 40 bytes: 32-byte wallet pubkey || 8-byte little-endian u64 amount.
pub fn compute_leaf(wallet: &Pubkey, amount: u64) -> [u8; 32] {
    let mut payload = [0u8; 40];
    payload[..32].copy_from_slice(wallet.as_ref());
    payload[32..].copy_from_slice(&amount.to_le_bytes());
    let inner = solana_program::keccak::hash(&payload).0;
    solana_program::keccak::hash(&inner).0
}

/// Verify a Merkle proof against a root and leaf.
///
/// Proof nodes are sorted (smaller first) to produce canonical hashes — this
/// matches the sorted-pair convention used by OpenZeppelin MerkleProof.sol and
/// @openzeppelin/merkle-tree StandardMerkleTree.
pub fn verify_merkle_proof(proof: &[[u8; 32]], root: &[u8; 32], mut leaf: [u8; 32]) -> bool {
    for sibling in proof {
        if leaf <= *sibling {
            leaf = solana_program::keccak::hashv(&[&leaf, sibling.as_ref()]).0;
        } else {
            leaf = solana_program::keccak::hashv(&[sibling.as_ref(), &leaf]).0;
        }
    }
    leaf == *root
}
