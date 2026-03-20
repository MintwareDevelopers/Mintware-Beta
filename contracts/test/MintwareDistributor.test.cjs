// =============================================================================
// MintwareDistributor.test.cjs — v2
//
// Hardhat + ethers.js test suite for MintwareDistributor v2.
//
// Run: pnpm hardhat:test
//
// v2 changes tested here (vs v1):
//   - deadline field in ROOT_TYPEHASH → oracleSign + getRootDigest + claim() all take deadline
//   - oracleSigner is now mutable — proposeOracleSigner / confirmOracleSigner / cancelOracleRotation
//   - Campaign lifecycle: closeCampaign() / withdrawCampaign() / WITHDRAWAL_COOLDOWN
//   - emergencyWithdraw() only when paused
//   - batchClaim() for multi-campaign single-tx claims
//   - getCampaign() convenience view
//   - Events restructured: bytes32 indexed campaignIdHash + reordered args
//   - depositCampaign: balance-diff accounting, tracks creator, respects closed state
//
// Test matrix:
//   Section 1  — Leaf encoding: computeLeaf() must match StandardMerkleTree
//   Section 2  — depositCampaign(): success, creator tracking, token immutability, closed guard
//   Section 3  — Oracle EIP-712 signing: getRootDigest(), deadline in typehash
//   Section 4  — claim(): valid, invalid sig, invalid proof, double-claim, deadline expired
//   Section 5  — Multi-epoch: same wallet, different epochs → independent
//   Section 6  — Multi-campaign: different campaignIds → isolated balances
//   Section 7  — pause() / unpause() / emergencyWithdraw()
//   Section 8  — isClaimed() view function state tracking
//   Section 9  — Oracle rotation: propose / confirm / cancel, 48h timelock
//   Section 10 — Campaign lifecycle: closeCampaign / withdrawCampaign / 7-day cooldown
//   Section 11 — batchClaim(): single tx, multi-campaign
//   Section 12 — getCampaign() view
//
// Written as .cjs — required for Mocha in ESM projects ("type":"module" in package.json).
// =============================================================================

'use strict'

const { expect }         = require('chai')
const { ethers }         = require('hardhat')
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A deadline far in the future — used for all normal tests.
// Using a fixed large value avoids block-timestamp sensitivity.
const FAR_FUTURE = 9_999_999_999n   // ~Year 2286

// An already-expired deadline — used to test deadline rejection.
const EXPIRED_DEADLINE = 1n          // 1 second after unix epoch

// Oracle rotation delay (must match contract constant)
const ORACLE_ROTATION_DELAY = 48 * 60 * 60   // 48 hours in seconds

// Withdrawal cooldown (must match contract constant)
const WITHDRAWAL_COOLDOWN = 7 * 24 * 60 * 60  // 7 days in seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a StandardMerkleTree from (wallet, amount) pairs */
function buildTree(entries) {
  return StandardMerkleTree.of(
    entries.map(([addr, amt]) => [addr, amt.toString()]),
    ['address', 'uint256']
  )
}

/** Get the Merkle proof for a specific wallet+amount leaf */
function getProof(tree, wallet, amount) {
  for (const [i, v] of tree.entries()) {
    if (v[0].toLowerCase() === wallet.toLowerCase() && v[1] === amount.toString()) {
      return tree.getProof(i)
    }
  }
  throw new Error(`Leaf not found: ${wallet} ${amount}`)
}

/**
 * Build the EIP-712 typed data params for the oracle to sign (v2 — includes deadline).
 */
function buildTypedData(contractAddress, chainId, campaignId, epochNumber, merkleRoot, deadline) {
  return {
    domain: {
      name:              'MintwareDistributor',
      version:           '1',
      chainId,
      verifyingContract: contractAddress,
    },
    types: {
      RootPublication: [
        { name: 'campaignId',   type: 'string'  },
        { name: 'epochNumber',  type: 'uint256' },
        { name: 'merkleRoot',   type: 'bytes32' },
        { name: 'deadline',     type: 'uint256' },   // v2: added
      ],
    },
    message: { campaignId, epochNumber, merkleRoot, deadline },
  }
}

/**
 * Sign the Merkle root as the oracle using EIP-712 (v2 — includes deadline).
 * @param {bigint} deadline — unix timestamp after which claim() rejects this sig
 */
async function oracleSign(oracle, contractAddress, chainId, campaignId, epochNumber, merkleRoot, deadline) {
  const { domain, types, message } = buildTypedData(
    contractAddress, chainId, campaignId, epochNumber, merkleRoot, deadline
  )
  return oracle.signTypedData(domain, types, message)
}

/** Advance Hardhat block time by `seconds` and mine a new block */
async function advanceTime(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds])
  await ethers.provider.send('evm_mine', [])
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MintwareDistributor v2', function () {
  let owner, oracle, alice, bob, carol, stranger, newOracle
  let distributor
  let token
  let chainId
  let distributorAddress

  const CAMPAIGN_ID = 'campaign-abc-123'
  const EPOCH_1 = 1n
  const EPOCH_2 = 2n

  const ALICE_AMOUNT = ethers.parseUnits('100', 18)
  const BOB_AMOUNT   = ethers.parseUnits('50',  18)
  const CAROL_AMOUNT = ethers.parseUnits('25',  18)
  const TOTAL        = ALICE_AMOUNT + BOB_AMOUNT + CAROL_AMOUNT

  beforeEach(async () => {
    ;[owner, oracle, alice, bob, carol, stranger, newOracle] = await ethers.getSigners()

    const network = await ethers.provider.getNetwork()
    chainId = network.chainId

    // Deploy mock ERC-20
    const ERC20 = await ethers.getContractFactory('MockERC20')
    token = await ERC20.deploy('Mock Token', 'MTK', 18)
    await token.waitForDeployment()

    // Deploy distributor: oracle signs roots, owner can pause/rotate/close
    const Distributor = await ethers.getContractFactory('MintwareDistributor')
    distributor = await Distributor.deploy(oracle.address, owner.address)
    await distributor.waitForDeployment()
    distributorAddress = await distributor.getAddress()

    // Fund alice with enough tokens to deposit for tests
    await token.mint(alice.address, TOTAL * 10n)
    await token.connect(alice).approve(distributorAddress, TOTAL * 10n)
  })

  // ===========================================================================
  // SECTION 1 — Leaf encoding verification (CRITICAL — unchanged from v1)
  // ===========================================================================

  describe('Leaf encoding — must match StandardMerkleTree exactly', () => {
    it('computeLeaf() matches StandardMerkleTree for a single entry', async () => {
      const tree       = buildTree([[alice.address, ALICE_AMOUNT]])
      const offChainLeaf = tree.dump().tree[0]
      const onChainLeaf  = await distributor.computeLeaf(alice.address, ALICE_AMOUNT)
      expect(onChainLeaf).to.equal(offChainLeaf)
    })

    it('computeLeaf() matches for all entries in a 3-entry tree', async () => {
      const entries = [
        [alice.address, ALICE_AMOUNT],
        [bob.address,   BOB_AMOUNT],
        [carol.address, CAROL_AMOUNT],
      ]
      for (const [addr, amt] of entries) {
        const onChain  = await distributor.computeLeaf(addr, amt)
        const offChain = buildTree([[addr, amt]]).dump().tree[0]
        expect(onChain).to.equal(offChain, `Leaf mismatch for ${addr}`)
      }
    })

    it('uses abi.encode (64-byte padded), NOT abi.encodePacked (52 bytes)', async () => {
      const abiEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [alice.address, ALICE_AMOUNT]
      )
      expect(abiEncoded.length).to.equal(2 + 128) // 64 bytes = 128 hex chars + '0x'

      const inner    = ethers.keccak256(abiEncoded)
      const expected = ethers.keccak256(ethers.getBytes(inner))
      const onChain  = await distributor.computeLeaf(alice.address, ALICE_AMOUNT)
      expect(onChain).to.equal(expected)
    })
  })

  // ===========================================================================
  // SECTION 2 — depositCampaign()
  // ===========================================================================

  describe('depositCampaign()', () => {
    it('deposits tokens and emits CampaignFunded with correct args', async () => {
      const tokenAddr      = await token.getAddress()
      const campaignIdHash = ethers.keccak256(ethers.toUtf8Bytes(CAMPAIGN_ID))

      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      )
        .to.emit(distributor, 'CampaignFunded')
        .withArgs(campaignIdHash, tokenAddr, alice.address, CAMPAIGN_ID, ALICE_AMOUNT)
    })

    it('pulls tokens from depositor into contract', async () => {
      const tokenAddr      = await token.getAddress()
      const beforeAlice    = await token.balanceOf(alice.address)
      const beforeContract = await token.balanceOf(distributorAddress)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      expect(await token.balanceOf(alice.address)).to.equal(beforeAlice - ALICE_AMOUNT)
      expect(await token.balanceOf(distributorAddress)).to.equal(beforeContract + ALICE_AMOUNT)
    })

    it('records campaign token on first deposit', async () => {
      const tokenAddr  = await token.getAddress()
      const infoBefore = await distributor.campaigns(CAMPAIGN_ID)
      expect(infoBefore.token).to.equal(ethers.ZeroAddress)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const infoAfter = await distributor.campaigns(CAMPAIGN_ID)
      expect(infoAfter.token).to.equal(tokenAddr)
    })

    it('records first depositor as campaign creator', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const info = await distributor.campaigns(CAMPAIGN_ID)
      expect(info.creator).to.equal(alice.address)
    })

    it('subsequent depositor does NOT overwrite creator', async () => {
      const tokenAddr = await token.getAddress()
      await token.mint(bob.address, BOB_AMOUNT)
      await token.connect(bob).approve(distributorAddress, BOB_AMOUNT)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      await distributor.connect(bob).depositCampaign(CAMPAIGN_ID, tokenAddr, BOB_AMOUNT)

      const info = await distributor.campaigns(CAMPAIGN_ID)
      expect(info.creator).to.equal(alice.address)  // still alice
    })

    it('tracks campaignBalances correctly across top-ups', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      expect(await distributor.campaignBalances(CAMPAIGN_ID)).to.equal(ALICE_AMOUNT)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, BOB_AMOUNT)
      expect(await distributor.campaignBalances(CAMPAIGN_ID)).to.equal(ALICE_AMOUNT + BOB_AMOUNT)
    })

    it('reverts if a different token is deposited to an existing campaign', async () => {
      const ERC20b = await ethers.getContractFactory('MockERC20')
      const tokenB = await ERC20b.deploy('Token B', 'TKB', 18)
      await tokenB.waitForDeployment()
      await tokenB.mint(alice.address, ALICE_AMOUNT)
      await tokenB.connect(alice).approve(distributorAddress, ALICE_AMOUNT)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, await token.getAddress(), ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, await tokenB.getAddress(), ALICE_AMOUNT)
      ).to.be.revertedWith('MintwareDistributor: token mismatch for campaign')
    })

    it('reverts if campaign is closed', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      await distributor.connect(owner).closeCampaign(CAMPAIGN_ID)

      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, BOB_AMOUNT)
      ).to.be.revertedWith('MintwareDistributor: campaign closed')
    })

    it('reverts if token is zero address', async () => {
      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, ethers.ZeroAddress, ALICE_AMOUNT)
      ).to.be.revertedWith('MintwareDistributor: zero token')
    })

    it('reverts if amount is zero', async () => {
      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, await token.getAddress(), 0n)
      ).to.be.revertedWith('MintwareDistributor: zero amount')
    })

    it('campaigns with different IDs are isolated', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign('campaign-A', tokenAddr, ALICE_AMOUNT)
      await distributor.connect(alice).depositCampaign('campaign-B', tokenAddr, BOB_AMOUNT)

      expect(await distributor.campaignBalances('campaign-A')).to.equal(ALICE_AMOUNT)
      expect(await distributor.campaignBalances('campaign-B')).to.equal(BOB_AMOUNT)
    })
  })

  // ===========================================================================
  // SECTION 3 — EIP-712 oracle signing (v2 — deadline in typehash)
  // ===========================================================================

  describe('Oracle EIP-712 signing', () => {
    it('getRootDigest() matches the digest ethers computes for the same inputs', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const { domain, types, message } = buildTypedData(
        distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE
      )

      const offChainDigest = ethers.TypedDataEncoder.hash(domain, types, message)
      const onChainDigest  = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)

      expect(onChainDigest).to.equal(offChainDigest)
    })

    it('oracle signature over digest is recoverable to oracle.address', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)

      const digest    = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      const recovered = ethers.recoverAddress(digest, sig)

      expect(recovered.toLowerCase()).to.equal(oracle.address.toLowerCase())
    })

    it('deadline is baked into the typehash — different deadlines produce different digests', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])

      const digest1 = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      const digest2 = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE - 1n)

      expect(digest1).to.not.equal(digest2)
    })

    it('signature from a non-oracle signer does not recover to oracleSigner', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(stranger, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)

      const digest    = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      const recovered = ethers.recoverAddress(digest, sig)

      expect(recovered.toLowerCase()).to.not.equal(oracle.address.toLowerCase())
    })

    it('oracleSigner storage variable matches the oracle address passed to constructor', async () => {
      expect(await distributor.oracleSigner()).to.equal(oracle.address)
    })
  })

  // ===========================================================================
  // SECTION 4 — claim()
  // ===========================================================================

  describe('claim()', () => {
    let tree, oracleSig

    beforeEach(async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, TOTAL)

      const entries = [
        [alice.address, ALICE_AMOUNT],
        [bob.address,   BOB_AMOUNT],
        [carol.address, CAROL_AMOUNT],
      ]
      tree      = buildTree(entries)
      oracleSig = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
    })

    it('valid proof + valid oracle sig transfers tokens to claimant', async () => {
      const proof  = getProof(tree, alice.address, ALICE_AMOUNT)
      const before = await token.balanceOf(alice.address)

      await distributor.connect(alice).claim(
        CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT, proof
      )

      expect(await token.balanceOf(alice.address)).to.equal(before + ALICE_AMOUNT)
    })

    it('emits Claimed with correct args (including campaignIdHash)', async () => {
      const proof          = getProof(tree, alice.address, ALICE_AMOUNT)
      const campaignIdHash = ethers.keccak256(ethers.toUtf8Bytes(CAMPAIGN_ID))

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT, proof)
      )
        .to.emit(distributor, 'Claimed')
        .withArgs(campaignIdHash, EPOCH_1, alice.address, CAMPAIGN_ID, ALICE_AMOUNT)
    })

    it('decrements campaignBalances by claimed amount', async () => {
      const before = await distributor.campaignBalances(CAMPAIGN_ID)
      await distributor.connect(alice).claim(
        CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT,
        getProof(tree, alice.address, ALICE_AMOUNT)
      )
      expect(await distributor.campaignBalances(CAMPAIGN_ID)).to.equal(before - ALICE_AMOUNT)
    })

    it('all three claimants can claim independently', async () => {
      const aliceBefore = await token.balanceOf(alice.address)

      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      await distributor.connect(bob).claim(  CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, BOB_AMOUNT,   getProof(tree, bob.address,   BOB_AMOUNT))
      await distributor.connect(carol).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, CAROL_AMOUNT, getProof(tree, carol.address, CAROL_AMOUNT))

      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore + ALICE_AMOUNT)
      expect(await token.balanceOf(bob.address)).to.equal(BOB_AMOUNT)
      expect(await token.balanceOf(carol.address)).to.equal(CAROL_AMOUNT)
    })

    it('reverts if signature has expired (deadline in the past)', async () => {
      const expiredSig = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, EXPIRED_DEADLINE)
      const proof      = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, expiredSig, EXPIRED_DEADLINE, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: signature expired')
    })

    it('reverts if deadline in args does not match signature deadline', async () => {
      // Sig is for FAR_FUTURE, but caller passes a different deadline
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE - 1n, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })

    it('reverts on invalid oracle signature (signed by stranger)', async () => {
      const strangerSig = await oracleSign(stranger, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      const proof       = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, strangerSig, FAR_FUTURE, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })

    it('reverts on invalid oracle signature (wrong campaign id in sig)', async () => {
      const wrongSig = await oracleSign(oracle, distributorAddress, chainId, 'wrong-campaign', EPOCH_1, tree.root, FAR_FUTURE)
      const proof    = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, wrongSig, FAR_FUTURE, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })

    it('reverts on invalid oracle signature (wrong epoch in sig)', async () => {
      const wrongSig = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_2, tree.root, FAR_FUTURE)
      const proof    = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, wrongSig, FAR_FUTURE, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })

    it('reverts on invalid proof — wrong amount', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT + 1n, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on invalid proof — wrong wallet (alice proof, claiming as stranger)', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(stranger).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on double claim within same epoch', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT, proof)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: already claimed')
    })

    it('reverts if amount is zero', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, FAR_FUTURE, 0n, proof)
      ).to.be.revertedWith('MintwareDistributor: zero amount')
    })

    it('reverts if campaign has no balance (not funded) — checked before sig verification', async () => {
      const unfundedTree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig          = await oracleSign(oracle, distributorAddress, chainId, 'unfunded', EPOCH_1, unfundedTree.root, FAR_FUTURE)
      const proof        = getProof(unfundedTree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim('unfunded', EPOCH_1, unfundedTree.root, sig, FAR_FUTURE, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: campaign not funded')
    })
  })

  // ===========================================================================
  // SECTION 5 — Multi-epoch independence
  // ===========================================================================

  describe('Multi-epoch independence', () => {
    it('same wallet can claim from different epochs of the same campaign', async () => {
      const tokenAddr   = await token.getAddress()
      const aliceBefore = await token.balanceOf(alice.address)
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT * 2n)

      const tree1 = buildTree([[alice.address, ALICE_AMOUNT]])
      const tree2 = buildTree([[alice.address, ALICE_AMOUNT]])

      const sig1 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree1.root, FAR_FUTURE)
      const sig2 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_2, tree2.root, FAR_FUTURE)

      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree1.root, sig1, FAR_FUTURE, ALICE_AMOUNT, getProof(tree1, alice.address, ALICE_AMOUNT))
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_2, tree2.root, sig2, FAR_FUTURE, ALICE_AMOUNT, getProof(tree2, alice.address, ALICE_AMOUNT))

      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore)  // net 0: deposited 2×, claimed 2×
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_2, alice.address)).to.equal(true)
    })

    it('claiming epoch 1 does not affect claimed state for epoch 2', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT * 2n)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig1 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)

      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig1, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))

      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_2, alice.address)).to.equal(false)
    })

    it('epoch 2 signature cannot replay as epoch 1', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig2 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_2, tree.root, FAR_FUTURE)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig2, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })
  })

  // ===========================================================================
  // SECTION 6 — Multi-campaign isolation
  // ===========================================================================

  describe('Multi-campaign isolation', () => {
    it('different campaignIds have independent balances and claimed state', async () => {
      const tokenAddr   = await token.getAddress()
      const aliceBefore = await token.balanceOf(alice.address)

      await distributor.connect(alice).depositCampaign('camp-A', tokenAddr, ALICE_AMOUNT)
      await distributor.connect(alice).depositCampaign('camp-B', tokenAddr, BOB_AMOUNT)

      const treeA = buildTree([[alice.address, ALICE_AMOUNT]])
      const treeB = buildTree([[alice.address, BOB_AMOUNT]])

      const sigA = await oracleSign(oracle, distributorAddress, chainId, 'camp-A', EPOCH_1, treeA.root, FAR_FUTURE)
      const sigB = await oracleSign(oracle, distributorAddress, chainId, 'camp-B', EPOCH_1, treeB.root, FAR_FUTURE)

      await distributor.connect(alice).claim('camp-A', EPOCH_1, treeA.root, sigA, FAR_FUTURE, ALICE_AMOUNT, getProof(treeA, alice.address, ALICE_AMOUNT))
      await distributor.connect(alice).claim('camp-B', EPOCH_1, treeB.root, sigB, FAR_FUTURE, BOB_AMOUNT,   getProof(treeB, alice.address, BOB_AMOUNT))

      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore)  // net 0
      expect(await distributor.isClaimed('camp-A', EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed('camp-B', EPOCH_1, alice.address)).to.equal(true)
    })

    it('campaign A signature cannot be replayed for campaign B', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign('camp-A', tokenAddr, ALICE_AMOUNT)
      await distributor.connect(alice).depositCampaign('camp-B', tokenAddr, ALICE_AMOUNT)

      const treeA = buildTree([[alice.address, ALICE_AMOUNT]])
      const sigA  = await oracleSign(oracle, distributorAddress, chainId, 'camp-A', EPOCH_1, treeA.root, FAR_FUTURE)

      await expect(
        distributor.connect(alice).claim('camp-B', EPOCH_1, treeA.root, sigA, FAR_FUTURE, ALICE_AMOUNT, getProof(treeA, alice.address, ALICE_AMOUNT))
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })
  })

  // ===========================================================================
  // SECTION 7 — pause() / unpause() / emergencyWithdraw()
  // ===========================================================================

  describe('pause() / unpause() / emergencyWithdraw()', () => {
    let tree, sig

    beforeEach(async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      tree = buildTree([[alice.address, ALICE_AMOUNT]])
      sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
    })

    it('pause() blocks claim()', async () => {
      await distributor.connect(owner).pause()
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.be.revertedWithCustomError(distributor, 'EnforcedPause')
    })

    it('pause() blocks depositCampaign()', async () => {
      await distributor.connect(owner).pause()
      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, await token.getAddress(), BOB_AMOUNT)
      ).to.be.revertedWithCustomError(distributor, 'EnforcedPause')
    })

    it('unpause() re-enables claim()', async () => {
      await distributor.connect(owner).pause()
      await distributor.connect(owner).unpause()

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.emit(distributor, 'Claimed')
    })

    it('pause() reverts if called by non-owner', async () => {
      await expect(
        distributor.connect(stranger).pause()
      ).to.be.revertedWithCustomError(distributor, 'OwnableUnauthorizedAccount')
    })

    it('emergencyWithdraw() transfers tokens when paused', async () => {
      const tokenAddr   = await token.getAddress()
      const ownerBefore = await token.balanceOf(owner.address)

      await distributor.connect(owner).pause()
      await distributor.connect(owner).emergencyWithdraw(tokenAddr, owner.address, ALICE_AMOUNT)

      expect(await token.balanceOf(owner.address)).to.equal(ownerBefore + ALICE_AMOUNT)
    })

    it('emergencyWithdraw() emits EmergencyWithdraw event', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(owner).pause()

      await expect(
        distributor.connect(owner).emergencyWithdraw(tokenAddr, owner.address, ALICE_AMOUNT)
      )
        .to.emit(distributor, 'EmergencyWithdraw')
        .withArgs(tokenAddr, owner.address, ALICE_AMOUNT)
    })

    it('emergencyWithdraw() reverts when NOT paused', async () => {
      const tokenAddr = await token.getAddress()
      await expect(
        distributor.connect(owner).emergencyWithdraw(tokenAddr, owner.address, ALICE_AMOUNT)
      ).to.be.revertedWithCustomError(distributor, 'ExpectedPause')
    })

    it('emergencyWithdraw() reverts if called by non-owner', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(owner).pause()

      await expect(
        distributor.connect(stranger).emergencyWithdraw(tokenAddr, owner.address, ALICE_AMOUNT)
      ).to.be.revertedWithCustomError(distributor, 'OwnableUnauthorizedAccount')
    })
  })

  // ===========================================================================
  // SECTION 8 — isClaimed() view function
  // ===========================================================================

  describe('isClaimed()', () => {
    it('returns false before claiming', async () => {
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(false)
    })

    it('returns true after claiming', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))

      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
    })

    it('is (campaign, epoch)-scoped', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))

      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_2, alice.address)).to.equal(false)
      expect(await distributor.isClaimed('camp-B',    EPOCH_1, alice.address)).to.equal(false)
    })
  })

  // ===========================================================================
  // SECTION 9 — Oracle rotation (new in v2)
  // ===========================================================================

  describe('Oracle rotation', () => {
    it('proposeOracleSigner() sets pendingOracleSigner and emits event', async () => {
      await expect(
        distributor.connect(owner).proposeOracleSigner(newOracle.address)
      )
        .to.emit(distributor, 'OracleRotationProposed')

      expect(await distributor.pendingOracleSigner()).to.equal(newOracle.address)
    })

    it('confirmOracleSigner() reverts before delay has elapsed', async () => {
      await distributor.connect(owner).proposeOracleSigner(newOracle.address)

      await expect(
        distributor.connect(owner).confirmOracleSigner()
      ).to.be.revertedWith('MintwareDistributor: rotation delay not elapsed')
    })

    it('confirmOracleSigner() succeeds after 48h, updates oracleSigner', async () => {
      await distributor.connect(owner).proposeOracleSigner(newOracle.address)
      await advanceTime(ORACLE_ROTATION_DELAY + 1)

      await expect(
        distributor.connect(owner).confirmOracleSigner()
      )
        .to.emit(distributor, 'OracleRotationConfirmed')
        .withArgs(oracle.address, newOracle.address)

      expect(await distributor.oracleSigner()).to.equal(newOracle.address)
      expect(await distributor.pendingOracleSigner()).to.equal(ethers.ZeroAddress)
    })

    it('cancelOracleRotation() clears pending rotation before delay elapses', async () => {
      await distributor.connect(owner).proposeOracleSigner(newOracle.address)
      await distributor.connect(owner).cancelOracleRotation()

      expect(await distributor.pendingOracleSigner()).to.equal(ethers.ZeroAddress)
      expect(await distributor.oracleSigner()).to.equal(oracle.address)  // unchanged
    })

    it('after rotation, new oracleSigner validates claims; old oracle is rejected', async () => {
      // Fund and build tree
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])

      // Rotate to newOracle
      await distributor.connect(owner).proposeOracleSigner(newOracle.address)
      await advanceTime(ORACLE_ROTATION_DELAY + 1)
      await distributor.connect(owner).confirmOracleSigner()

      // Old oracle sig rejected
      const oldSig = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oldSig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')

      // New oracle sig accepted
      const newSig = await oracleSign(newOracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, newSig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.emit(distributor, 'Claimed')
    })

    it('proposeOracleSigner() reverts if called by non-owner', async () => {
      await expect(
        distributor.connect(stranger).proposeOracleSigner(newOracle.address)
      ).to.be.revertedWithCustomError(distributor, 'OwnableUnauthorizedAccount')
    })

    it('proposeOracleSigner() reverts if proposed is already active signer', async () => {
      await expect(
        distributor.connect(owner).proposeOracleSigner(oracle.address)
      ).to.be.revertedWith('MintwareDistributor: already active signer')
    })

    it('confirmOracleSigner() reverts if no rotation is pending', async () => {
      await expect(
        distributor.connect(owner).confirmOracleSigner()
      ).to.be.revertedWith('MintwareDistributor: no rotation pending')
    })

    it('cancelOracleRotation() reverts if no rotation is pending', async () => {
      await expect(
        distributor.connect(owner).cancelOracleRotation()
      ).to.be.revertedWith('MintwareDistributor: no rotation pending')
    })
  })

  // ===========================================================================
  // SECTION 10 — Campaign lifecycle: close + withdraw (new in v2)
  // ===========================================================================

  describe('Campaign lifecycle (closeCampaign / withdrawCampaign)', () => {
    beforeEach(async () => {
      const tokenAddr = await token.getAddress()
      // alice deposits TOTAL, but only BOB+CAROL claim — leaving ALICE_AMOUNT unclaimed
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, TOTAL)

      const tree = buildTree([
        [bob.address,   BOB_AMOUNT],
        [carol.address, CAROL_AMOUNT],
      ])
      const sig = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root, FAR_FUTURE)

      await distributor.connect(bob).claim(  CAMPAIGN_ID, EPOCH_1, tree.root, sig, FAR_FUTURE, BOB_AMOUNT,   getProof(tree, bob.address,   BOB_AMOUNT))
      await distributor.connect(carol).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, FAR_FUTURE, CAROL_AMOUNT, getProof(tree, carol.address, CAROL_AMOUNT))
      // ALICE_AMOUNT remains in contract
    })

    it('closeCampaign() sets closed=true and emits CampaignClosed', async () => {
      const campaignIdHash = ethers.keccak256(ethers.toUtf8Bytes(CAMPAIGN_ID))

      await expect(distributor.connect(owner).closeCampaign(CAMPAIGN_ID))
        .to.emit(distributor, 'CampaignClosed')

      const info = await distributor.campaigns(CAMPAIGN_ID)
      expect(info.closed).to.equal(true)
    })

    it('closeCampaign() reverts if called by non-owner', async () => {
      await expect(
        distributor.connect(alice).closeCampaign(CAMPAIGN_ID)
      ).to.be.revertedWithCustomError(distributor, 'OwnableUnauthorizedAccount')
    })

    it('closeCampaign() reverts if already closed', async () => {
      await distributor.connect(owner).closeCampaign(CAMPAIGN_ID)
      await expect(
        distributor.connect(owner).closeCampaign(CAMPAIGN_ID)
      ).to.be.revertedWith('MintwareDistributor: already closed')
    })

    it('withdrawCampaign() reverts before cooldown elapses', async () => {
      await distributor.connect(owner).closeCampaign(CAMPAIGN_ID)

      await expect(
        distributor.connect(alice).withdrawCampaign(CAMPAIGN_ID)
      ).to.be.revertedWith('MintwareDistributor: cooldown active')
    })

    it('withdrawCampaign() succeeds after 7-day cooldown, transfers remaining balance', async () => {
      const aliceBefore = await token.balanceOf(alice.address)

      await distributor.connect(owner).closeCampaign(CAMPAIGN_ID)
      await advanceTime(WITHDRAWAL_COOLDOWN + 1)

      await expect(distributor.connect(alice).withdrawCampaign(CAMPAIGN_ID))
        .to.emit(distributor, 'CampaignWithdrawn')

      // Alice (creator) receives the unclaimed ALICE_AMOUNT
      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore + ALICE_AMOUNT)
      expect(await distributor.campaignBalances(CAMPAIGN_ID)).to.equal(0n)
    })

    it('withdrawCampaign() reverts if not the campaign creator', async () => {
      await distributor.connect(owner).closeCampaign(CAMPAIGN_ID)
      await advanceTime(WITHDRAWAL_COOLDOWN + 1)

      await expect(
        distributor.connect(stranger).withdrawCampaign(CAMPAIGN_ID)
      ).to.be.revertedWith('MintwareDistributor: not campaign creator')
    })

    it('withdrawCampaign() reverts if campaign is not closed', async () => {
      await expect(
        distributor.connect(alice).withdrawCampaign(CAMPAIGN_ID)
      ).to.be.revertedWith('MintwareDistributor: campaign not closed')
    })

    it('claims are still valid during cooldown window after close', async () => {
      // Deposit and build tree with alice
      const tokenAddr = await token.getAddress()
      await token.mint(owner.address, ALICE_AMOUNT)
      await token.connect(owner).approve(distributorAddress, ALICE_AMOUNT)
      await distributor.connect(owner).depositCampaign('camp-close-test', tokenAddr, ALICE_AMOUNT)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(oracle, distributorAddress, chainId, 'camp-close-test', EPOCH_1, tree.root, FAR_FUTURE)

      // Close campaign — cooldown starts
      await distributor.connect(owner).closeCampaign('camp-close-test')

      // Alice can still claim within the cooldown
      await expect(
        distributor.connect(alice).claim('camp-close-test', EPOCH_1, tree.root, sig, FAR_FUTURE, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.emit(distributor, 'Claimed')
    })
  })

  // ===========================================================================
  // SECTION 11 — batchClaim() (new in v2)
  // ===========================================================================

  describe('batchClaim()', () => {
    it('claims from two campaigns in a single transaction', async () => {
      const tokenAddr   = await token.getAddress()
      const aliceBefore = await token.balanceOf(alice.address)

      await distributor.connect(alice).depositCampaign('batch-A', tokenAddr, ALICE_AMOUNT)
      await distributor.connect(alice).depositCampaign('batch-B', tokenAddr, BOB_AMOUNT)

      const treeA = buildTree([[alice.address, ALICE_AMOUNT]])
      const treeB = buildTree([[alice.address, BOB_AMOUNT]])

      const sigA = await oracleSign(oracle, distributorAddress, chainId, 'batch-A', EPOCH_1, treeA.root, FAR_FUTURE)
      const sigB = await oracleSign(oracle, distributorAddress, chainId, 'batch-B', EPOCH_1, treeB.root, FAR_FUTURE)

      await distributor.connect(alice).batchClaim([
        {
          campaignId:      'batch-A',
          epochNumber:     EPOCH_1,
          merkleRoot:      treeA.root,
          oracleSignature: sigA,
          deadline:        FAR_FUTURE,
          amount:          ALICE_AMOUNT,
          merkleProof:     getProof(treeA, alice.address, ALICE_AMOUNT),
        },
        {
          campaignId:      'batch-B',
          epochNumber:     EPOCH_1,
          merkleRoot:      treeB.root,
          oracleSignature: sigB,
          deadline:        FAR_FUTURE,
          amount:          BOB_AMOUNT,
          merkleProof:     getProof(treeB, alice.address, BOB_AMOUNT),
        },
      ])

      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore)  // net 0: deposited then claimed both back
      expect(await distributor.isClaimed('batch-A', EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed('batch-B', EPOCH_1, alice.address)).to.equal(true)
    })

    it('reverts entire batch if any single claim is invalid', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign('batch-C', tokenAddr, ALICE_AMOUNT)
      await distributor.connect(alice).depositCampaign('batch-D', tokenAddr, BOB_AMOUNT)

      const treeC = buildTree([[alice.address, ALICE_AMOUNT]])
      const treeD = buildTree([[alice.address, BOB_AMOUNT]])

      const sigC   = await oracleSign(oracle, distributorAddress, chainId, 'batch-C', EPOCH_1, treeC.root, FAR_FUTURE)
      const badSig = await oracleSign(stranger, distributorAddress, chainId, 'batch-D', EPOCH_1, treeD.root, FAR_FUTURE)

      await expect(
        distributor.connect(alice).batchClaim([
          { campaignId: 'batch-C', epochNumber: EPOCH_1, merkleRoot: treeC.root, oracleSignature: sigC,   deadline: FAR_FUTURE, amount: ALICE_AMOUNT, merkleProof: getProof(treeC, alice.address, ALICE_AMOUNT) },
          { campaignId: 'batch-D', epochNumber: EPOCH_1, merkleRoot: treeD.root, oracleSignature: badSig, deadline: FAR_FUTURE, amount: BOB_AMOUNT,   merkleProof: getProof(treeD, alice.address, BOB_AMOUNT)   },
        ])
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')

      // batch-C should NOT have been claimed (whole tx reverted)
      expect(await distributor.isClaimed('batch-C', EPOCH_1, alice.address)).to.equal(false)
    })

    it('reverts on empty batch', async () => {
      await expect(
        distributor.connect(alice).batchClaim([])
      ).to.be.revertedWith('MintwareDistributor: empty batch')
    })
  })

  // ===========================================================================
  // SECTION 12 — getCampaign() view (new in v2)
  // ===========================================================================

  describe('getCampaign()', () => {
    it('returns zero values for unknown campaign', async () => {
      const info = await distributor.getCampaign('unknown')
      expect(info.token).to.equal(ethers.ZeroAddress)
      expect(info.creator).to.equal(ethers.ZeroAddress)
      expect(info.closed).to.equal(false)
      expect(info.balance).to.equal(0n)
    })

    it('returns correct token, creator, and balance after deposit', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const info = await distributor.getCampaign(CAMPAIGN_ID)
      expect(info.token).to.equal(tokenAddr)
      expect(info.creator).to.equal(alice.address)
      expect(info.closed).to.equal(false)
      expect(info.balance).to.equal(ALICE_AMOUNT)
      expect(info.withdrawableAt).to.equal(0n)  // not closed yet
    })

    it('withdrawableAt is set correctly after close', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      await distributor.connect(owner).closeCampaign(CAMPAIGN_ID)

      const info    = await distributor.getCampaign(CAMPAIGN_ID)
      const now     = BigInt(Math.floor(Date.now() / 1000))
      const sevenDays = BigInt(WITHDRAWAL_COOLDOWN)

      expect(info.closed).to.equal(true)
      // withdrawableAt should be roughly closedAt + 7 days
      expect(info.withdrawableAt).to.be.greaterThan(now + sevenDays - 60n)  // within 60s tolerance
    })
  })
})
