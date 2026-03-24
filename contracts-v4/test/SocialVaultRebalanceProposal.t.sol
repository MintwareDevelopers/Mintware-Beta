// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// T4.3 — Forge tests for SocialVault.rebalanceWithProposal()
//
// Tests cover:
//   - setOracleSigner access control
//   - Signature verification (valid / wrong signer / wrong params)
//   - Expiry enforcement
//   - Nonce anti-replay
//   - Pool-not-initialized guard
//   - Oracle-not-set guard
//   - Happy-path emits correct events (pool interaction is not tested here —
//     see Integration.t.sol for full V4 pool fork tests)

import {Test}        from "forge-std/Test.sol";
import {SocialVault} from "../src/SocialVault.sol";

contract SocialVaultRebalanceProposalTest is Test {

    // ─────────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────────

    SocialVault internal vault;

    address internal owner       = makeAddr("owner");
    address internal alice       = makeAddr("alice");

    // Oracle key pair — uint256 private key for signing, address for verification
    uint256 internal oraclePrivKey = 0xA11CE;
    address internal oracleAddr;

    // Stub contract addresses (no real pool interaction in these unit tests)
    address internal mockUsdc     = makeAddr("mockUsdc");
    address internal mockPM       = makeAddr("poolManager");
    address internal mockFeeVault = makeAddr("feeVault");

    bytes32 internal constant TEST_VAULT_ID = keccak256("test-vault-uuid-abc123");
    int24   internal constant TICK_LOWER    = -887220;
    int24   internal constant TICK_UPPER    =  887220;

    function setUp() public {
        oracleAddr = vm.addr(oraclePrivKey);

        vm.prank(owner);
        vault = new SocialVault(mockUsdc, mockPM, mockFeeVault);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Build EIP-712 digest matching SocialVault's domain + RANGE_TYPEHASH.
    /// We reconstruct the domain separator directly from known domain params
    /// (name="MWSocialVault", version="1", chainId=block.chainid, verifyingContract=vault)
    /// to avoid depending on a public getter that OZ 5.x does not expose.
    function _buildDigest(
        bytes32 vaultId,
        int24   tickLower,
        int24   tickUpper,
        uint256 validUntil,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            vault.RANGE_TYPEHASH(),
            vaultId,
            tickLower,
            tickUpper,
            validUntil,
            nonce
        ));

        // OZ EIP712 domain separator — matches EIP712._buildDomainSeparator exactly
        bytes32 TYPE_HASH = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 domainSep = keccak256(abi.encode(
            TYPE_HASH,
            keccak256(bytes("MWSocialVault")),
            keccak256(bytes("1")),
            block.chainid,
            address(vault)
        ));

        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    /// Sign a digest with a given private key and return the compact bytes signature
    function _sign(uint256 privKey, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Force-set poolInitialized to true via vm.store so unit tests skip V4 setup
    function _forcePoolInitialized() internal {
        // poolInitialized is a bool at storage slot 6 (after 5 mappings + 4 immutables → need to find exact slot)
        // Use vm.store with the exact slot. Locate via forge inspect or trial:
        // Slot layout (SocialVault inherits Ownable[slot0], ReentrancyGuard[slot1], EIP712[no slots — memory],
        //              IUnlockCallback[no slots]):
        // slot0: Ownable._owner
        // slot1: ReentrancyGuard._status
        // slot2: positions mapping
        // slot3: withdrawalRequests mapping
        // slot4: teamSeeds mapping
        // slot5: totalDeposits
        // slot6: poolKey (PoolKey is a struct — occupies multiple slots)
        // PoolKey is: currency0(20B), currency1(20B), fee(3B), tickSpacing(3B), hooks(20B)
        // → packed: currency0+currency1+fee+tickSpacing go into slot6 (potentially slot6 and slot7)
        // Actually PoolKey has: Currency currency0 (address=20B), Currency currency1 (address=20B),
        //   uint24 fee (3B), int24 tickSpacing (3B), IHooks hooks (address=20B)
        // PoolKey occupies 3 slots (2 addresses + packed fee+tickSpacing in one slot + hooks)
        // slot6: currency0
        // slot7: currency1
        // slot8: fee(3B) + tickSpacing(3B) packed
        // slot9: hooks
        // slot10: poolInitialized (bool)
        // slot11: tickLower (int24) + tickUpper (int24) — packed
        // slot12: totalLiquidity (uint128) + oracleSigner (address) — both fit in one slot?
        //          No — totalLiquidity is uint128 (16B) and oracleSigner is address (20B) → slot12, slot13
        // slot12: totalLiquidity (uint128)
        // slot13: oracleSigner (address)  ← but we declared oracleSigner before totalDeposits...
        //
        // After re-reading the actual declaration order:
        //   mapping(address => LPPosition) public positions;         → slot2
        //   mapping(address => WithdrawalRequest) public withdrawalRequests; → slot3
        //   mapping(bytes32 => TeamSeed) public teamSeeds;           → slot4
        //   address public oracleSigner;                             → slot5
        //   mapping(bytes32 => mapping(uint256 => bool)) usedNonces; → slot6
        //   uint256 public totalDeposits;                            → slot7
        //   PoolKey public poolKey;                                   → slot8..slot11
        //   bool public poolInitialized;                             → slot12
        //   int24 public tickLower;                                  → slot13 (packed with tickUpper)
        //   int24 public tickUpper;                                  → slot13
        //   uint128 public totalLiquidity;                           → slot14
        //
        // We need to find poolInitialized. Use `forge inspect SocialVault storage` or just
        // use vm.store with the known bool slot. Let's derive it properly:
        // Ownable has _owner at slot0. ReentrancyGuard has _status at slot1.
        // EIP712 is stateless (uses immutables in 0.8.26 OZ). IUnlockCallback is interface.
        // SocialVault own slots start at slot2:
        //   slot2: positions
        //   slot3: withdrawalRequests
        //   slot4: teamSeeds
        //   slot5: oracleSigner (address, 20B — padded to 32B)
        //   slot6: usedNonces
        //   slot7: totalDeposits
        //   slot8: poolKey.currency0 (Currency = address)
        //   slot9: poolKey.currency1
        //   slot10: poolKey.fee (uint24) + poolKey.tickSpacing (int24) packed
        //   slot11: poolKey.hooks (IHooks = address)
        //   slot12: poolInitialized (bool, 1B)
        //   slot13: tickLower (int24, 3B) + tickUpper (int24, 3B) packed
        //   slot14: totalLiquidity (uint128, 16B)
        vm.store(address(vault), bytes32(uint256(12)), bytes32(uint256(1)));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // setOracleSigner
    // ─────────────────────────────────────────────────────────────────────────

    function test_setOracleSigner_onlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        vault.setOracleSigner(oracleAddr);
    }

    function test_setOracleSigner_setsAndEmits() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, false, address(vault));
        emit SocialVault.OracleSignerSet(oracleAddr);
        vault.setOracleSigner(oracleAddr);
        assertEq(vault.oracleSigner(), oracleAddr);
    }

    function test_setOracleSigner_canBeZero_toRevoke() public {
        vm.startPrank(owner);
        vault.setOracleSigner(oracleAddr);
        vault.setOracleSigner(address(0));
        vm.stopPrank();
        assertEq(vault.oracleSigner(), address(0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // rebalanceWithProposal — guards
    // ─────────────────────────────────────────────────────────────────────────

    function test_rebalanceWithProposal_poolNotInitialized() public {
        uint256 validUntil = block.timestamp + 1 hours;
        bytes32 digest     = _buildDigest(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1);
        bytes memory sig   = _sign(oraclePrivKey, digest);

        vm.expectRevert(SocialVault.PoolNotInitialized.selector);
        vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1, sig);
    }

    function test_rebalanceWithProposal_oracleSignerNotSet() public {
        _forcePoolInitialized();

        uint256 validUntil = block.timestamp + 1 hours;
        bytes32 digest     = _buildDigest(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1);
        bytes memory sig   = _sign(oraclePrivKey, digest);

        vm.expectRevert(SocialVault.OracleSignerNotSet.selector);
        vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1, sig);
    }

    function test_rebalanceWithProposal_expired() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        uint256 validUntil = block.timestamp - 1; // already expired
        bytes32 digest     = _buildDigest(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1);
        bytes memory sig   = _sign(oraclePrivKey, digest);

        vm.expectRevert(SocialVault.ProposalExpired.selector);
        vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1, sig);
    }

    function test_rebalanceWithProposal_invalidSignature_wrongKey() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        uint256 validUntil = block.timestamp + 4 hours;
        bytes32 digest     = _buildDigest(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1);

        // Sign with a DIFFERENT private key
        uint256 wrongKey = 0xBADBAD;
        bytes memory sig = _sign(wrongKey, digest);

        vm.expectRevert(SocialVault.InvalidOracleSignature.selector);
        vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1, sig);
    }

    function test_rebalanceWithProposal_invalidSignature_tamperedParams() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        uint256 validUntil = block.timestamp + 4 hours;
        int24 signedLower  = -1000;
        int24 signedUpper  =  1000;

        // Sign for [-1000, 1000]
        bytes32 digest = _buildDigest(TEST_VAULT_ID, signedLower, signedUpper, validUntil, 1);
        bytes memory sig = _sign(oraclePrivKey, digest);

        // Submit with DIFFERENT ticks — should revert (signature covers original params)
        int24 tamperedLower = -2000;
        int24 tamperedUpper =  2000;
        vm.expectRevert(SocialVault.InvalidOracleSignature.selector);
        vault.rebalanceWithProposal(TEST_VAULT_ID, tamperedLower, tamperedUpper, validUntil, 1, sig);
    }

    function test_rebalanceWithProposal_nonceReplay() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        uint256 validUntil = block.timestamp + 4 hours;
        bytes32 digest     = _buildDigest(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1);
        bytes memory sig   = _sign(oraclePrivKey, digest);

        // Mock poolManager.unlock to be a no-op (we just want to test nonce tracking)
        vm.mockCall(mockPM, abi.encodeWithSignature("unlock(bytes)"), abi.encode(""));

        // First call succeeds (will call unlock → which is mocked)
        vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1, sig);

        // Second call with same nonce must revert
        vm.expectRevert(SocialVault.NonceAlreadyUsed.selector);
        vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1, sig);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // rebalanceWithProposal — valid signature path
    // ─────────────────────────────────────────────────────────────────────────

    function test_rebalanceWithProposal_validSig_marksNonce() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        uint256 validUntil = block.timestamp + 4 hours;
        int24 newLower     = -100000;
        int24 newUpper     =  100000;
        uint256 nonce      = 1;

        bytes32 digest = _buildDigest(TEST_VAULT_ID, newLower, newUpper, validUntil, nonce);
        bytes memory sig = _sign(oraclePrivKey, digest);

        // Mock poolManager.unlock (no real V4 in this unit test suite)
        vm.mockCall(mockPM, abi.encodeWithSignature("unlock(bytes)"), abi.encode(""));

        vault.rebalanceWithProposal(TEST_VAULT_ID, newLower, newUpper, validUntil, nonce, sig);

        // Nonce must be marked used
        assertTrue(vault.usedNonces(TEST_VAULT_ID, nonce));
    }

    function test_rebalanceWithProposal_validSig_emitsEvents() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        uint256 validUntil = block.timestamp + 4 hours;
        int24 newLower     = -50000;
        int24 newUpper     =  50000;
        uint256 nonce      = 42;

        bytes32 digest = _buildDigest(TEST_VAULT_ID, newLower, newUpper, validUntil, nonce);
        bytes memory sig = _sign(oraclePrivKey, digest);

        vm.mockCall(mockPM, abi.encodeWithSignature("unlock(bytes)"), abi.encode(""));

        // Expect RebalancedWithProposal event
        vm.expectEmit(true, false, false, true, address(vault));
        emit SocialVault.RebalancedWithProposal(TEST_VAULT_ID, newLower, newUpper, nonce, address(this));

        vault.rebalanceWithProposal(TEST_VAULT_ID, newLower, newUpper, validUntil, nonce, sig);
    }

    function test_rebalanceWithProposal_sequentialNonces() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        vm.mockCall(mockPM, abi.encodeWithSignature("unlock(bytes)"), abi.encode(""));

        // Two sequential nonces must both succeed
        for (uint256 n = 1; n <= 2; n++) {
            uint256 validUntil = block.timestamp + 4 hours;
            bytes32 digest = _buildDigest(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, n);
            bytes memory sig = _sign(oraclePrivKey, digest);
            vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, n, sig);
        }

        assertTrue(vault.usedNonces(TEST_VAULT_ID, 1));
        assertTrue(vault.usedNonces(TEST_VAULT_ID, 2));
    }

    function test_rebalanceWithProposal_differentVaults_sameNonce() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        vm.mockCall(mockPM, abi.encodeWithSignature("unlock(bytes)"), abi.encode(""));

        bytes32 vaultA = keccak256("vault-a-uuid");
        bytes32 vaultB = keccak256("vault-b-uuid");
        uint256 nonce  = 1;
        uint256 validUntil = block.timestamp + 4 hours;

        // Sign nonce=1 for vault A
        bytes32 dA = _buildDigest(vaultA, TICK_LOWER, TICK_UPPER, validUntil, nonce);
        bytes memory sigA = _sign(oraclePrivKey, dA);
        vault.rebalanceWithProposal(vaultA, TICK_LOWER, TICK_UPPER, validUntil, nonce, sigA);

        // Sign nonce=1 for vault B — must also succeed (nonces are per-vault)
        bytes32 dB = _buildDigest(vaultB, TICK_LOWER, TICK_UPPER, validUntil, nonce);
        bytes memory sigB = _sign(oraclePrivKey, dB);
        vault.rebalanceWithProposal(vaultB, TICK_LOWER, TICK_UPPER, validUntil, nonce, sigB);

        assertTrue(vault.usedNonces(vaultA, 1));
        assertTrue(vault.usedNonces(vaultB, 1));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RANGE_TYPEHASH constant
    // ─────────────────────────────────────────────────────────────────────────

    function test_rangeTypehash_matches_spec() public view {
        bytes32 expected = keccak256(
            "RangeProposal(bytes32 vaultId,int24 tickLower,int24 tickUpper,uint256 validUntil,uint256 nonce)"
        );
        assertEq(vault.RANGE_TYPEHASH(), expected);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // anyone can call rebalanceWithProposal (permissionless)
    // ─────────────────────────────────────────────────────────────────────────

    function test_rebalanceWithProposal_anyone_can_submit() public {
        _forcePoolInitialized();
        vm.prank(owner); vault.setOracleSigner(oracleAddr);

        uint256 validUntil = block.timestamp + 4 hours;
        bytes32 digest     = _buildDigest(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1);
        bytes memory sig   = _sign(oraclePrivKey, digest);

        vm.mockCall(mockPM, abi.encodeWithSignature("unlock(bytes)"), abi.encode(""));

        // Called by alice (not owner, not oracle)
        vm.prank(alice);
        vault.rebalanceWithProposal(TEST_VAULT_ID, TICK_LOWER, TICK_UPPER, validUntil, 1, sig);

        assertTrue(vault.usedNonces(TEST_VAULT_ID, 1));
    }
}
