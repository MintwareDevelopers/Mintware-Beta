// =============================================================================
// MintwareDistributor.test.cjs
//
// Hardhat + ethers.js test suite for MintwareDistributor.sol
//
// Run: TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat test --config hardhat.config.cts
//
// Test matrix:
//   - Leaf encoding: solidity computeLeaf() must match @openzeppelin/merkle-tree
//     StandardMerkleTree standardLeafHash() byte-for-byte
//   - createDistribution: success, zero-amount, invalid root, token pull
//   - claim: valid proof succeeds, wrong proof reverts, double claim reverts
//   - pause: blocks claims, unpause re-enables
//   - access control: non-owner cannot createDistribution/pause/unpause
//   - isClaimed: view function state tracking
//
// Written as .cjs so it works with both import() and require() regardless of
// "type": "module" in package.json. Mocha can load .cjs files in ESM projects.
// =============================================================================

'use strict'

const { expect } = require('chai')
const { ethers } = require('hardhat')
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a StandardMerkleTree from (wallet, amount) pairs.
 * @param {Array<[string, bigint]>} entries
 * @returns {StandardMerkleTree}
 */
function buildTree(entries) {
  const values = entries.map(([addr, amt]) => [addr, amt.toString()])
  return StandardMerkleTree.of(values, ['address', 'uint256'])
}

/**
 * Get the Merkle proof for a specific (wallet, amount) pair.
 * @param {StandardMerkleTree} tree
 * @param {string} wallet
 * @param {bigint} amount
 * @returns {string[]}
 */
function getProof(tree, wallet, amount) {
  for (const [i, v] of tree.entries()) {
    if (v[0].toLowerCase() === wallet.toLowerCase() && v[1] === amount.toString()) {
      return tree.getProof(i)
    }
  }
  throw new Error(`Leaf not found in tree: ${wallet} ${amount}`)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MintwareDistributor', function () {
  let owner, alice, bob, carol, stranger
  let distributor
  let token

  const ALICE_AMOUNT = ethers.parseUnits('100', 18)
  const BOB_AMOUNT = ethers.parseUnits('50', 18)
  const CAROL_AMOUNT = ethers.parseUnits('25', 18)
  const TOTAL = ALICE_AMOUNT + BOB_AMOUNT + CAROL_AMOUNT

  beforeEach(async () => {
    ;[owner, alice, bob, carol, stranger] = await ethers.getSigners()

    // Deploy mock ERC-20
    const ERC20Factory = await ethers.getContractFactory('MockERC20')
    token = await ERC20Factory.deploy('Mock Token', 'MTK', 18)
    await token.waitForDeployment()

    // Mint to owner
    await token.mint(owner.address, TOTAL * 10n)

    // Deploy distributor
    const Distributor = await ethers.getContractFactory('MintwareDistributor')
    distributor = await Distributor.deploy(owner.address)
    await distributor.waitForDeployment()

    // Approve distributor to pull tokens
    await token.connect(owner).approve(await distributor.getAddress(), TOTAL * 10n)
  })

  // ===========================================================================
  // SECTION 1 — Leaf encoding verification (CRITICAL)
  //
  // The contract uses:
  //   keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))
  //
  // StandardMerkleTree uses:
  //   keccak256(keccak256(abi.encode(address, uint256)))
  //
  // These must be byte-for-byte identical. Any mismatch means every claim reverts.
  // ===========================================================================

  describe('Leaf encoding — must match StandardMerkleTree exactly', () => {
    it('computeLeaf() matches StandardMerkleTree standardLeafHash for a single entry', async () => {
      const wallet = alice.address
      const amount = ALICE_AMOUNT

      // Off-chain: build a 1-leaf tree. In a 1-leaf tree, root == leaf.
      const tree = buildTree([[wallet, amount]])
      const offChainLeaf = tree.dump().tree[0]

      // On-chain
      const onChainLeaf = await distributor.computeLeaf(wallet, amount)

      expect(onChainLeaf).to.equal(
        offChainLeaf,
        'computeLeaf() must match StandardMerkleTree standardLeafHash'
      )
    })

    it('computeLeaf() matches for all entries in a 3-entry tree', async () => {
      const entries = [
        [alice.address, ALICE_AMOUNT],
        [bob.address, BOB_AMOUNT],
        [carol.address, CAROL_AMOUNT],
      ]

      for (const [addr, amt] of entries) {
        const onChainLeaf = await distributor.computeLeaf(addr, amt)
        const singleTree = buildTree([[addr, amt]])
        const offChainLeaf = singleTree.dump().tree[0]

        expect(onChainLeaf).to.equal(
          offChainLeaf,
          `Leaf mismatch for ${addr}`
        )
      }
    })

    it('uses abi.encode (32-byte padded), NOT abi.encodePacked', async () => {
      // abi.encode(address, uint256) = 64 bytes (address padded to 32 bytes)
      // abi.encodePacked(address, uint256) = 52 bytes
      // The 64-byte ABI encoding is mandatory for StandardMerkleTree compatibility.
      const wallet = alice.address
      const amount = ALICE_AMOUNT

      // ethers AbiCoder.encode = abi.encode (ABI-padded)
      const abiEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [wallet, amount]
      )
      // Should be 64 bytes = 128 hex chars + '0x' prefix
      expect(abiEncoded.length).to.equal(2 + 128, 'abi.encode produces 64 bytes')

      // Double keccak256
      const innerHash = ethers.keccak256(abiEncoded)
      const expectedLeaf = ethers.keccak256(ethers.getBytes(innerHash))

      const onChainLeaf = await distributor.computeLeaf(wallet, amount)
      expect(onChainLeaf).to.equal(expectedLeaf, 'Leaf must use abi.encode (padded), not encodePacked')
    })

    it('proof from StandardMerkleTree verifies successfully in claim() — end-to-end encoding check', async () => {
      const entries = [
        [alice.address, ALICE_AMOUNT],
        [bob.address, BOB_AMOUNT],
      ]
      const tree = buildTree(entries)

      await distributor.createDistribution(tree.root, await token.getAddress(), TOTAL)

      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(
        distributor.connect(alice).claim(0n, ALICE_AMOUNT, proof)
      )
        .to.emit(distributor, 'Claimed')
        .withArgs(0n, alice.address, ALICE_AMOUNT)
    })
  })

  // ===========================================================================
  // SECTION 2 — createDistribution
  // ===========================================================================

  describe('createDistribution()', () => {
    it('creates a distribution and emits DistributionCreated', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])

      await expect(
        distributor.createDistribution(tree.root, await token.getAddress(), ALICE_AMOUNT)
      )
        .to.emit(distributor, 'DistributionCreated')
        .withArgs(0n, tree.root, await token.getAddress(), ALICE_AMOUNT)
    })

    it('increments nextDistributionId', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const tokenAddr = await token.getAddress()

      expect(await distributor.nextDistributionId()).to.equal(0n)
      await distributor.createDistribution(tree.root, tokenAddr, ALICE_AMOUNT)
      expect(await distributor.nextDistributionId()).to.equal(1n)
      await distributor.createDistribution(tree.root, tokenAddr, ALICE_AMOUNT)
      expect(await distributor.nextDistributionId()).to.equal(2n)
    })

    it('pulls tokens from owner into contract', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const tokenAddr = await token.getAddress()

      const ownerBefore = await token.balanceOf(owner.address)
      const contractBefore = await token.balanceOf(await distributor.getAddress())

      await distributor.createDistribution(tree.root, tokenAddr, ALICE_AMOUNT)

      expect(await token.balanceOf(owner.address)).to.equal(ownerBefore - ALICE_AMOUNT)
      expect(await token.balanceOf(await distributor.getAddress())).to.equal(contractBefore + ALICE_AMOUNT)
    })

    it('stores distribution struct correctly', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const tokenAddr = await token.getAddress()

      await distributor.createDistribution(tree.root, tokenAddr, ALICE_AMOUNT)

      const dist = await distributor.getDistribution(0n)
      expect(dist.merkleRoot).to.equal(tree.root)
      expect(dist.token).to.equal(tokenAddr)
      expect(dist.totalAmount).to.equal(ALICE_AMOUNT)
      expect(dist.claimedAmount).to.equal(0n)
      expect(dist.active).to.equal(true)
    })

    it('reverts if merkleRoot is zero', async () => {
      await expect(
        distributor.createDistribution(ethers.ZeroHash, await token.getAddress(), ALICE_AMOUNT)
      ).to.be.revertedWith('MintwareDistributor: invalid merkle root')
    })

    it('reverts if token is zero address', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      await expect(
        distributor.createDistribution(tree.root, ethers.ZeroAddress, ALICE_AMOUNT)
      ).to.be.revertedWith('MintwareDistributor: invalid token')
    })

    it('reverts if totalAmount is zero', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      await expect(
        distributor.createDistribution(tree.root, await token.getAddress(), 0n)
      ).to.be.revertedWith('MintwareDistributor: zero amount')
    })

    it('reverts if called by non-owner', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      await expect(
        distributor.connect(stranger).createDistribution(
          tree.root,
          await token.getAddress(),
          ALICE_AMOUNT
        )
      ).to.be.revertedWithCustomError(distributor, 'OwnableUnauthorizedAccount')
    })
  })

  // ===========================================================================
  // SECTION 3 — claim()
  // ===========================================================================

  describe('claim()', () => {
    let distId
    let tree

    beforeEach(async () => {
      const entries = [
        [alice.address, ALICE_AMOUNT],
        [bob.address, BOB_AMOUNT],
        [carol.address, CAROL_AMOUNT],
      ]
      tree = buildTree(entries)
      await distributor.createDistribution(tree.root, await token.getAddress(), TOTAL)
      distId = 0n
    })

    it('allows a valid claim and transfers tokens', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      const balanceBefore = await token.balanceOf(alice.address)

      await distributor.connect(alice).claim(distId, ALICE_AMOUNT, proof)

      expect(await token.balanceOf(alice.address)).to.equal(balanceBefore + ALICE_AMOUNT)
    })

    it('emits Claimed event with correct args', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await expect(distributor.connect(alice).claim(distId, ALICE_AMOUNT, proof))
        .to.emit(distributor, 'Claimed')
        .withArgs(distId, alice.address, ALICE_AMOUNT)
    })

    it('marks wallet as claimed after successful claim', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      expect(await distributor.isClaimed(distId, alice.address)).to.equal(false)
      await distributor.connect(alice).claim(distId, ALICE_AMOUNT, proof)
      expect(await distributor.isClaimed(distId, alice.address)).to.equal(true)
    })

    it('increments claimedAmount on the distribution', async () => {
      const aliceProof = getProof(tree, alice.address, ALICE_AMOUNT)
      const bobProof = getProof(tree, bob.address, BOB_AMOUNT)

      await distributor.connect(alice).claim(distId, ALICE_AMOUNT, aliceProof)
      expect((await distributor.getDistribution(distId)).claimedAmount).to.equal(ALICE_AMOUNT)

      await distributor.connect(bob).claim(distId, BOB_AMOUNT, bobProof)
      expect((await distributor.getDistribution(distId)).claimedAmount).to.equal(ALICE_AMOUNT + BOB_AMOUNT)
    })

    it('allows all three claimants to claim independently', async () => {
      await distributor.connect(alice).claim(distId, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      await distributor.connect(bob).claim(distId, BOB_AMOUNT, getProof(tree, bob.address, BOB_AMOUNT))
      await distributor.connect(carol).claim(distId, CAROL_AMOUNT, getProof(tree, carol.address, CAROL_AMOUNT))

      expect(await token.balanceOf(alice.address)).to.equal(ALICE_AMOUNT)
      expect(await token.balanceOf(bob.address)).to.equal(BOB_AMOUNT)
      expect(await token.balanceOf(carol.address)).to.equal(CAROL_AMOUNT)
    })

    it('reverts on invalid proof — wrong amount', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).claim(distId, ALICE_AMOUNT + 1n, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on invalid proof — wrong wallet (proof from alice, claiming as stranger)', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(stranger).claim(distId, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on invalid proof — empty proof', async () => {
      await expect(
        distributor.connect(alice).claim(distId, ALICE_AMOUNT, [])
      ).to.be.revertedWith('MintwareDistributor: invalid proof')
    })

    it('reverts on double claim', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)

      await distributor.connect(alice).claim(distId, ALICE_AMOUNT, proof)

      await expect(
        distributor.connect(alice).claim(distId, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: already claimed')
    })

    it('allows same wallet to claim from different distributions independently', async () => {
      const tree2 = buildTree([[alice.address, ALICE_AMOUNT]])
      await distributor.createDistribution(tree2.root, await token.getAddress(), ALICE_AMOUNT)

      await distributor.connect(alice).claim(0n, ALICE_AMOUNT, getProof(tree, alice.address, ALICE_AMOUNT))
      await distributor.connect(alice).claim(1n, ALICE_AMOUNT, getProof(tree2, alice.address, ALICE_AMOUNT))

      expect(await token.balanceOf(alice.address)).to.equal(ALICE_AMOUNT * 2n)
    })

    it('reverts if amount is zero', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).claim(distId, 0n, proof)
      ).to.be.revertedWith('MintwareDistributor: zero amount')
    })

    it('reverts if distribution does not exist (not active)', async () => {
      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await expect(
        distributor.connect(alice).claim(999n, ALICE_AMOUNT, proof)
      ).to.be.revertedWith('MintwareDistributor: distribution not active')
    })
  })

  // ===========================================================================
  // SECTION 4 — pause() / unpause()
  // ===========================================================================

  describe('pause() and unpause()', () => {
    let distId
    let aliceProof
    let tree

    beforeEach(async () => {
      const entries = [[alice.address, ALICE_AMOUNT]]
      tree = buildTree(entries)
      await distributor.createDistribution(tree.root, await token.getAddress(), ALICE_AMOUNT)
      distId = 0n
      aliceProof = getProof(tree, alice.address, ALICE_AMOUNT)
    })

    it('pause() blocks all claims', async () => {
      await distributor.connect(owner).pause()
      await expect(
        distributor.connect(alice).claim(distId, ALICE_AMOUNT, aliceProof)
      ).to.be.revertedWithCustomError(distributor, 'EnforcedPause')
    })

    it('unpause() re-enables claims', async () => {
      await distributor.connect(owner).pause()
      await distributor.connect(owner).unpause()

      await expect(
        distributor.connect(alice).claim(distId, ALICE_AMOUNT, aliceProof)
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

    it('createDistribution() still works while paused — only claims are blocked', async () => {
      await distributor.connect(owner).pause()

      const tree2 = buildTree([[bob.address, BOB_AMOUNT]])
      await expect(
        distributor.createDistribution(tree2.root, await token.getAddress(), BOB_AMOUNT)
      ).to.emit(distributor, 'DistributionCreated')
    })
  })

  // ===========================================================================
  // SECTION 5 — isClaimed() view function
  // ===========================================================================

  describe('isClaimed()', () => {
    it('returns false before claiming', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      await distributor.createDistribution(tree.root, await token.getAddress(), ALICE_AMOUNT)
      expect(await distributor.isClaimed(0n, alice.address)).to.equal(false)
    })

    it('returns true after claiming', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      await distributor.createDistribution(tree.root, await token.getAddress(), ALICE_AMOUNT)

      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await distributor.connect(alice).claim(0n, ALICE_AMOUNT, proof)

      expect(await distributor.isClaimed(0n, alice.address)).to.equal(true)
    })

    it('is distribution-scoped — claiming dist 0 does not set claimed in dist 1', async () => {
      const tree = buildTree([[alice.address, ALICE_AMOUNT]])
      const root = tree.root
      const tokenAddr = await token.getAddress()

      await distributor.createDistribution(root, tokenAddr, ALICE_AMOUNT)
      await distributor.createDistribution(root, tokenAddr, ALICE_AMOUNT)

      const proof = getProof(tree, alice.address, ALICE_AMOUNT)
      await distributor.connect(alice).claim(0n, ALICE_AMOUNT, proof)

      expect(await distributor.isClaimed(0n, alice.address)).to.equal(true)
      expect(await distributor.isClaimed(1n, alice.address)).to.equal(false)
    })
  })
})
