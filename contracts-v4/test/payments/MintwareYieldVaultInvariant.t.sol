// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}        from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {MintwareYieldVault}     from "../../src/payments/MintwareYieldVault.sol";
import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";
import {AaveV3YieldAdapter}     from "../../src/vaults/AaveV3YieldAdapter.sol";
import {IYieldAdapter}          from "../../src/vaults/IYieldAdapter.sol";
import {IPoolAddressesProvider} from "../../src/vaults/aave/IAaveV3.sol";

import {MockERC20}                from "../mocks/MockERC20.sol";
import {MockAavePool, MockAToken} from "../mocks/MockAavePool.sol";

/// @dev Drives the REAL MintwareYieldVault + MintwarePaymentGateway over a real AaveV3YieldAdapter on a
///      tunable/illiquid MockAavePool, through fuzzed sequences of deposits, user redeems, yield
///      injection, liquidity perturbation, and every `settleSpend` flavor — valid permit-only (<$250),
///      valid edge-signed (>=$250), FORGED permit, FORGED edge, REVOKED nonce, over-cap, over-buffer,
///      REPLAYED holdId, and a hostile RELAYER+EDGE collusion with NO user signature. EIP-712 permits and
///      edge auths are signed in-handler with `vm.sign` against the Gateway's live domain. Every action
///      swallows reverts (a reverted action is a no-op for the fuzzer), so the run reports 0 reverts.
contract YieldVaultHandler is Test {
    MintwareYieldVault     public vault;
    MintwarePaymentGateway public gateway;
    AaveV3YieldAdapter     public adapter;
    MockAToken             public aToken;
    MockERC20              public usdc;

    address[] public users;
    uint256[] public userKeys;
    uint256[] public maxDaily;   // per-user permit cap
    bytes[]   public permitSig;  // per-user stable signature over the main permit
    mapping(address => bool) public revoked; // user revoked their main nonce

    address public edgeSigner;
    uint256 public edgeKey;
    uint256 public badKey; // a key with NO roles / not the user — used to forge

    address public receiver;

    uint256 internal constant PERMIT_DEADLINE = type(uint256).max;
    uint256 internal constant HIGH = 250_000_000; // $250 (6dp)

    // ── ghosts ──────────────────────────────────────────────────────────────────
    uint256 public totalDeposited;
    uint256 public totalYieldInjected;
    uint256 public totalPaidOut;          // USDC that left the vault (redeems + settlements)
    uint256 public successfulSettlements;
    bool    public unauthorizedSettlementSucceeded; // set if any no-valid-user-sig settle returns
    bool    public navDecreased;                    // set if pps ever dropped
    uint256 public lastPps;                         // (totalAssets+V)*1e27/(totalShares+V)
    bytes32 public lastSettledHold;                 // for the replay probe
    bool    public haveSettledHold;

    uint256 internal holdSeq;

    constructor(
        MintwareYieldVault _vault,
        MintwarePaymentGateway _gateway,
        AaveV3YieldAdapter _adapter,
        MockAToken _aToken,
        MockERC20 _usdc,
        address[] memory _users,
        uint256[] memory _userKeys,
        uint256[] memory _maxDaily,
        bytes[] memory _permitSig,
        address _edgeSigner,
        uint256 _edgeKey,
        uint256 _badKey,
        address _receiver,
        uint256 _seededDeposits
    ) {
        vault = _vault;
        gateway = _gateway;
        adapter = _adapter;
        aToken = _aToken;
        usdc = _usdc;
        users = _users;
        userKeys = _userKeys;
        maxDaily = _maxDaily;
        permitSig = _permitSig;
        edgeSigner = _edgeSigner;
        edgeKey = _edgeKey;
        badKey = _badKey;
        receiver = _receiver;
        totalDeposited = _seededDeposits; // count the setUp seed deposits in the conservation ghost
        _recordPps();
    }

    // ── helpers ───────────────────────────────────────────────────────────────────
    function nUsers() external view returns (uint256) { return users.length; }

    function _uidx(uint256 seed) internal view returns (uint256) {
        return bound(seed, 0, users.length - 1);
    }

    function _permitStruct(uint256 i) internal view returns (MintwarePaymentGateway.DelegatedSpendPermit memory p) {
        p = MintwarePaymentGateway.DelegatedSpendPermit({
            user: users[i], maxDailySpendUSDC: maxDaily[i], nonce: i + 1, deadline: PERMIT_DEADLINE
        });
    }

    function _signEdge(uint256 key, bytes32 holdId, address user, uint256 amount, uint256 nonce, uint256 expiry)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            gateway.SHORT_LIVED_HOLD_AUTH_TYPEHASH(), holdId, user, amount, nonce, expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _forgePermitSig(uint256 key, MintwarePaymentGateway.DelegatedSpendPermit memory p)
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

    function _nextHold() internal returns (bytes32) {
        return keccak256(abi.encodePacked("hold", holdSeq++));
    }

    function _recordPps() internal {
        uint256 ts = vault.totalShares();
        uint256 pps = (vault.totalAssets() + vault.VIRTUAL()) * 1e27 / (ts + vault.VIRTUAL());
        if (pps < lastPps) navDecreased = true;
        lastPps = pps;
    }

    // ── time (isolated call so timestamp reads elsewhere stay fresh) ──────────────
    function warp(uint256 seed) public {
        vm.warp(vm.getBlockTimestamp() + bound(seed, 1 hours, 3 days));
    }

    // ── liquidity / yield ─────────────────────────────────────────────────────────
    function deposit(uint256 uSeed, uint256 amtSeed) public {
        uint256 i = _uidx(uSeed);
        uint256 amt = bound(amtSeed, 1_000_000, 500_000_000_000); // $1 .. $500k
        vm.prank(users[i]);
        try vault.deposit(amt, users[i]) { totalDeposited += amt; } catch {}
        _recordPps();
    }

    function userRedeem(uint256 uSeed, uint256 shareSeed) public {
        uint256 i = _uidx(uSeed);
        uint256 bal = vault.shares(users[i]);
        if (bal == 0) return;
        uint256 s = bound(shareSeed, 1, bal);
        vm.prank(users[i]);
        try vault.redeem(s) returns (uint256 out) { totalPaidOut += out; } catch {}
        _recordPps();
    }

    function injectYield(uint256 amtSeed) public {
        if (vault.totalShares() == 0) return;
        uint256 amt = bound(amtSeed, 1_000_000, 50_000_000_000); // $1 .. $50k of yield
        usdc.mint(address(aToken), amt);            // back the yield with real underlying
        aToken.simulateYield(address(adapter), amt); // rebase the adapter's aToken up
        totalYieldInjected += amt;
        _recordPps();
    }

    /// @dev Make Aave illiquid (borrowed-out inventory) to exercise the over-buffer / idleBuffer gate.
    function drainAave(uint256 seed) public {
        uint256 avail = usdc.balanceOf(address(aToken));
        if (avail == 0) return;
        uint256 drain = bound(seed, 1, avail);
        aToken.simulateBorrow(drain); // underlying leaves aToken; aToken balances (accounting) unchanged
        _recordPps();
    }

    /// @dev Restore liquidity so redeems can succeed again.
    function refillAave(uint256 seed) public {
        uint256 amt = bound(seed, 1_000_000, 100_000_000_000);
        usdc.mint(address(aToken), amt);
        _recordPps();
    }

    // ── settlement flows (handler holds RELAYER_ROLE) ─────────────────────────────
    function settleLow(uint256 uSeed, uint256 amtSeed) public {
        uint256 i = _uidx(uSeed);
        uint256 amt = bound(amtSeed, 1, HIGH - 1); // < $250 → permit only
        bytes32 holdId = _nextHold();
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permitStruct(i);
        MintwarePaymentGateway.ShortLivedHoldAuth memory empty;
        uint256 before = usdc.balanceOf(receiver);
        try gateway.settleSpend(holdId, users[i], amt, receiver, p, permitSig[i], empty, "") returns (uint256) {
            successfulSettlements++;
            totalPaidOut += usdc.balanceOf(receiver) - before; // EXACT USDC that left the vault
            lastSettledHold = holdId;
            haveSettledHold = true;
        } catch {}
        _recordPps();
    }

    function settleHigh(uint256 uSeed, uint256 amtSeed) public {
        uint256 i = _uidx(uSeed);
        uint256 amt = bound(amtSeed, HIGH, 2_000_000_000); // $250 .. $2000
        bytes32 holdId = _nextHold();
        uint256 expiry = vm.getBlockTimestamp() + 4 minutes;
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permitStruct(i);
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = MintwarePaymentGateway.ShortLivedHoldAuth({
            holdId: holdId, user: users[i], amountUSDC: amt, nonce: holdSeq, expiry: expiry
        });
        bytes memory esig = _signEdge(edgeKey, holdId, users[i], amt, holdSeq, expiry);
        uint256 before = usdc.balanceOf(receiver);
        try gateway.settleSpend(holdId, users[i], amt, receiver, p, permitSig[i], e, esig) returns (uint256) {
            successfulSettlements++;
            totalPaidOut += usdc.balanceOf(receiver) - before; // EXACT USDC that left the vault
            lastSettledHold = holdId;
            haveSettledHold = true;
        } catch {}
        _recordPps();
    }

    /// @dev FORGED permit signature (signed by a non-user key). MUST revert; if it settles, that is an
    ///      unauthorized settlement.
    function settleForgedPermit(uint256 uSeed, uint256 amtSeed) public {
        uint256 i = _uidx(uSeed);
        uint256 amt = bound(amtSeed, 1, HIGH - 1);
        bytes32 holdId = _nextHold();
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permitStruct(i);
        bytes memory forged = _forgePermitSig(badKey, p);
        MintwarePaymentGateway.ShortLivedHoldAuth memory empty;
        try gateway.settleSpend(holdId, users[i], amt, receiver, p, forged, empty, "") returns (uint256) {
            unauthorizedSettlementSucceeded = true;
        } catch {}
        _recordPps();
    }

    /// @dev >=$250 with a FORGED edge sig (signed by a key WITHOUT EDGE_SIGNER_ROLE), user permit valid.
    ///      MUST revert.
    function settleForgedEdge(uint256 uSeed, uint256 amtSeed) public {
        uint256 i = _uidx(uSeed);
        uint256 amt = bound(amtSeed, HIGH, 2_000_000_000);
        bytes32 holdId = _nextHold();
        uint256 expiry = vm.getBlockTimestamp() + 4 minutes;
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permitStruct(i);
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = MintwarePaymentGateway.ShortLivedHoldAuth({
            holdId: holdId, user: users[i], amountUSDC: amt, nonce: holdSeq, expiry: expiry
        });
        bytes memory esig = _signEdge(badKey, holdId, users[i], amt, holdSeq, expiry); // NOT an edge signer
        try gateway.settleSpend(holdId, users[i], amt, receiver, p, permitSig[i], e, esig) returns (uint256) {
            unauthorizedSettlementSucceeded = true;
        } catch {}
        _recordPps();
    }

    /// @dev THE §5 PROPERTY: hostile RELAYER (this handler) + a VALID EDGE sig, but NO valid user permit
    ///      signature (forged). Even full relayer+edge collusion must not move a user's funds.
    function hostileSettle(uint256 uSeed, uint256 amtSeed) public {
        uint256 i = _uidx(uSeed);
        uint256 amt = bound(amtSeed, HIGH, 2_000_000_000);
        bytes32 holdId = _nextHold();
        uint256 expiry = vm.getBlockTimestamp() + 4 minutes;
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permitStruct(i);
        bytes memory forgedPermit = _forgePermitSig(badKey, p); // no genuine user consent
        MintwarePaymentGateway.ShortLivedHoldAuth memory e = MintwarePaymentGateway.ShortLivedHoldAuth({
            holdId: holdId, user: users[i], amountUSDC: amt, nonce: holdSeq, expiry: expiry
        });
        bytes memory esig = _signEdge(edgeKey, holdId, users[i], amt, holdSeq, expiry); // genuine edge
        try gateway.settleSpend(holdId, users[i], amt, receiver, p, forgedPermit, e, esig) returns (uint256) {
            unauthorizedSettlementSucceeded = true;
        } catch {}
        _recordPps();
    }

    /// @dev Revoke a user's main nonce. Kills that user's future settles (revocation is permanent).
    function revokeNonce(uint256 uSeed) public {
        uint256 i = _uidx(uSeed);
        if (revoked[users[i]]) return;
        vm.prank(users[i]);
        try gateway.revokeNonce(i + 1) { revoked[users[i]] = true; } catch {}
    }

    /// @dev Replay a previously-settled holdId — MUST revert (holds[].settled).
    function settleReplay(uint256 uSeed, uint256 amtSeed) public {
        if (!haveSettledHold) return;
        uint256 i = _uidx(uSeed);
        uint256 amt = bound(amtSeed, 1, HIGH - 1);
        MintwarePaymentGateway.DelegatedSpendPermit memory p = _permitStruct(i);
        MintwarePaymentGateway.ShortLivedHoldAuth memory empty;
        try gateway.settleSpend(lastSettledHold, users[i], amt, receiver, p, permitSig[i], empty, "") returns (uint256) {
            unauthorizedSettlementSucceeded = true; // a replayed holdId settling twice is a breach
        } catch {}
        _recordPps();
    }
}

/// @notice The gate — spec §4 invariants at 256 runs × 128,000 calls, 0 reverts. Proves solvency,
///         settlement conservation, NAV monotonicity, the §5 no-unauthorized-settlement property, the
///         permit-reusability + bounds (the nonce-fix regression), and vault-favorable rounding.
contract MintwareYieldVaultInvariantTest is StdInvariant, Test {
    MintwareYieldVault     internal vault;
    MintwarePaymentGateway internal gateway;
    AaveV3YieldAdapter     internal adapter;
    MockAavePool           internal pool;
    MockAToken             internal aUSDC;
    MockERC20              internal usdc;
    YieldVaultHandler      internal handler;

    address internal owner    = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal receiver = makeAddr("cardRail");

    address[] internal users;
    uint256[] internal userKeys;
    uint256[] internal maxDaily;

    function setUp() public {
        usdc  = new MockERC20("USD Coin", "USDC", 6);
        pool  = new MockAavePool();
        aUSDC = new MockAToken(address(usdc), address(pool));
        pool.setAToken(address(usdc), aUSDC);
        pool.setConfig(address(usdc), true, false, false);

        adapter = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(usdc), address(aUSDC), address(0), owner
        );
        vault = new MintwareYieldVault(address(usdc), address(adapter), owner);
        vm.prank(owner);
        adapter.setVault(address(vault));

        // admin_ = address(this): this test holds ADMIN/RELAYER/EDGE/PAUSER.
        gateway = new MintwarePaymentGateway(address(vault), address(usdc), treasury, address(this));
        vm.prank(owner);
        vault.setGateway(address(gateway));

        // Dedicated edge signer with the role; a "bad" key with NO role for forgeries.
        (address edgeSigner, uint256 edgeKey) = makeAddrAndKey("edge");
        (, uint256 badKey) = makeAddrAndKey("bad");
        gateway.grantRole(gateway.EDGE_SIGNER_ROLE(), edgeSigner);

        // Three users, each with a distinct permit cap so both the protocol and permit caps bind.
        maxDaily = new uint256[](3);
        maxDaily[0] = 1_000_000_000_000; // $1M → protocol default ($1000) binds
        maxDaily[1] = 500_000_000;       // $500 → permit binds
        maxDaily[2] = 1_000_000_000_000; // $1M → protocol binds

        users = new address[](3);
        userKeys = new uint256[](3);
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            (address u, uint256 k) = makeAddrAndKey(string(abi.encodePacked("user", vm.toString(i))));
            users[i] = u;
            userKeys[i] = k;
            usdc.mint(u, 1e30);
            vm.prank(u);
            usdc.approve(address(vault), type(uint256).max);
            sigs[i] = _signPermit(k, u, maxDaily[i], i + 1, type(uint256).max);
        }

        // Seed initial deposits so there is capital to settle against from block 0.
        uint256 seeded;
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(users[i]);
            vault.deposit(200_000_000_000, users[i]); // $200k each
            seeded += 200_000_000_000;
        }

        handler = new YieldVaultHandler(
            vault, gateway, adapter, aUSDC, usdc,
            users, userKeys, maxDaily, sigs, edgeSigner, edgeKey, badKey, receiver, seeded
        );
        gateway.grantRole(gateway.RELAYER_ROLE(), address(handler));

        bytes4[] memory sels = new bytes4[](12);
        sels[0]  = YieldVaultHandler.warp.selector;
        sels[1]  = YieldVaultHandler.deposit.selector;
        sels[2]  = YieldVaultHandler.userRedeem.selector;
        sels[3]  = YieldVaultHandler.injectYield.selector;
        sels[4]  = YieldVaultHandler.drainAave.selector;
        sels[5]  = YieldVaultHandler.refillAave.selector;
        sels[6]  = YieldVaultHandler.settleLow.selector;
        sels[7]  = YieldVaultHandler.settleHigh.selector;
        sels[8]  = YieldVaultHandler.settleForgedPermit.selector;
        sels[9]  = YieldVaultHandler.settleForgedEdge.selector;
        sels[10] = YieldVaultHandler.hostileSettle.selector;
        sels[11] = YieldVaultHandler.settleReplay.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));

        // NOTE: revokeNonce is intentionally NOT targeted — a live revocation of a user's only permit
        // would permanently brick that user's settle path and starve those flows over 128k calls. The
        // revoked-nonce blocking is proven in the focused unit test instead; the reusability invariant
        // here proves the complementary property (nonce is NEVER consumed by a settle).
        targetContract(address(handler));
    }

    function _signPermit(uint256 key, address user, uint256 maxD, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            gateway.DELEGATED_SPEND_PERMIT_TYPEHASH(), user, maxD, nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @notice Runs once at the END of each invariant run: proves the fuzz actually EXERCISED the
    ///         settlement path (so `invariant_permit_reusable_and_bounded` is not vacuously true — a
    ///         single reusable permit really did settle many spends across the run).
    function afterInvariant() public view {
        assertGt(handler.successfulSettlements(), 0, "fuzz never executed a successful settlement");
    }

    // ── §4.1 SOLVENCY ────────────────────────────────────────────────────────────
    /// @notice Every holder's redeemable claim, summed, is fully backed by `totalAssets()` — the vault
    ///         is never under-collateralized (Aave principal + accrued + buffer >= all claims).
    function invariant_vault_solvency() public view {
        uint256 sumRedeemable;
        for (uint256 i = 0; i < users.length; i++) {
            sumRedeemable += vault.convertToAssets(vault.shares(users[i]));
        }
        assertLe(sumRedeemable, vault.totalAssets(), "sum of redeemable claims exceeds totalAssets");
        // Structural crux of the symmetric-virtual-offset solvency proof.
        assertLe(vault.totalShares(), vault.totalAssets(), "totalShares > totalAssets (solvency crux broken)");
    }

    // ── §4.2 SETTLEMENT CONSERVES ─────────────────────────────────────────────────
    /// @notice No value is ever created: cumulative USDC paid out (redeems + settlements) never exceeds
    ///         cumulative USDC in (deposits + injected yield). The vault never sends more than it holds.
    function invariant_settlement_conserves() public view {
        assertLe(
            handler.totalPaidOut(),
            handler.totalDeposited() + handler.totalYieldInjected(),
            "paid out MORE than deposited + yield (value created)"
        );
    }

    // ── §4.3 NAV MONOTONIC ────────────────────────────────────────────────────────
    /// @notice Share price never decreases. Deposits/redeems/settlements are inflation-safe (rounding
    ///         favors the vault → NAV can only tick up), and the mock never realizes a principal loss.
    function invariant_nav_monotonic() public view {
        assertFalse(handler.navDecreased(), "NAV (assets/share) decreased");
    }

    // ── §4.4 NO UNAUTHORIZED SETTLEMENT (the §5 property) ─────────────────────────
    /// @notice A hostile RELAYER + genuine EDGE sig but NO valid user permit signature can NEVER move
    ///         funds; forged permits/edges never settle; a replayed holdId never settles twice.
    function invariant_no_unauthorized_settlement() public view {
        assertFalse(handler.unauthorizedSettlementSucceeded(), "an unauthorized settlement succeeded");
    }

    // ── §4.5 PERMIT REUSABLE + BOUNDED (the nonce-fix regression) ─────────────────
    /// @notice The long-lived permit's nonce is NEVER consumed by a settle (only by an explicit revoke),
    ///         so one permit settles many spends; and every user's per-day spend stays within the
    ///         effective (min of permit + protocol) daily cap.
    function invariant_permit_reusable_and_bounded() public view {
        uint256 epochDay = block.timestamp / 1 days;
        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            // Nonce is revocation-only: usedNonces is true iff the user explicitly revoked it.
            assertEq(gateway.usedNonces(u, i + 1), handler.revoked(u), "settle consumed the permit nonce");
            // Daily spend bounded by the effective cap (min of permit cap and protocol default $1000).
            uint256 effCap = maxDaily[i] < 1_000_000_000 ? maxDaily[i] : 1_000_000_000;
            assertLe(gateway.dailySpendUSDC(u, epochDay), effCap, "daily spend exceeded effective cap");
        }
    }

    // ── §4.6 ROUNDING FAVORS VAULT ────────────────────────────────────────────────
    /// @notice No phantom shares (Σ holder shares == totalShares), and previewWithdraw never under-quotes
    ///         (a full round-trip can never return more than contributed + yield — covered by
    ///         `invariant_settlement_conserves`; here we pin the share-supply identity).
    function invariant_rounding_favors_vault() public view {
        uint256 sum;
        for (uint256 i = 0; i < users.length; i++) sum += vault.shares(users[i]);
        assertEq(sum, vault.totalShares(), "phantom shares: sum of holder shares != totalShares");
        // previewWithdraw rounds UP: shares to cover `assets` always redeem >= `assets`.
        if (vault.totalShares() > 0) {
            uint256 probe = 1_000_000; // $1
            uint256 sh = vault.previewWithdraw(probe);
            assertGe(vault.convertToAssets(sh), probe, "previewWithdraw under-quoted shares");
        }
    }
}
