// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";

/// @notice Minimal Permit2 stand-in. The gateway approves THIS contract on the ERC-20 and then grants the
///         position manager an allowance here; the position manager pulls through `pull`. Same two-hop shape
///         as the real Permit2, so the gateway's `_permit` / `_revokePermit` paths are exercised for real.
contract MockV4Permit2 {
    mapping(bytes32 => uint160) public allow;

    function _k(address owner, address token, address spender) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, token, spender));
    }

    function approve(address token, address spender, uint160 amount, uint48) external {
        allow[_k(msg.sender, token, spender)] = amount;
    }

    function allowanceOf(address owner, address token, address spender) external view returns (uint160) {
        return allow[_k(owner, token, spender)];
    }

    /// Called by the spender (the position manager) to move `amount` of `token` from `from`.
    function pull(address token, address from, address to, uint256 amount) external {
        if (amount == 0) return;
        bytes32 k = _k(from, token, msg.sender);
        require(allow[k] >= amount, "P2_ALLOWANCE");
        allow[k] -= uint160(amount);
        require(IERC20(token).transferFrom(from, to, amount), "P2_TRANSFER");
    }
}

/// @title  MockV4PositionManager — accounting-faithful stand-in for the v4 periphery PositionManager
/// @notice Decodes the EXACT `(bytes actions, bytes[] params)` payloads the gateway builds
///         (`_mintCalls` / `_increaseCalls` / `_decreaseAndTake`) and settles them against amounts computed
///         with the REAL v4-core `SqrtPriceMath`, in the same in-range / out-of-range branch structure the
///         gateway's own `_amountsForLiquidity` uses — mint rounds UP (the pool charges up), decrease rounds
///         DOWN (the pool pays down), which is the real periphery's direction.
///
/// @dev    FIDELITY BOUNDARY — read this before trusting any counterexample found on this rig:
///           • It is NOT a pool. There is no swap, no tick crossing, no real reserve constraint: the mock is
///             pre-funded and will always pay a decrease. A real pool cannot pay out more than it holds.
///           • Fee accrual is a settable ghost (`accrueFees`), not earned from swap volume.
///           • Ticks/liquidity are tracked per tokenId as a single aggregate, matching the gateway's own model.
///         Consequence: this rig is sound for properties about the GATEWAY'S OWN state machine —
///         `deployedPrincipal`, the `MAX_DEPLOY_BPS` cap, the two-sided guard, the follower band on `deploy`,
///         and share conservation across deposit → deploy → withdraw. It is NOT sound for pool-economic
///         properties (impermanent loss, exit composition at spot, LVR) — those belong to the Foundry fork
///         suite (`InvariantForkLP.t.sol`), which runs against real v4 and is not replaced by this.
contract MockV4PositionManager {
    uint256 internal constant INCREASE_LIQUIDITY = 0x00;
    uint256 internal constant DECREASE_LIQUIDITY = 0x01;
    uint256 internal constant MINT_POSITION = 0x02;

    MockV4Permit2 public immutable permit2;
    address public immutable slot0Source; // MockSlot0PoolManager — the spot the mock settles at

    uint256 public nextId = 1;
    mapping(uint256 => uint128) public liq;
    mapping(uint256 => int24) public tLower;
    mapping(uint256 => int24) public tUpper;
    mapping(uint256 => address) public ownerOf;

    // Ghost fee accrual, per tokenId, per currency. A DECREASE (including the zero-delta fee sweep) pays it out.
    mapping(uint256 => uint256) public fees0;
    mapping(uint256 => uint256) public fees1;

    // Total principal the mock has taken in / paid out, per currency — lets a harness net out the pre-funded
    // float when it wants a conservation check that ignores the (unrealistic) infinite pool reserve.
    mapping(address => uint256) public tokenIn;
    mapping(address => uint256) public tokenOut;

    constructor(MockV4Permit2 permit2_, address slot0Source_) {
        permit2 = permit2_;
        slot0Source = slot0Source_;
    }

    function nextTokenId() external view returns (uint256) {
        return nextId;
    }

    function getPositionLiquidity(uint256 id) external view returns (uint128) {
        return liq[id];
    }

    function accrueFees(uint256 id, uint256 a0, uint256 a1) external {
        fees0[id] += a0;
        fees1[id] += a1;
    }

    function _spot() internal view returns (uint160 s) {
        (bool ok, bytes memory r) = slot0Source.staticcall(abi.encodeWithSignature("sqrtPrice()"));
        require(ok, "NO_SLOT0");
        s = abi.decode(r, (uint160));
    }

    /// Same branch structure as the gateway's `_amountsForLiquidity`; `roundUp` selects the mint direction.
    function _amounts(uint160 sqrtP, uint160 sqrtA, uint160 sqrtB, uint128 l, bool roundUp)
        internal
        pure
        returns (uint256 a0, uint256 a1)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        if (sqrtP <= sqrtA) {
            a0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, l, roundUp);
        } else if (sqrtP < sqrtB) {
            a0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, l, roundUp);
            a1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, l, roundUp);
        } else {
            a1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, l, roundUp);
        }
    }

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external {
        require(block.timestamp <= deadline, "DEADLINE");
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        uint8 a0 = uint8(actions[0]);

        if (a0 == uint8(MINT_POSITION)) {
            (
                PoolKey memory key,
                int24 lo,
                int24 hi,
                uint256 liquidity,
                uint128 amt0Max,
                uint128 amt1Max,
                address owner,
            ) = abi.decode(params[0], (PoolKey, int24, int24, uint256, uint128, uint128, address, bytes));
            uint256 id = nextId++;
            ownerOf[id] = owner;
            tLower[id] = lo;
            tUpper[id] = hi;
            _settle(id, key, uint128(liquidity), amt0Max, amt1Max, owner, true);
        } else if (a0 == uint8(INCREASE_LIQUIDITY)) {
            (uint256 id, uint256 liquidity, uint128 amt0Max, uint128 amt1Max,) =
                abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
            (Currency c0, Currency c1) = abi.decode(params[1], (Currency, Currency));
            PoolKey memory key;
            key.currency0 = c0;
            key.currency1 = c1;
            _settle(id, key, uint128(liquidity), amt0Max, amt1Max, ownerOf[id], true);
        } else if (a0 == uint8(DECREASE_LIQUIDITY)) {
            (uint256 id, uint256 liquidity,,,) = abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
            (Currency c0, Currency c1, address to) = abi.decode(params[1], (Currency, Currency, address));
            require(liq[id] > 0 || liquidity == 0, "EMPTY_POSITION");
            // v4-core reverts CannotUpdateEmptyPosition on a zero-delta update of an emptied position; the
            // gateway guards that with its own `getPositionLiquidity == 0` short-circuit, so mirror the revert.
            require(!(liquidity == 0 && liq[id] == 0), "CannotUpdateEmptyPosition");
            require(liquidity <= liq[id], "TOO_MUCH");
            (uint256 out0, uint256 out1) = liquidity == 0
                ? (uint256(0), uint256(0))
                : _amounts(_spot(), _sqrtAt(tLower[id]), _sqrtAt(tUpper[id]), uint128(liquidity), false);
            liq[id] -= uint128(liquidity);
            out0 += fees0[id];
            out1 += fees1[id];
            fees0[id] = 0;
            fees1[id] = 0;
            _pay(Currency.unwrap(c0), to, out0);
            _pay(Currency.unwrap(c1), to, out1);
        } else {
            revert("UNSUPPORTED_ACTION");
        }
    }

    function _settle(
        uint256 id,
        PoolKey memory key,
        uint128 liquidity,
        uint128 amt0Max,
        uint128 amt1Max,
        address payer,
        bool
    ) internal {
        (uint256 need0, uint256 need1) =
            _amounts(_spot(), _sqrtAt(tLower[id]), _sqrtAt(tUpper[id]), liquidity, true);
        require(need0 <= amt0Max && need1 <= amt1Max, "SLIPPAGE");
        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);
        if (need0 > 0) {
            permit2.pull(t0, payer, address(this), need0);
            tokenIn[t0] += need0;
        }
        if (need1 > 0) {
            permit2.pull(t1, payer, address(this), need1);
            tokenIn[t1] += need1;
        }
        liq[id] += liquidity;
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        tokenOut[token] += amount;
        require(IERC20(token).transfer(to, amount), "PAY_FAIL");
    }

    // TickMath.getSqrtPriceAtTick without importing the (large) library: the harness only ever uses the two
    // fixed ticks it constructed the gateway with, so they are injected once.
    mapping(int24 => uint160) internal _tickSqrt;

    function setTickSqrt(int24 tick, uint160 sqrtP) external {
        _tickSqrt[tick] = sqrtP;
    }

    function _sqrtAt(int24 tick) internal view returns (uint160 s) {
        s = _tickSqrt[tick];
        require(s != 0, "TICK_NOT_SET");
    }
}
