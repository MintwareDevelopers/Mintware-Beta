// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReserveConfigurationMap} from "../../src/vaults/aave/IAaveV3.sol";

/// @dev Test-only aToken: holds the underlying (like a real aToken), pool-controlled mint/burn.
contract MockAToken {
    using SafeERC20 for IERC20;
    IERC20  public immutable underlying;
    address public immutable pool;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    constructor(address _underlying, address _pool) { underlying = IERC20(_underlying); pool = _pool; }
    function UNDERLYING_ASSET_ADDRESS() external view returns (address) { return address(underlying); }
    function POOL() external view returns (address) { return pool; }

    modifier onlyPool() { require(msg.sender == pool, "only pool"); _; }
    function mint(address to, uint256 amt) external onlyPool { balanceOf[to] += amt; totalSupply += amt; }
    function burn(address from, uint256 amt) external onlyPool { balanceOf[from] -= amt; totalSupply -= amt; }
    function transferUnderlying(address to, uint256 amt) external onlyPool { underlying.safeTransfer(to, amt); }

    /// @dev test: simulate liquidity borrowed out (underlying leaves the aToken; balances unchanged).
    function simulateBorrow(uint256 amt) external { underlying.safeTransfer(address(0xdead), amt); }
    /// @dev test: simulate accrued yield (extra aTokens, backed by pre-funded underlying).
    function accrue(address to, uint256 amt) external onlyPool { balanceOf[to] += amt; totalSupply += amt; }
    /// @dev test-only, permissionless: bump an aToken balance to simulate supply yield. Caller MUST
    ///      pre-fund the aToken with the matching underlying so withdrawals stay backed.
    function simulateYield(address to, uint256 amt) external { balanceOf[to] += amt; totalSupply += amt; }
}

/// @dev Minimal Aave v3 Pool + PoolAddressesProvider stand-in for adapter unit tests.
contract MockAavePool {
    using SafeERC20 for IERC20;
    mapping(address => MockAToken) public aTokenOf;
    mapping(address => uint256)    internal _config;
    bool public revertOnWithdraw; // simulate a hostile/broken pool (exercises the adapter try/catch)

    function getPool() external view returns (address) { return address(this); }

    function setAToken(address asset, MockAToken a) external { aTokenOf[asset] = a; }
    function setRevertOnWithdraw(bool v) external { revertOnWithdraw = v; }
    function setConfig(address asset, bool active, bool frozen, bool paused) external {
        uint256 d;
        if (active) d |= (1 << 56);
        if (frozen) d |= (1 << 57);
        if (paused) d |= (1 << 60);
        _config[asset] = d;
    }
    function getConfiguration(address asset) external view returns (ReserveConfigurationMap memory) {
        return ReserveConfigurationMap(_config[asset]);
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        MockAToken a = aTokenOf[asset];
        IERC20(asset).safeTransferFrom(msg.sender, address(a), amount); // underlying → aToken
        a.mint(onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(!revertOnWithdraw, "pool: withdraw disabled");
        MockAToken a = aTokenOf[asset];
        uint256 bal = a.balanceOf(msg.sender);
        uint256 amt = amount == type(uint256).max ? bal : amount;
        require(amt <= IERC20(asset).balanceOf(address(a)), "insufficient liquidity"); // Aave-like
        a.burn(msg.sender, amt);
        a.transferUnderlying(to, amt);
        return amt;
    }
}
