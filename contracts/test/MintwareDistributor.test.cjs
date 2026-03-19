// =============================================================================
// MintwareDistributor.test.cjs
//
// Hardhat + ethers.js test suite for the zero-oracle-gas MintwareDistributor.
//
// Run: pnpm hardhat:test
//
// Architecture under test:
//   - depositCampaign()  — team deposits tokens (they pay gas once)
//   - Oracle signs root  — EIP-712, off-chain, zero gas
//   - claim()            — user submits proof + oracle signature (they pay gas)
//
// Test matrix:
//   Section 1 — Leaf encoding: computeLeaf() must match StandardMerkleTree exactly
//   Section 2 — depositCampaign(): success, one-token enforcement, zero guards
//   Section 3 — Oracle EIP-712 signing: getRootDigest(), sig verification
//   Section 4 — claim(): valid proof+sig, invalid sig, invalid proof, double claim
//   Section 5 — Multi-epoch: same wallet, different epochs → independent
//   Section 6 — Multi-campaign: different campaignIds → isolated balances
//   Section 7 — pause() / unpause(): blocks both deposit and claim
//   Section 8 — isClaimed() view function state tracking
//   Section 9 — Access control: only owner can pause/unpause
//
// Written as .cjs — required for Mocha in ESM projects ("type":"module" in package.json).
// =============================================================================

'use strict'

const { expect } = require('chai')
const { ethers } = require('hardhat')
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree')

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
 * Build the EIP-712 typed data params for the oracle to sign.
 * @param {string} contractAddress — deployed MintwareDistributor address
 * @param {bigint} chainId
 * @param {string} campaignId
 * @param {bigint} epochNumber
 * @param {string} merkleRoot — hex bytes32
 */
function buildTypedData(contractAddress, chainId, campaignId, epochNumber, merkleRoot) {
  return {
    domain: {
      name: 'MintwareDistributor',
      version: '1',
      chainId,
      verifyingContract: contractAddress,
    },
    types: {
      RootPublication: [
        { name: 'campaignId', type: 'string' },
        { name: 'epochNumber', type: 'uint256' },
        { name: 'merkleRoot', type: 'bytes32' },
      ],
    },
    message: { campaignId, epochNumber, merkleRoot },
  }
}

/** Sign the Merkle root as the oracle using EIP-712 */
async function oracleSign(oracle, contractAddress, chainId, campaignId, epochNumber, merkleRoot) {
  const { domain, types, message } = buildTypedData(
    contractAddress, chainId, campaignId, epochNumber, merkleRoot
  )
  return oracle.signTypedData(domain, types, message)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MintwareDistributor', function () {
  let owner, oracle, alice, bob, carol, stranger
  let distributor
  let token
  let chainId
  let distributorAddress

  const CAMPAIGN_ID = 'campaign-abc-123'
  const EPOCH_1 = 1n
  const EPOCH_2 = 2n

  const ALICE_AMOUNT = ethers.parseUnits('100', 18)
  const BOB_AMOUNT   = ethers.parseUnits('50', 18)
  const CAROL_AMOUNT = ethers.parseUnits('25', 18)
  const TOTAL        = ALICE_AMOUNT + BOB_AMOUNT + CAROL_AMOUNT

  beforeEach(async () => {
    ;[owner, oracle, alice, bob, carol, stranger] = await ethers.getSigners()

    const network = await ethers.provider.getNetwork()
    chainId = network.chainId

    // Deploy mock ERC-20
    const ERC20 = await ethers.getContractFactory('MockERC20')
    token = await ERC20.deploy('Mock Token', 'MTK', 18)
    await token.waitForDeployment()

    // Deploy distributor: oracle signs roots, owner can pause
    const Distributor = await ethers.getContractFactory('MintwareDistributor')
    distributor = await Distributor.deploy(oracle.address, owner.address)
    await distributor.waitForDeployment()
    distributorAddress = await distributor.getAddress()

    // Fund alice with enough tokens to deposit for tests
    await token.mint(alice.address, TOTAL * 10n)
    await token.connect(alice).approve(distributorAddress, TOTAL * 10n)
  })

  // ===========================================================================
  // SECTION 1 — Leaf encoding verification (CRITICAL)
  // ===========================================================================

  describe('Leaf encoding — must match StandardMerkleTree exactly', () => {
    it('computeLeaf() matches StandardMerkleTree for a single entry', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
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
    it('deposits tokens and emits CampaignFunded', async () => {
      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, await token.getAddress(), ALICE_AMOUNT)
      )
        .to.emit(distributor, 'CampaignFunded')
        .withArgs(CAMPAIGN_ID, await token.getAddress(), ALICE_AMOUNT, alice.address)
    })

    it('pulls tokens from depositor into contract', async () => {
      const tokenAddr    = await token.getAddress()
      const beforeAlice  = await token.balanceOf(alice.address)
      const beforeContract = await token.balanceOf(distributorAddress)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      expect(await token.balanceOf(alice.address)).to.equal(beforeAlice - ALICE_AMOUNT)
      expect(await token.balanceOf(distributorAddress)).to.equal(beforeContract + ALICE_AMOUNT)
    })

    it('sets campaignToken on first deposit', async () => {
      const tokenAddr = await token.getAddress()
      expect(await distributor.campaignToken(CAMPAIGN_ID)).to.equal(ethers.ZeroAddress)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      expect(await distributor.campaignToken(CAMPAIGN_ID)).to.equal(tokenAddr)
    })

    it('tracks campaignBalances correctly', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      expect(await distributor.campaignBalances(CAMPAIGN_ID)).to.equal(ALICE_AMOUNT)

      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, BOB_AMOUNT)
      expect(await distributor.campaignBalances(CAMPAIGN_ID)).to.equal(ALICE_AMOUNT + BOB_AMOUNT)
    })

    it('allows top-up deposits to the same campaign with the same token', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, BOB_AMOUNT)
      ).to.not.be.reverted
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
  // SECTION 3 — EIP-712 oracle signing
  // ===========================================================================

  describe('Oracle EIP-712 signing', () => {
    it('getRootDigest() matches the digest ethers computes for the same inputs', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const { domain, types, message } = buildTypedData(
        distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root
      )

      const offChainDigest = ethers.TypedDataEncoder.hash(domain, types, message)
      const onChainDigest  = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root)

      expect(onChainDigest).to.equal(offChainDigest)
    })

    it('oracle signature over digest is recoverable to oracle.address', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)

      const digest    = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root)
      const recovered = ethers.recoverAddress(digest, sig)

      expect(recovered.toLowerCase()).to.equal(oracle.address.toLowerCase())
    })

    it('signature from a non-oracle signer does not recover to ORACLE_SIGNER', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(stranger, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)

      const digest    = await distributor.getRootDigest(CAMPAIGN_ID, EPOCH_1, tree.root)
      const recovered = ethers.recoverAddress(digest, sig)

      expect(recovered.toLowerCase()).to.not.equal(oracle.address.toLowerCase())
    })

    it('ORACLE_SIGNER storage variable matches the oracle address passed to constructor', async () => {
      expect(await distributor.ORACLE_SIGNER()).to.equal(oracle.address)
    })
  })

  // ===========================================================================
  // SECTION 4 — claim()
  // ===========================================================================

  describe('claim()', () => {
    let tree
    let oracleSig

    beforeEach(async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, TOTAL)

      const entries = [
        [alice.address, ALICE_AMOUNT],
        [bob.address,   BOB_AMOUNT],
        [carol.address, CAROL_AMOUNT],
      ]
      tree = buildTree(entries)
      oracleSig = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)
    })

    it('valid proof + valid oracle sig transfers tokens to claimant', async () => {
      const proof  = getProof(tree, alice.address, ALICE_AMOUNT)
      const before = await token.balanceOf(alice.address)

      await distributor.connect(alice).claim(
        CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT, proof
      )

      expect(await token.balanceOf(alice.address)).to.equal(before + ALICE_AMOUNT)
    })

    it('emits Claimed with correct args', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT, proof)
      )
        .to.emit(distributor, 'Claimed')
        .withArgs(CAMPAIGN_ID, EPOCH_1, alice.address, ALICE_AMOUNT)
    })

    it('decrements campaignBalances by claimed amount', async () => {
      const before = await distributor.campaignBalances(CAMPAIGN_ID)
      await distributor.connect(alice).claim(
        CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT,
        getProof(tree, alice.address, ALICE_AMOUNT)
      )
      expect(await distributor.campaignBalances(CAMPAIGN_ID)).to.equal(before - ALICE_AMOUNT)
    })

    it('all three claimants can claim independently', async () => {
      // alice starts with a pre-minted balance — track delta, not absolute
      const aliceBefore = await token.balanceOf(alice.address)

      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      await distributor.connect(bob).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, BOB_AMOUNT, getProof(tree, bob.address, BOB_AMOUNT))
      await distributor.connect(carol).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, CAROL_AMOUNT, getProof(tree, carol.address, CAROL_AMOUNT))

      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore + ALICE_AMOUNT)
      expect(await token.balanceOf(bob.address)).to.equal(BOB_AMOUNT)     // bob starts at 0
      expect(await token.balanceOf(carol.address)).to.equal(CAROL_AMOUNT) // carol starts at 0
    })

    it('reverts on invalid oracle signature (signed by stranger)', async () => {
      const strangerSig = await oracleSign(stranger, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, strangerSig, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })

    it('reverts on invalid oracle signature (wrong campaign id in sig)', async () => {
      const wrongSig = await oracleSign(oracle, distributorAddress, chainId, 'wrong-campaign', EPOCH_1, tree.root)
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, wrongSig, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })

    it('reverts on invalid oracle signature (wrong epoch in sig)', async () => {
      const wrongSig = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_2, tree.root)
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, wrongSig, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })

    it('reverts on invalid proof — wrong amount', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT + 1n, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on invalid proof — wrong wallet (alice proof, claiming as stranger)', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(stranger).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on empty proof', async () => {
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT, [])
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on double claim within same epoch', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT, proof)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: already claimed')
    })

    it('reverts if amount is zero', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, oracleSig, 0n, proof)
      ).to.be.revertedWith('MintwareDistributor: zero amount')
    })

    it('reverts if campaign has no balance (not funded)', async () => {
      const unfundedTree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig = await oracleSign(oracle, distributorAddress, chainId, 'unfunded', EPOCH_1, unfundedTree.root)
      const proof = getProof(unfundedTree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim('unfunded', EPOCH_1, unfundedTree.root, sig, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: campaign not funded')
    })

    it('proof verifies end-to-end — encoding check', async () => {
      // Deposit exact amount for 1-leaf tree
      await token.mint(owner.address, ALICE_AMOUNT)
      await token.connect(owner).approve(distributorAddress, ALICE_AMOUNT)

      const singleTree = buildTree([[alice.address, ALICE_AMOUNT]])
      await distributor.connect(owner).depositCampaign('single', await token.getAddress(), ALICE_AMOUNT)

      const sig   = await oracleSign(oracle, distributorAddress, chainId, 'single', EPOCH_1, singleTree.root)
      const proof = getProof(singleTree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim('single', EPOCH_1, singleTree.root, sig, ALICE_AMOUNT, proof)
      )
        .to.emit(distributor, 'Claimed')
        .withArgs('single', EPOCH_1, alice.address, ALICE_AMOUNT)
    })
  })

  // ===========================================================================
  // SECTION 5 — Multi-epoch independence
  // ===========================================================================

  describe('Multi-epoch independence', () => {
    it('same wallet can claim from different epochs of the same campaign', async () => {
      const tokenAddr = await token.getAddress()
      // alice deposits 2*ALICE_AMOUNT, then claims it back across two epochs — net 0 delta
      const aliceBefore = await token.balanceOf(alice.address)
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT * 2n)

      const tree1 = buildTree([[alice.address, ALICE_AMOUNT]])
      const tree2 = buildTree([[alice.address, ALICE_AMOUNT]])

      const sig1 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree1.root)
      const sig2 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_2, tree2.root)

      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree1.root, sig1, ALICE_AMOUNT, getProof(tree1, alice.address, ALICE_AMOUNT))
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_2, tree2.root, sig2, ALICE_AMOUNT, getProof(tree2, alice.address, ALICE_AMOUNT))

      // Net delta = 0: deposited 2*ALICE, claimed 2*ALICE back
      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore)
      // Both epochs are now marked claimed
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_2, alice.address)).to.equal(true)
    })

    it('claiming epoch 1 does not affect claimed state for epoch 2', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT * 2n)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig1 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)

      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig1, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))

      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_2, alice.address)).to.equal(false)
    })

    it('epoch 2 signature cannot replay as epoch 1', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      // Sign for epoch 2 but try to use it as epoch 1
      const sig2 = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_2, tree.root)

      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig2, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })
  })

  // ===========================================================================
  // SECTION 6 — Multi-campaign isolation
  // ===========================================================================

  describe('Multi-campaign isolation', () => {
    it('different campaignIds have independent balances and claimed state', async () => {
      const tokenAddr = await token.getAddress()
      // alice deposits ALICE + BOB, claims both back — net 0 delta
      const aliceBefore = await token.balanceOf(alice.address)

      await distributor.connect(alice).depositCampaign('camp-A', tokenAddr, ALICE_AMOUNT)
      await distributor.connect(alice).depositCampaign('camp-B', tokenAddr, BOB_AMOUNT)

      const treeA = buildTree([[alice.address, ALICE_AMOUNT]])
      const treeB = buildTree([[alice.address, BOB_AMOUNT]])

      const sigA = await oracleSign(oracle, distributorAddress, chainId, 'camp-A', EPOCH_1, treeA.root)
      const sigB = await oracleSign(oracle, distributorAddress, chainId, 'camp-B', EPOCH_1, treeB.root)

      await distributor.connect(alice).claim('camp-A', EPOCH_1, treeA.root, sigA, ALICE_AMOUNT, getProof(treeA, alice.address, ALICE_AMOUNT))
      await distributor.connect(alice).claim('camp-B', EPOCH_1, treeB.root, sigB, BOB_AMOUNT,   getProof(treeB, alice.address, BOB_AMOUNT))

      // Net delta = 0: deposited ALICE+BOB, claimed ALICE+BOB back
      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore)
      // Both campaigns are independently claimed
      expect(await distributor.isClaimed('camp-A', EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed('camp-B', EPOCH_1, alice.address)).to.equal(true)
    })

    it('campaign A signature cannot be replayed for campaign B', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign('camp-A', tokenAddr, ALICE_AMOUNT)
      await distributor.connect(alice).depositCampaign('camp-B', tokenAddr, ALICE_AMOUNT)

      const treeA = buildTree([[alice.address, ALICE_AMOUNT]])
      // Sign for camp-A, try to use in camp-B
      const sigA = await oracleSign(oracle, distributorAddress, chainId, 'camp-A', EPOCH_1, treeA.root)

      await expect(
        distributor.connect(alice).claim('camp-B', EPOCH_1, treeA.root, sigA, ALICE_AMOUNT, getProof(treeA, alice.address, ALICE_AMOUNT))
      ).to.be.revertedWith('MintwareDistributor: invalid oracle signature')
    })
  })

  // ===========================================================================
  // SECTION 7 — pause() and unpause()
  // ===========================================================================

  describe('pause() and unpause()', () => {
    let tree, sig

    beforeEach(async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      tree = buildTree([[alice.address, ALICE_AMOUNT]])
      sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)
    })

    it('pause() blocks claim()', async () => {
      await distributor.connect(owner).pause()
      await expect(
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
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
        distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      ).to.emit(distributor, 'Claimed')
    })

    it('pause() reverts if called by non-owner', async () => {
      await expect(
        distributor.connect(stranger).pause()
      ).to.be.revertedWithCustomError(distributor, 'OwnableUnauthorizedAccount')
    })

    it('unpause() reverts if called by non-owner', async () => {
      await distributor.connect(owner).pause()
      await expect(
        distributor.connect(stranger).unpause()
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
      const sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))

      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
    })

    it('is (campaign, epoch)-scoped — claiming epoch 1 does not set epoch 2', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign(CAMPAIGN_ID, tokenAddr, ALICE_AMOUNT)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(oracle, distributorAddress, chainId, CAMPAIGN_ID, EPOCH_1, tree.root)
      await distributor.connect(alice).claim(CAMPAIGN_ID, EPOCH_1, tree.root, sig, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))

      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed(CAMPAIGN_ID, EPOCH_2, alice.address)).to.equal(false)
    })

    it('is campaign-scoped — claiming camp-A does not set camp-B', async () => {
      const tokenAddr = await token.getAddress()
      await distributor.connect(alice).depositCampaign('camp-A', tokenAddr, ALICE_AMOUNT)

      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const sig  = await oracleSign(oracle, distributorAddress, chainId, 'camp-A', EPOCH_1, tree.root)
      await distributor.connect(alice).claim('camp-A', EPOCH_1, tree.root, sig, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))

      expect(await distributor.isClaimed('camp-A', EPOCH_1, alice.address)).to.equal(true)
      expect(await distributor.isClaimed('camp-B', EPOCH_1, alice.address)).to.equal(false)
    })
  })
})
