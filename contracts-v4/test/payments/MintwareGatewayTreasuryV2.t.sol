// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";
import {MintwareTreasuryVault}  from "../../src/payments/MintwareTreasuryVault.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @notice END-TO-END proof that a card charge settles against the v2 treasury vault through the REAL
///         `MintwarePaymentGateway`: relayer submits `settleSpend` → the Gateway re-verifies the user's
///         EIP-712 `DelegatedSpendPermit` (and, for ≥ $250, an EDGE_SIGNER `ShortLivedHoldAuth`) →
///         `MintwareTreasuryVault.burnForPayment` burns the user's senior shares → USDC lands at the card
///         rail. Signatures are produced with `vm.sign` over the Gateway's OWN EIP-712 domain, so this is
///         the exact path the off-chain edge/relayer stack drives on-chain — nothing mocked but the ERC20s
///         and the Aave adapter.
///
/// @dev    The whole reason v2 exists is card settlement; until now the vault's `burnForPayment` was only
///         exercised by a mock gateway. This wires the actual Gateway to the actual v2 vault.
contract MintwareGatewayTreasuryV2Test is Test {
    MockERC20                usdc; // 6dp senior settlement asset
    MockERC20                team; // 18dp junior token
    MockYieldAdapter         adapter;
    MintwareTreasuryVault    vault;
    MintwarePaymentGateway   gateway;

    address internal owner     = makeAddr("owner");
    address internal teamAddr   = makeAddr("team");
    address internal circleCpn  = makeAddr("circleCpn"); // default rail treasury
    address internal receiver   = makeAddr("cardRail");   // explicit rail for a charge

    address internal user; uint256 internal userPk;
    address internal edge; uint256 internal edgePk;

    uint256 internal constant ONE = 1e6;

    function setUp() public {
        (user, userPk) = makeAddrAndKey("user");
        (edge, edgePk) = makeAddrAndKey("edge");

        usdc    = new MockERC20("USD Coin", "USDC", 6);
        team    = new MockERC20("Team Token", "TEAM", 18);
        adapter = new MockYieldAdapter(address(usdc));
        vault   = new MintwareTreasuryVault(address(usdc), address(team), address(adapter), owner);

        // Gateway admin = this test contract → it holds RELAYER_ROLE + EDGE_SIGNER_ROLE + DEFAULT_ADMIN.
        gateway = new MintwarePaymentGateway(address(vault), address(usdc), circleCpn, address(this));

        vm.prank(owner);
        vault.setGateway(address(gateway)); // the Gateway is now the sole burnForPayment caller

        // Team commits the junior reserve to activate the vault (pure-ETH tranche; juniorUSDC = 0).
        team.mint(teamAddr, 5_000_000 ether);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000 ether, 0, 365 days);
        vm.stopPrank();

        // User deposits $1,000 senior.
        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(1_000 * ONE, 0, user);
        vm.stopPrank();

        // A real EDGE_SIGNER EOA (the test contract is admin but can't sign, being a contract).
        gateway.grantRole(gateway.EDGE_SIGNER_ROLE(), edge);
    }

    // ── EIP-712 signing helpers (over the Gateway's own domain) ──────────────

    function _permit(uint256 maxDaily, uint256 nonce, uint256 deadline)
        internal view returns (MintwarePaymentGateway.DelegatedSpendPermit memory)
    {
        return MintwarePaymentGateway.DelegatedSpendPermit({
            user: user, maxDailySpendUSDC: maxDaily, nonce: nonce, deadline: deadline
        });
    }

    function _signPermit(uint256 pk, MintwarePaymentGateway.DelegatedSpendPermit memory p)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            gateway.DELEGATED_SPEND_PERMIT_TYPEHASH(), p.user, p.maxDailySpendUSDC, p.nonce, p.deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _edgeAuth(bytes32 holdId, uint256 amount, uint256 expiry)
        internal view returns (MintwarePaymentGateway.ShortLivedHoldAuth memory)
    {
        return MintwarePaymentGateway.ShortLivedHoldAuth({
            holdId: holdId, user: user, amountUSDC: amount, nonce: 1, expiry: expiry
        });
    }

    function _signEdge(uint256 pk, MintwarePaymentGateway.ShortLivedHoldAuth memory e)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            gateway.SHORT_LIVED_HOLD_AUTH_TYPEHASH(), e.holdId, e.user, e.amountUSDC, e.nonce, e.expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _emptyEdge() internal pure returns (MintwarePaymentGateway.ShortLivedHoldAuth memory e) {}

    // ── happy paths ──────────────────────────────────────────────────────────

    function test_lowValue_settles_permitOnly() public {
        uint256 assets = 100 * ONE; // $100 < $250 → no edge auth needed
        bytes32 holdId = keccak256("hold-low");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(500 * ONE, 1, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);

        uint256 cpnBefore = usdc.balanceOf(circleCpn);
        uint256 rcvBefore = usdc.balanceOf(receiver);
        uint256 shBefore  = vault.seniorShares(user);

        uint256 burned = gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");

        assertGt(burned, 0, "no shares burned");
        // AUDIT C1: the passed `receiver` is IGNORED — settlement always lands at the circle treasury.
        assertEq(usdc.balanceOf(receiver), rcvBefore, "receiver arg must be ignored, not paid");
        assertGe(usdc.balanceOf(circleCpn) - cpnBefore, assets, "treasury underpaid vs the charge");
        assertApproxEqAbs(usdc.balanceOf(circleCpn) - cpnBefore, assets, 2, "treasury overpaid beyond dust");
        assertLt(vault.seniorShares(user), shBefore, "user shares not burned");
        ( , , , bool settled, ) = gateway.holds(holdId);
        assertTrue(settled, "hold not marked settled");
    }

    function test_highValue_settles_withEdgeAuth() public {
        uint256 assets = 300 * ONE; // >= $250 → edge auth required
        bytes32 holdId = keccak256("hold-high");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 2, block.timestamp + 1 days);
        bytes memory pSig = _signPermit(userPk, p);
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = _edgeAuth(holdId, assets, block.timestamp + 240);
        bytes memory eSig = _signEdge(edgePk, e);

        uint256 cpnBefore = usdc.balanceOf(circleCpn);
        gateway.settleSpend(holdId, user, assets, receiver, p, pSig, e, eSig);
        assertGe(usdc.balanceOf(circleCpn) - cpnBefore, assets, "high-value treasury underpaid");
        assertEq(usdc.balanceOf(receiver), 0, "receiver arg must be ignored (C1)");
    }

    function test_zeroReceiver_routesToCircleTreasury() public {
        uint256 assets = 100 * ONE;
        bytes32 holdId = keccak256("hold-default-rail");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(500 * ONE, 3, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);

        uint256 cpnBefore = usdc.balanceOf(circleCpn);
        gateway.settleSpend(holdId, user, assets, address(0), p, sig, _emptyEdge(), "");
        assertGe(usdc.balanceOf(circleCpn) - cpnBefore, assets, "default rail (circleCpn) not paid");
    }

    // ── negatives — the Gateway protects the user + the vault ─────────────────

    function test_highValue_withoutEdge_reverts() public {
        uint256 assets = 300 * ONE;
        bytes32 holdId = keccak256("hold-no-edge");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 4, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.EdgeSignatureRequired.selector);
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
    }

    function test_highValue_edgeAmountMismatch_reverts() public {
        uint256 assets = 300 * ONE;
        bytes32 holdId = keccak256("hold-edge-mismatch");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 5, block.timestamp + 1 days);
        bytes memory pSig = _signPermit(userPk, p);
        // edge signs a DIFFERENT amount than the charge.
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = _edgeAuth(holdId, 299 * ONE, block.timestamp + 240);
        bytes memory eSig = _signEdge(edgePk, e);
        vm.expectRevert(MintwarePaymentGateway.InvalidEdgeSignature.selector);
        gateway.settleSpend(holdId, user, assets, receiver, p, pSig, e, eSig);
    }

    function test_badPermitSignature_reverts() public {
        uint256 assets = 100 * ONE;
        bytes32 holdId = keccak256("hold-bad-sig");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(500 * ONE, 6, block.timestamp + 1 days);
        bytes memory sig = _signPermit(edgePk, p); // signed by the wrong key
        vm.expectRevert(MintwarePaymentGateway.InvalidPermitSignature.selector);
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
    }

    function test_revokedNonce_reverts() public {
        uint256 assets = 100 * ONE;
        bytes32 holdId = keccak256("hold-revoked");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(500 * ONE, 7, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.prank(user);
        gateway.revokeNonce(7);
        vm.expectRevert(MintwarePaymentGateway.NonceRevokedError.selector);
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
    }

    function test_replaySameHold_reverts() public {
        uint256 assets = 100 * ONE;
        bytes32 holdId = keccak256("hold-replay");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(500 * ONE, 8, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
        vm.expectRevert(MintwarePaymentGateway.HoldAlreadySettled.selector);
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
    }

    function test_exceedsDailyCap_reverts() public {
        uint256 assets = 100 * ONE;
        bytes32 holdId = keccak256("hold-cap");
        // permit caps the user at $50/day → a $100 charge exceeds it.
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(50 * ONE, 9, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.ExceedsDailySpendLimit.selector);
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
    }

    // ── audit-fix coverage ────────────────────────────────────────────────────

    /// AUDIT C1: a rogue relayer cannot redirect settlement to an attacker `receiver` — it is ignored.
    function test_rogueReceiver_isIgnored_treasuryPaid() public {
        address attacker = makeAddr("attacker");
        uint256 assets = 100 * ONE;
        bytes32 holdId = keccak256("hold-rogue-receiver");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(500 * ONE, 11, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);

        uint256 cpnBefore = usdc.balanceOf(circleCpn);
        gateway.settleSpend(holdId, user, assets, attacker, p, sig, _emptyEdge(), "");
        assertEq(usdc.balanceOf(attacker), 0, "attacker receiver must get nothing");
        assertGe(usdc.balanceOf(circleCpn) - cpnBefore, assets, "treasury must be paid");
    }

    /// AUDIT M2: the edge signature is required once CUMULATIVE daily spend crosses $250, so a relayer
    /// cannot bypass the second-signer gate by splitting a large charge into sub-$250 pieces.
    function test_cumulativeThreshold_requiresEdge() public {
        // First $200 charge — cumulative $200 < $250 → permit-only, no edge needed.
        MintwarePaymentGateway.DelegatedSpendPermit memory p1 = _permit(1_000 * ONE, 12, block.timestamp + 1 days);
        gateway.settleSpend(keccak256("split-1"), user, 200 * ONE, receiver, p1, _signPermit(userPk, p1), _emptyEdge(), "");

        // Second $100 charge — cumulative $300 > $250 → edge sig now REQUIRED even though the charge is < $250.
        MintwarePaymentGateway.DelegatedSpendPermit memory p2 = _permit(1_000 * ONE, 13, block.timestamp + 1 days);
        bytes memory sig2 = _signPermit(userPk, p2);
        vm.expectRevert(MintwarePaymentGateway.EdgeSignatureRequired.selector);
        gateway.settleSpend(keccak256("split-2"), user, 100 * ONE, receiver, p2, sig2, _emptyEdge(), "");

        // With a valid edge auth it goes through.
        bytes32 holdId = keccak256("split-2");
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = _edgeAuth(holdId, 100 * ONE, block.timestamp + 240);
        gateway.settleSpend(holdId, user, 100 * ONE, receiver, p2, sig2, e, _signEdge(edgePk, e));
    }

    /// AUDIT M2 boundary: a charge of EXACTLY $250 requires the edge signature (>= threshold, not >).
    function test_exactThreshold_requiresEdge() public {
        uint256 assets = 250 * ONE; // == HIGH_VALUE_THRESHOLD
        bytes32 holdId = keccak256("hold-exact-250");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 14, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.EdgeSignatureRequired.selector);
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
    }

    /// AUDIT (low): cancelling a never-created hold reverts instead of poisoning that holdId forever.
    function test_cancelUnknownHold_reverts() public {
        vm.expectRevert(MintwarePaymentGateway.UnknownHold.selector);
        gateway.cancelHold(keccak256("never-created"));
    }

    function test_nonRelayer_reverts() public {
        uint256 assets = 100 * ONE;
        bytes32 holdId = keccak256("hold-not-relayer");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(500 * ONE, 10, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(); // AccessControlUnauthorizedAccount (RELAYER_ROLE)
        gateway.settleSpend(holdId, user, assets, receiver, p, sig, _emptyEdge(), "");
    }
}
