// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwareYieldVault}     from "../../src/payments/MintwareYieldVault.sol";
import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";
import {AaveV3YieldAdapter}     from "../../src/vaults/AaveV3YieldAdapter.sol";
import {IYieldAdapter}          from "../../src/vaults/IYieldAdapter.sol";
import {IPoolAddressesProvider} from "../../src/vaults/aave/IAaveV3.sol";

import {MockERC20}                from "../mocks/MockERC20.sol";
import {MockAavePool, MockAToken} from "../mocks/MockAavePool.sol";

/// @title  MintwareYieldVault + MintwarePaymentGateway unit tests
/// @notice Focused (non-fuzz) coverage for spec §4: the hybrid ≥$250 edge rule, permit-only <$250,
///         daily caps (protocol + permit), idleBuffer gating, `onlyGateway`, revoked-nonce blocking,
///         replayed-holdId reverting, and THE nonce-fix regression (one permit settles twice), plus the
///         vault's inflation defense + rounding directions.
contract MintwareYieldVaultTest is Test {
    MintwareYieldVault     internal vault;
    MintwarePaymentGateway internal gateway;
    AaveV3YieldAdapter     internal adapter;
    MockAavePool           internal pool;
    MockAToken             internal aUSDC;
    MockERC20              internal usdc;

    address internal owner    = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal receiver = makeAddr("cardRail");

    address internal alice;
    uint256 internal aliceKey;
    address internal edgeSigner;
    uint256 internal edgeKey;
    address internal badSigner;
    uint256 internal badKey;

    uint256 internal constant ONE_USDC = 1e6;

    function setUp() public {
        (alice, aliceKey)         = makeAddrAndKey("alice");
        (edgeSigner, edgeKey)     = makeAddrAndKey("edge");
        (badSigner, badKey)       = makeAddrAndKey("bad");

        usdc = new MockERC20("USD Coin", "USDC", 6);

        pool  = new MockAavePool();
        aUSDC = new MockAToken(address(usdc), address(pool));
        pool.setAToken(address(usdc), aUSDC);
        pool.setConfig(address(usdc), true, false, false); // active, not frozen, not paused

        adapter = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(usdc), address(aUSDC), address(0), owner
        );

        vault = new MintwareYieldVault(address(usdc), address(adapter), owner);

        vm.prank(owner);
        adapter.setVault(address(vault));

        // admin_ = address(this) → this test contract holds RELAYER + EDGE_SIGNER + PAUSER + ADMIN.
        gateway = new MintwarePaymentGateway(address(vault), address(usdc), treasury, address(this));

        vm.prank(owner);
        vault.setGateway(address(gateway));

        // Dedicated edge signer key.
        gateway.grantRole(gateway.EDGE_SIGNER_ROLE(), edgeSigner);

        // Fund alice + deposit.
        usdc.mint(alice, 1_000_000 * ONE_USDC);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(100_000 * ONE_USDC, alice);
        vm.stopPrank();
    }

    // ── EIP-712 signing helpers ───────────────────────────────────────────────────
    function _permit(uint256 maxDaily, uint256 nonce, uint256 deadline)
        internal
        view
        returns (MintwarePaymentGateway.DelegatedSpendPermit memory p)
    {
        p = MintwarePaymentGateway.DelegatedSpendPermit({
            user: alice, maxDailySpendUSDC: maxDaily, nonce: nonce, deadline: deadline
        });
    }

    function _signPermit(uint256 key, MintwarePaymentGateway.DelegatedSpendPermit memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            gateway.DELEGATED_SPEND_PERMIT_TYPEHASH(), p.user, p.maxDailySpendUSDC, p.nonce, p.deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _edge(bytes32 holdId, uint256 amount, uint256 nonce, uint256 expiry)
        internal
        view
        returns (MintwarePaymentGateway.ShortLivedHoldAuth memory e)
    {
        e = MintwarePaymentGateway.ShortLivedHoldAuth({
            holdId: holdId, user: alice, amountUSDC: amount, nonce: nonce, expiry: expiry
        });
    }

    function _signEdge(uint256 key, MintwarePaymentGateway.ShortLivedHoldAuth memory e)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            gateway.SHORT_LIVED_HOLD_AUTH_TYPEHASH(), e.holdId, e.user, e.amountUSDC, e.nonce, e.expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    MintwarePaymentGateway.ShortLivedHoldAuth internal EMPTY_EDGE;

    // ── vault: deposit / redeem / rounding / inflation ────────────────────────────

    function test_genesis_deposit_is_one_to_one() public view {
        // 100_000 USDC deposited at genesis → shares == assets (1:1 with symmetric virtual offset).
        assertEq(vault.shares(alice), 100_000 * ONE_USDC, "genesis shares != assets");
        assertEq(vault.totalShares(), 100_000 * ONE_USDC);
        // Everything idled into Aave.
        assertEq(adapter.totalAssets(), 100_000 * ONE_USDC, "not idled into Aave");
        assertEq(usdc.balanceOf(address(vault)), 0, "unexpected buffer");
    }

    function test_deposit_redeem_round_trip_no_more_than_contributed() public {
        (address bob, ) = makeAddrAndKey("bob");
        usdc.mint(bob, 50_000 * ONE_USDC);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        uint256 minted = vault.deposit(50_000 * ONE_USDC, bob);
        uint256 out = vault.redeem(minted);
        vm.stopPrank();
        assertLe(out, 50_000 * ONE_USDC, "round-trip returned MORE than contributed");
        // With no yield, dust loss is at most a rounding unit.
        assertApproxEqAbs(out, 50_000 * ONE_USDC, 1, "round-trip lost more than dust");
    }

    function test_nav_rises_with_yield_and_redeem_pays_share() public {
        // Alice holds all shares. Inject 10_000 USDC of yield into Aave (pre-fund + simulateYield).
        usdc.mint(address(aUSDC), 10_000 * ONE_USDC);
        aUSDC.simulateYield(address(adapter), 10_000 * ONE_USDC);
        assertEq(vault.totalAssets(), 110_000 * ONE_USDC, "yield not reflected");

        uint256 out = vault.convertToAssets(vault.shares(alice));
        // Alice is the only holder → redeemable ~= 110_000 (minus virtual-offset dust).
        assertApproxEqAbs(out, 110_000 * ONE_USDC, 1_000, "NAV did not capture yield");
        assertGt(out, 100_000 * ONE_USDC, "no yield captured");
    }

    function test_inflation_attack_defended() public {
        // Fully isolated stack (own pool/aToken/adapter/vault) so alice's genesis deposit can't interfere.
        MockAavePool p2 = new MockAavePool();
        MockAToken a2 = new MockAToken(address(usdc), address(p2));
        p2.setAToken(address(usdc), a2);
        p2.setConfig(address(usdc), true, false, false);
        AaveV3YieldAdapter ad = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(p2)), address(usdc), address(a2), address(0), owner
        );
        MintwareYieldVault v = new MintwareYieldVault(address(usdc), address(ad), owner);
        vm.prank(owner);
        ad.setVault(address(v));

        (address attacker, ) = makeAddrAndKey("attacker");
        (address victim, )   = makeAddrAndKey("victim");
        usdc.mint(attacker, 1_000_000 * ONE_USDC);
        usdc.mint(victim, 10_000 * ONE_USDC);

        // Attacker deposits 1 unit, then donates 15_000 USDC (> victim deposit) straight to the vault —
        // the classic first-depositor inflation move that, WITHOUT a virtual offset, would round the
        // victim's mint to zero and steal their deposit.
        vm.startPrank(attacker);
        usdc.approve(address(v), type(uint256).max);
        v.deposit(1, attacker);
        vm.stopPrank();
        usdc.mint(address(v), 15_000 * ONE_USDC); // donation lands in the vault buffer

        vm.startPrank(victim);
        usdc.approve(address(v), type(uint256).max);
        uint256 minted = v.deposit(10_000 * ONE_USDC, victim);
        uint256 out = v.redeem(minted);
        vm.stopPrank();

        // Victim must NOT be robbed: mints > 0 and redeems substantially all of their deposit back.
        assertGt(minted, 0, "victim minted zero shares (inflation succeeded)");
        assertGe(out, 9_500 * ONE_USDC, "victim lost more than dust to inflation");
    }

    // ── onlyGateway / setGateway / pausable ───────────────────────────────────────

    function test_burnForPayment_onlyGateway() public {
        vm.expectRevert(MintwareYieldVault.OnlyGateway.selector);
        vault.burnForPayment(alice, 1, receiver);
    }

    function test_setGateway_is_set_once() public {
        vm.prank(owner);
        vm.expectRevert(MintwareYieldVault.GatewayAlreadySet.selector);
        vault.setGateway(address(0xBEEF));
    }

    function test_paused_blocks_deposit_and_redeem() public {
        vm.prank(owner);
        vault.pause();
        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(ONE_USDC, alice);
        vm.expectRevert();
        vault.redeem(1);
        vm.stopPrank();
    }

    // ── settlement: happy paths ───────────────────────────────────────────────────

    function test_low_value_permit_only_settles() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);

        uint256 amount = 100 * ONE_USDC; // < $250 → no edge sig needed
        bytes32 holdId = keccak256("h-low");
        uint256 before = usdc.balanceOf(treasury);

        gateway.settleSpend(holdId, alice, amount, address(0), p, sig, EMPTY_EDGE, "");
        assertEq(usdc.balanceOf(treasury) - before, amount, "receiver not paid exactly amount");
    }

    function test_high_value_requires_and_accepts_edge_sig() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(10_000 * ONE_USDC, 7, block.timestamp + 365 days);
        bytes memory psig = _signPermit(aliceKey, p);

        uint256 amount = 500 * ONE_USDC; // >= $250
        bytes32 holdId = keccak256("h-high");
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = _edge(holdId, amount, 1, block.timestamp + 4 minutes);
        bytes memory esig = _signEdge(edgeKey, e);

        uint256 before = usdc.balanceOf(receiver);
        gateway.settleSpend(holdId, alice, amount, receiver, p, psig, e, esig);
        assertEq(usdc.balanceOf(receiver) - before, amount, "high-value settle underpaid");
    }

    function test_high_value_rejects_missing_edge_sig() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(10_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory psig = _signPermit(aliceKey, p);
        uint256 amount = 300 * ONE_USDC;
        bytes32 holdId = keccak256("h-noedge");
        vm.expectRevert(MintwarePaymentGateway.EdgeSignatureRequired.selector);
        gateway.settleSpend(holdId, alice, amount, receiver, p, psig, EMPTY_EDGE, "");
    }

    function test_high_value_rejects_forged_edge_sig() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(10_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory psig = _signPermit(aliceKey, p);
        uint256 amount = 300 * ONE_USDC;
        bytes32 holdId = keccak256("h-forgededge");
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = _edge(holdId, amount, 1, block.timestamp + 4 minutes);
        bytes memory esig = _signEdge(badKey, e); // NOT an edge signer
        vm.expectRevert(MintwarePaymentGateway.InvalidEdgeSignature.selector);
        gateway.settleSpend(holdId, alice, amount, receiver, p, psig, e, esig);
    }

    function test_forged_permit_reverts() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(10_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory psig = _signPermit(badKey, p); // wrong signer
        uint256 amount = 100 * ONE_USDC;
        bytes32 holdId = keccak256("h-forgedpermit");
        vm.expectRevert(MintwarePaymentGateway.InvalidPermitSignature.selector);
        gateway.settleSpend(holdId, alice, amount, receiver, p, psig, EMPTY_EDGE, "");
    }

    // ── THE nonce-fix regression: one permit settles TWICE ────────────────────────

    function test_permit_settles_twice_nonce_not_consumed() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(10_000 * ONE_USDC, 42, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);

        uint256 amount = 100 * ONE_USDC;
        gateway.settleSpend(keccak256("first"), alice, amount, receiver, p, sig, EMPTY_EDGE, "");
        // SAME permit + nonce, different holdId → MUST succeed (nonce is revocation-only).
        gateway.settleSpend(keccak256("second"), alice, amount, receiver, p, sig, EMPTY_EDGE, "");

        assertEq(usdc.balanceOf(receiver), 2 * amount, "second settle did not pay");
        assertFalse(gateway.usedNonces(alice, 42), "nonce was consumed (regression!)");
    }

    function test_revoked_nonce_blocks_settlement() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(10_000 * ONE_USDC, 9, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);

        vm.prank(alice);
        gateway.revokeNonce(9);

        vm.expectRevert(MintwarePaymentGateway.NonceRevokedError.selector);
        gateway.settleSpend(keccak256("h-revoked"), alice, 100 * ONE_USDC, receiver, p, sig, EMPTY_EDGE, "");
    }

    function test_replayed_holdId_reverts() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(10_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);
        bytes32 holdId = keccak256("h-dup");
        gateway.settleSpend(holdId, alice, 100 * ONE_USDC, receiver, p, sig, EMPTY_EDGE, "");
        vm.expectRevert(MintwarePaymentGateway.HoldAlreadySettled.selector);
        gateway.settleSpend(holdId, alice, 100 * ONE_USDC, receiver, p, sig, EMPTY_EDGE, "");
    }

    // ── daily caps ────────────────────────────────────────────────────────────────

    function test_protocol_daily_cap_enforced() public {
        // permit cap high → protocol default $1000 binds. Amounts >= $250 so each carries an edge auth.
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);

        bytes32 h1 = keccak256("d1");
        MintwarePaymentGateway.ShortLivedHoldAuth memory e1 = _edge(h1, 700 * ONE_USDC, 1, block.timestamp + 4 minutes);
        gateway.settleSpend(h1, alice, 700 * ONE_USDC, receiver, p, sig, e1, _signEdge(edgeKey, e1));

        bytes32 h2 = keccak256("d2");
        MintwarePaymentGateway.ShortLivedHoldAuth memory e2 = _edge(h2, 400 * ONE_USDC, 2, block.timestamp + 4 minutes);
        bytes memory es2 = _signEdge(edgeKey, e2); // sign BEFORE expectRevert (arg staticcalls would be caught)
        vm.expectRevert(MintwarePaymentGateway.ExceedsDailySpendLimit.selector);
        gateway.settleSpend(h2, alice, 400 * ONE_USDC, receiver, p, sig, e2, es2); // 1100 > 1000
    }

    function test_permit_daily_cap_enforced() public {
        // permit cap $300 < protocol → permit binds.
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(300 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);
        gateway.settleSpend(keccak256("p1"), alice, 200 * ONE_USDC, receiver, p, sig, EMPTY_EDGE, "");
        vm.expectRevert(MintwarePaymentGateway.ExceedsDailySpendLimit.selector);
        gateway.settleSpend(keccak256("p2"), alice, 200 * ONE_USDC, receiver, p, sig, EMPTY_EDGE, ""); // 400 > 300
    }

    function test_daily_cap_resets_next_day() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);

        bytes32 r1 = keccak256("r1");
        MintwarePaymentGateway.ShortLivedHoldAuth memory e1 = _edge(r1, 900 * ONE_USDC, 1, block.timestamp + 4 minutes);
        gateway.settleSpend(r1, alice, 900 * ONE_USDC, receiver, p, sig, e1, _signEdge(edgeKey, e1));

        vm.warp(block.timestamp + 1 days);
        // NOTE: read the warped time via the cheatcode — under via_ir+optimizer a bare
        // `block.timestamp + const` gets CSE-coalesced with pre-warp reads and would use the stale
        // function-entry timestamp. `vm.getBlockTimestamp()` is an opaque external read.
        uint256 nowTs = vm.getBlockTimestamp();
        // New day → fresh bucket, settle again (fresh edge auth against the new timestamp).
        bytes32 r2 = keccak256("r2");
        MintwarePaymentGateway.ShortLivedHoldAuth memory e2 = _edge(r2, 900 * ONE_USDC, 2, nowTs + 4 minutes);
        gateway.settleSpend(r2, alice, 900 * ONE_USDC, receiver, p, sig, e2, _signEdge(edgeKey, e2));
        assertEq(usdc.balanceOf(receiver), 1_800 * ONE_USDC, "cap did not reset next day");
    }

    // ── idleBuffer gating ─────────────────────────────────────────────────────────

    function test_idleBuffer_gates_settlement_when_illiquid() public {
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permit(1_000_000 * ONE_USDC, 1, block.timestamp + 365 days);
        bytes memory sig = _signPermit(aliceKey, p);

        // Drain Aave liquidity so nothing is withdrawable (simulate borrowed-out inventory).
        aUSDC.simulateBorrow(usdc.balanceOf(address(aUSDC)));
        assertEq(vault.idleBuffer(), 0, "buffer should be zero when Aave is drained");

        vm.expectRevert(MintwarePaymentGateway.InsufficientIdleLiquidity.selector);
        gateway.settleSpend(keccak256("h-illiquid"), alice, 100 * ONE_USDC, receiver, p, sig, EMPTY_EDGE, "");
    }
}
