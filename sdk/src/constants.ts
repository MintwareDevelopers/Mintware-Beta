// =============================================================================
// @mintware/ai-attribution-sdk — constants
// Contract addresses and ABI for AIAttribution.sol
// =============================================================================

import type { Abi } from 'viem'

// ── Deployed addresses ────────────────────────────────────────────────────────

export const CONTRACT_ADDRESSES = {
  baseSepolia: '0xDB9DB7008cfFb09bD1D943C237f57327383DFc03' as `0x${string}`,
  base:        '0x0000000000000000000000000000000000000000' as `0x${string}`, // deploy pending
} as const

export const DEFAULT_RPC = {
  baseSepolia: 'https://sepolia.base.org',
  base:        'https://mainnet.base.org',
} as const

export const DEFAULT_CONTRACT = CONTRACT_ADDRESSES.baseSepolia
export const DEFAULT_RPC_URL  = DEFAULT_RPC.baseSepolia

// ── AIAttribution ABI (functions used by SDK) ────────────────────────────────

export const AI_ATTRIBUTION_ABI = [
  // Registration
  {
    name: 'registerAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  // ERC-8004 link
  {
    name: 'linkErc8004',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  // MWP hash submission
  {
    name: 'submitMwpHash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'mwpHash', type: 'bytes32' }],
    outputs: [],
  },
  // Oracle: record verified action
  {
    name: 'recordVerifiedAction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent',             type: 'address' },
      { name: 'volumeContributed', type: 'uint256' },
      { name: 'mwpContextHash',    type: 'bytes32' },
      { name: 'campaignId',        type: 'uint256' },
    ],
    outputs: [],
  },
  // Create volume campaign
  {
    name: 'createVolumeCampaign',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name',         type: 'string'  },
      { name: 'targetVolume', type: 'uint256' },
      { name: 'duration',     type: 'uint256' },
    ],
    outputs: [{ name: 'campaignId', type: 'uint256' }],
  },
  // Read: full score
  {
    name: 'getScore',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      { name: 'total',            type: 'uint256' },
      { name: 'behavior',         type: 'uint128' },
      { name: 'contribution',     type: 'uint128' },
      { name: 'risk',             type: 'uint64'  },
      { name: 'interpretability', type: 'uint64'  },
      { name: 'isTransparent',    type: 'bool'    },
      { name: 'lastMwpHash',      type: 'bytes32' },
      { name: 'erc8004TokenId',   type: 'uint256' },
    ],
  },
  // Read: is registered
  {
    name: 'registered',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Read: campaign volume
  {
    name: 'getAgentCampaignVolume',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'campaignId', type: 'uint256' },
      { name: 'agent',      type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Read: transparent check
  {
    name: 'isAgentTransparent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Events (for subgraph / log filtering)
  {
    name: 'AgentRegistered',
    type: 'event',
    inputs: [
      { name: 'agent',          type: 'address', indexed: true },
      { name: 'erc8004TokenId', type: 'uint256', indexed: true },
    ],
  },
  {
    name: 'ActionRecorded',
    type: 'event',
    inputs: [
      { name: 'agent',             type: 'address', indexed: true  },
      { name: 'campaignId',        type: 'uint256', indexed: true  },
      { name: 'volumeContributed', type: 'uint256', indexed: false },
      { name: 'mwpHash',           type: 'bytes32', indexed: false },
      { name: 'newScore',          type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'MwpHashSubmitted',
    type: 'event',
    inputs: [
      { name: 'agent',           type: 'address', indexed: true  },
      { name: 'mwpHash',         type: 'bytes32', indexed: true  },
      { name: 'submissionCount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Erc8004Linked',
    type: 'event',
    inputs: [
      { name: 'agent',   type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const satisfies Abi
