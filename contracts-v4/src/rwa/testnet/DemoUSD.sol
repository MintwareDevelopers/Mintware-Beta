// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title  DemoUSD
/// @notice TESTNET ONLY — a valueless 6-decimal USD stand-in for the V2-RWAs demo market. The owner and
///         enrolled minters (the demo lending adapter, which mints its simulated interest) can mint.
/// @dev    Never deploy to a mainnet. Production uses real USDC; this exists so the demo's lending yield
///         can accrue visibly on-chain without depending on a third-party testnet faucet.
contract DemoUSD is ERC20, Ownable2Step {
    mapping(address => bool) public isMinter;

    event MinterSet(address indexed minter, bool allowed);

    error OnlyMinter();

    constructor(address owner_) ERC20("Demo USD (testnet, no value)", "dUSD") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner() && !isMinter[msg.sender]) revert OnlyMinter();
        _mint(to, amount);
    }
}
