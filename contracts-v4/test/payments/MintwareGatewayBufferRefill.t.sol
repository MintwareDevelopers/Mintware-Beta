// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}  from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";

import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";
import {MintwareTreasuryVault}  from "../../src/payments/MintwareTreasuryVault.sol";
import {MWTimelockedRiskParams} from "../../src/lib/MWTimelockedRiskParams.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @notice Proves the card spend-buffer REFILL path through the real `MintwarePaymentGateway`: the user
///         registers their own buffer wallet, a RELAYER submits `refillBuffer`, and the vault redeems a
///         slice of the user's OWN senior shares → USDC into that buffer. Same harness/idioms as
///         MintwareGatewayTreasuryV2Test. Spec: docs/developers/card-spend-buffer-spec.md (Option A).
contract MintwareGatewayBufferRefillTest is Test {
    MockERC20                usdc;
    MockERC20                team;
    MockYieldAdapter         adapter;
    MintwareTreasuryVault    vault;
    MintwarePaymentGateway   gateway;

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal circleCpn = makeAddr("circleCpn");
    address internal buffer   = makeAddr("bufferWallet"); // the user's registered spend-buffer wallet

    address internal user; uint256 internal userPk;

    uint256 internal constant ONE = 1e6;

    function setUp() public {
        (user, userPk) = makeAddrAndKey("user");

        usdc    = new MockERC20("USD Coin", "USDC", 6);
        team    = new MockERC20("Team Token", "TEAM", 18);
        adapter = new MockYieldAdapter(address(usdc));

        PoolManager pm = new PoolManager(address(this));
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        PoolKey memory key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        vault   = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        // Gateway admin = this test contract → holds RELAYER_ROLE + DEFAULT_ADMIN.
        gateway = new MintwarePaymentGateway(address(vault), address(usdc), circleCpn, address(this));
        vm.prank(owner);
        vault.setGateway(address(gateway));

        team.mint(teamAddr, 5_000_000 ether);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000 ether, 0, 365 days);
        vm.stopPrank();

        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(1_000 * ONE, 0, user);
        // The user registers their own buffer wallet up front (msg.sender-pinned).
        gateway.setBufferAddress(buffer);
        vm.stopPrank();
    }

    function _permit(uint256 maxDaily, uint256 nonce, uint256 deadline)
        internal view returns (MintwarePaymentGateway.DelegatedSpendPermit memory)
    {
        return MintwarePaymentGateway.DelegatedSpendPermit({user: user, maxDailySpendUSDC: maxDaily, nonce: nonce, deadline: deadline});
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

    function _refill(bytes32 refillId, uint256 assets, uint256 maxDaily, uint256 nonce) internal returns (uint256) {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(maxDaily, nonce, block.timestamp + 1 days);
        return gateway.refillBuffer(refillId, user, assets, p, _signPermit(userPk, p));
    }

    // ── happy path ─────────────────────────────────────────────────────────────

    function test_refill_redeemsUserShares_intoBuffer() public {
        uint256 assets = 200 * ONE;
        uint256 bufBefore = usdc.balanceOf(buffer);
        uint256 shBefore  = vault.seniorShares(user);

        uint256 burned = _refill(keccak256("r1"), assets, 1_000 * ONE, 1);

        assertGt(burned, 0, "no shares burned");
        assertGe(usdc.balanceOf(buffer) - bufBefore, assets, "buffer underfunded vs the refill");
        assertApproxEqAbs(usdc.balanceOf(buffer) - bufBefore, assets, 2, "buffer overfunded beyond dust");
        assertLt(vault.seniorShares(user), shBefore, "user shares not burned");
        assertTrue(gateway.refillDone(keccak256("r1")), "refill not marked done");
    }

    // ── the receiver pin (C1 analogue) ───────────────────────────────────────────

    function test_refill_revertsWhenBufferUnset() public {
        (address user2, uint256 pk2) = makeAddrAndKey("user2");
        usdc.mint(user2, 1_000 * ONE);
        vm.startPrank(user2);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(500 * ONE, 0, user2);
        vm.stopPrank();
        // user2 never called setBufferAddress → no destination exists, relayer cannot invent one.
        MintwarePaymentGateway.DelegatedSpendPermit memory p =
            MintwarePaymentGateway.DelegatedSpendPermit({user: user2, maxDailySpendUSDC: 1_000 * ONE, nonce: 1, deadline: block.timestamp + 1 days});
        bytes32 sh = keccak256(abi.encode(gateway.DELEGATED_SPEND_PERMIT_TYPEHASH(), p.user, p.maxDailySpendUSDC, p.nonce, p.deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk2, keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), sh)));
        vm.expectRevert(MintwarePaymentGateway.BufferNotSet.selector);
        gateway.refillBuffer(keccak256("r-nobuf"), user2, 100 * ONE, p, abi.encodePacked(r, s, v));
    }

    function test_setBufferAddress_zero_reverts() public {
        vm.prank(user);
        vm.expectRevert(MintwarePaymentGateway.ZeroAddress.selector);
        gateway.setBufferAddress(address(0));
    }

    function test_userCanRotateBuffer_relayerCannot() public {
        address buffer2 = makeAddr("bufferWallet2");
        vm.prank(user);
        gateway.setBufferAddress(buffer2);
        assertEq(gateway.bufferOf(user), buffer2, "user rotate failed");

        // A refill now lands at the NEW buffer, and the relayer had no say in it.
        _refill(keccak256("r-rot"), 100 * ONE, 1_000 * ONE, 2);
        assertGe(usdc.balanceOf(buffer2), 100 * ONE, "rotated buffer not funded");
        assertEq(usdc.balanceOf(buffer), 0, "old buffer must be untouched");
    }

    // ── permit + idempotency + access ────────────────────────────────────────────

    function test_refill_badPermitSignature_reverts() public {
        (, uint256 wrongPk) = makeAddrAndKey("wrong");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 3, block.timestamp + 1 days);
        bytes memory sig = _signPermit(wrongPk, p); // pre-compute: expectRevert binds to the NEXT external call
        vm.expectRevert(MintwarePaymentGateway.InvalidPermitSignature.selector);
        gateway.refillBuffer(keccak256("r-badsig"), user, 100 * ONE, p, sig);
    }

    function test_refill_revokedNonce_reverts() public {
        vm.prank(user);
        gateway.revokeNonce(4);
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 4, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.NonceRevokedError.selector);
        gateway.refillBuffer(keccak256("r-revoked"), user, 100 * ONE, p, sig);
    }

    function test_refill_replaySameId_reverts() public {
        _refill(keccak256("r-dup"), 100 * ONE, 1_000 * ONE, 5);
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 6, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.RefillAlreadyDone.selector);
        gateway.refillBuffer(keccak256("r-dup"), user, 100 * ONE, p, sig);
    }

    function test_refill_zeroAssets_reverts() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 7, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.InvalidAmount.selector);
        gateway.refillBuffer(keccak256("r-zero"), user, 0, p, sig);
    }

    function test_refill_nonRelayer_reverts() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 8, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(); // AccessControlUnauthorizedAccount(RELAYER_ROLE)
        gateway.refillBuffer(keccak256("r-stranger"), user, 100 * ONE, p, sig);
    }

    // ── the refill daily cap, independent of the spend cap ───────────────────────

    function test_refill_exceedsPermitCap_reverts() public {
        // permit caps daily at $50 → a $100 refill exceeds it.
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(50 * ONE, 9, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.ExceedsDailyRefillLimit.selector);
        gateway.refillBuffer(keccak256("r-cap"), user, 100 * ONE, p, sig);
    }

    function test_refill_exceedsAdminRefillCap_reverts() public {
        gateway.setUserDailyRefillCap(user, 40 * ONE); // admin caps refills at $40/day
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 10, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.ExceedsDailyRefillLimit.selector);
        gateway.refillBuffer(keccak256("r-admincap"), user, 100 * ONE, p, sig);
    }

    function test_refillCap_isSeparateFromSpendCap() public {
        // Refill $300 (within the $1,000 refill default). The SPEND ledger must be untouched, so a
        // later spend has its full allowance — proving the two ledgers don't cross-contaminate.
        _refill(keccak256("r-sep"), 300 * ONE, 1_000 * ONE, 11);
        assertEq(gateway.dailyRefillUSDC(user, block.timestamp / 1 days), 300 * ONE, "refill ledger wrong");
        assertEq(gateway.dailySpendUSDC(user, block.timestamp / 1 days), 0, "spend ledger must be untouched by a refill");
    }

    // ── timelock-governed refill cap (tighten-instant / loosen-delayed) ──────────

    function _capParam(address u) internal pure returns (bytes32) { return keccak256(abi.encode("MW_REFILL_CAP", u)); }

    function test_cap_tightening_appliesInstantly() public {
        // Default effective cap is $1,000; tightening to $40 is a safety decrease → instant, no queue.
        gateway.setUserDailyRefillCap(user, 40 * ONE);
        assertEq(gateway.userDailyRefillCap(user), 40 * ONE, "tighten should apply now");
        ( , , uint256 eta) = gateway.pendingRiskParam(_capParam(user));
        assertEq(eta, 0, "no pending change for an instant tighten");
    }

    function test_cap_loosening_isTimelocked_thenConfirms() public {
        gateway.setUserDailyRefillCap(user, 40 * ONE);  // tighten first (instant)
        gateway.setUserDailyRefillCap(user, 500 * ONE); // loosen $40 -> $500: delayed
        assertEq(gateway.userDailyRefillCap(user), 40 * ONE, "loosen must NOT apply yet");
        ( , , uint256 eta) = gateway.pendingRiskParam(_capParam(user));
        assertGt(eta, block.timestamp, "loosen must be queued 48h out");

        vm.expectRevert(MWTimelockedRiskParams.RiskParamDelayNotElapsed.selector);
        gateway.confirmUserDailyRefillCap(user);

        vm.warp(block.timestamp + gateway.RISK_PARAM_DELAY());
        gateway.confirmUserDailyRefillCap(user);
        assertEq(gateway.userDailyRefillCap(user), 500 * ONE, "loosen should apply after the delay");
    }

    function test_cap_pendingLoosen_isCancellable() public {
        gateway.setUserDailyRefillCap(user, 40 * ONE);
        gateway.setUserDailyRefillCap(user, 500 * ONE); // queue a loosen
        gateway.cancelUserDailyRefillCap(user);
        assertEq(gateway.userDailyRefillCap(user), 40 * ONE, "cancel leaves the tight cap in place");
        vm.expectRevert(MWTimelockedRiskParams.NoRiskParamPending.selector);
        gateway.confirmUserDailyRefillCap(user);
    }

    function test_cap_pendingLoosen_oldCapStillEnforced() public {
        gateway.setUserDailyRefillCap(user, 40 * ONE);  // instant tighten
        gateway.setUserDailyRefillCap(user, 500 * ONE); // queued loosen (not yet live)
        // The OLD $40 cap must still gate a refill — the loosening hasn't taken effect.
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE, 20, block.timestamp + 1 days);
        bytes memory sig = _signPermit(userPk, p);
        vm.expectRevert(MintwarePaymentGateway.ExceedsDailyRefillLimit.selector);
        gateway.refillBuffer(keccak256("r-pending-loosen"), user, 100 * ONE, p, sig); // $100 > live $40 cap
    }

    function test_cap_aboveMax_reverts() public {
        uint256 tooHigh = gateway.MAX_REFILL_CAP() + 1; // pre-compute: expectRevert binds to the NEXT call
        vm.expectRevert(MintwarePaymentGateway.RefillCapTooHigh.selector);
        gateway.setUserDailyRefillCap(user, tooHigh);
    }

    function test_cap_setter_isAdminOnly() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        gateway.setUserDailyRefillCap(user, 40 * ONE);
    }

    function test_cap_instantTighten_clearsPendingLoosen() public {
        gateway.setUserDailyRefillCap(user, 500 * ONE);  // $1000 default -> $500: tighten, instant
        gateway.setUserDailyRefillCap(user, 800 * ONE);  // $500 -> $800: loosen, queued
        ( , , uint256 eta1) = gateway.pendingRiskParam(_capParam(user));
        assertGt(eta1, 0, "loosen should be queued");
        // An emergency instant tighten must DROP the stale queued loosen (audit fix L1).
        gateway.setUserDailyRefillCap(user, 100 * ONE);  // $500 -> $100: tighten, instant
        assertEq(gateway.userDailyRefillCap(user), 100 * ONE, "tighten applied");
        ( , , uint256 eta2) = gateway.pendingRiskParam(_capParam(user));
        assertEq(eta2, 0, "the stale loosen must be dropped, not left confirmable");
        vm.expectRevert(MWTimelockedRiskParams.NoRiskParamPending.selector);
        gateway.confirmUserDailyRefillCap(user);
    }
}
