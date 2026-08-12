// AUTO-GENERATED from forge build — MWHookCoordinator — engine build (am-AMM + JIT bridge + surge).
// Full ABI + creation bytecode. Regenerate after any contract change.
export const HOOK_COORDINATOR_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_poolManager",
        "type": "address",
        "internalType": "contract IPoolManager"
      },
      {
        "name": "_vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_initialOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "HOOK_FLAGS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint160",
        "internalType": "uint160"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POOL_MANAGER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "afterAddLiquidity",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "afterDonate",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "afterInitialize",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "uint160",
        "internalType": "uint160"
      },
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "afterRemoveLiquidity",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "afterSwap",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct SwapParams",
        "components": [
          {
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amountSpecified",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "sqrtPriceLimitX96",
            "type": "uint160",
            "internalType": "uint160"
          }
        ]
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int128",
        "internalType": "int128"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowExactOutput",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "amAmmEnabled",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "auction",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "beforeAddLiquidity",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "beforeDonate",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "beforeInitialize",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "uint160",
        "internalType": "uint160"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "beforeRemoveLiquidity",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "beforeSwap",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct SwapParams",
        "components": [
          {
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amountSpecified",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "sqrtPriceLimitX96",
            "type": "uint160",
            "internalType": "uint160"
          }
        ]
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BeforeSwapDelta"
      },
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configurePool",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "baseFeePips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "maxFeePips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "slopePipsPerTick",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxFeeStepPerBlock",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "dynamicFeeEnabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "guardEnabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "maxTickMovePerBlock",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "maxDeviationTicks",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "maxCatchupBlocks",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "feeParams",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "baseFeePips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "maxFeePips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "slopePipsPerTick",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxFeeStepPerBlock",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "dynamicFeeEnabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "guardEnabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "configured",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "guardian",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "jitEnabled",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "jitThreshold",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastFee",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastFeeBlock",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracleTick",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "initialized",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pokeOracle",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAllowExactOutput",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAmAmmEnabled",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAuction",
    "inputs": [
      {
        "name": "_auction",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setGuardian",
    "inputs": [
      {
        "name": "_guardian",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setJitEnabled",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setJitThreshold",
    "inputs": [
      {
        "name": "threshold",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setVault",
    "inputs": [
      {
        "name": "_vault",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "GuardianSet",
    "inputs": [
      {
        "name": "guardian",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JitEnabledSet",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JitThresholdSet",
    "inputs": [
      {
        "name": "threshold",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OraclePoked",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "oracleTick",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "currentTick",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "dynamicFee",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "guard",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultUpdated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AuctionAlreadySet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExactOutputNotSupported",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FeeTooHigh",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotGuardianOrOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyVaultCanModifyLiquidity",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PriceDeviationTooHigh",
    "inputs": []
  }
] as const;

export const HOOK_COORDINATOR_BYTECODE = "0x60a0604052346102f357604051601f6120a038819003918201601f19168301916001600160401b038311848410176102cc578084926060946040528339810103126102f35780516001600160a01b03811681036102f357610062602083016102f7565b916001600160a01b0390610078906040016102f7565b1680156102e0575f80546001600160a01b03198116831782556001600160a01b0316907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09080a3608052600280546001600160a01b0319166001600160a01b03929092169190911790556040516101c081016001600160401b038111828210176102cc575f916101a09160405282815282602082015260016040820152826060820152600160808201528260a0820152600160c0820152600160e082015282610100820152826101208201526001610140820152826101608201528261018082015201526120003016158015906102bf575b80156102ae575b80156102a1575b8015610290575b8015610283575b8015610273575b8015610263575b8015610257575b801561024b575b801561023b575b801561022f575b8015610223575b8015610217575b61020457604051611d94908161030c823960805181818161077e01528181610c0401528181610cae015281816110ba0152818161113b01528181611513015261192b0152f35b630732d7b560e51b5f523060045260245ffd5b506001301615156101be565b506002301615156101b7565b506004301615156101b0565b50600830161515600114156101a9565b506010301615156101a2565b5060203016151561019b565b5060403016151560011415610194565b506080301615156001141561018d565b5061010030161515610186565b50610200301615156001141561017f565b5061040030161515610178565b506108003016151560011415610171565b506110003016151561016a565b634e487b7160e01b5f52604160045260245ffd5b631e4fbdf760e01b5f525f60045260245ffd5b5f80fd5b51906001600160a01b03821682036102f35756fe6080806040526004361015610012575f80fd5b5f905f3560e01c90816308b66372146111925750806321d0ee7014611128578063259982e5146110a75780632c81403914611077578063328346b3146110345780633ada534c14610fc25780633f4ba83a14610f56578063452a932014610f2e5780635158754214610ef5578063575e24b414610c575780635c975abb14610c3357806362308e8514610bef5780636817031b14610b895780636c2bbe7e14610b5b5780636f162fe114610b405780636fe7e6eb14610af5578063715018a614610a9e5780637d9f6db514610a765780638456cb59146109e25780638a0dac4a1461097c5780638da5cb5b146109555780639af158b3146109265780639f063efc146108f8578063aba468ef146108c9578063b47b2fb114610726578063b6a8b0fa14610700578063b8c6f579146106a0578063c6c2c2ca14610621578063c6c71ab4146105da578063d1629029146105ab578063d525f08d1461055d578063dc98354e1461051b578063e1b4af69146104f5578063e2a65b87146104d7578063f2fde38b14610451578063f74f163714610422578063fa5c5117146101eb5763fbfa77cf146101c0575f80fd5b346101e857806003193601126101e8576002546040516001600160a01b039091168152602090f35b80fd5b50346101e8576101403660031901126101e85760043560243562ffffff811680910361041e576044359062ffffff821680920361041a576084359162ffffff83168093036104165760a435928315158094036104125760c4359283151580940361040e576102576112e3565b9161010435918260020b830361040a57610124359463ffffffff861686036104065761028161157c565b6040519160e0830183811067ffffffffffffffff8211176103f2578962ffffff8060028f978f95987f99c2af6d3689b38d160ff1200912b88b345dec56c6fd7f0767d224ca537c98bd9f9d9b999860409f9d9b99986040998f9a528352602083019081528f858181928601946064358652606087019d8e52608087019a8b5260a087019c8d5260c087019b60018d5281526006602052209451161685198454161783555165ffffff00000083549160181b169065ffffff0000001916178255516001820155019551161662ffffff198554161784555115159163ff00000065ff000000000064ff0000000086549351151560201b169351151560281b169360181b169065ffffff0000001916171717905587895260076020528589209269ffffff0000000000000084549163ffffffff60681b9060681b169360381b169070ffffffffffffffffffff000000000000001916179060501b62ffffff60501b161717905582519182526020820152a280f35b634e487b7160e01b8c52604160045260248cfd5b8980fd5b8880fd5b8680fd5b8580fd5b8480fd5b8380fd5b8280fd5b50346101e85760203660031901126101e85762ffffff60406020926004358152600a8452205416604051908152f35b50346101e85760203660031901126101e85761046b6111ac565b61047361157c565b6001600160a01b031680156104c35781546001600160a01b03198116821783556001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08380a380f35b631e4fbdf760e01b82526004829052602482fd5b50346101e857806003193601126101e8576020600854604051908152f35b50346101e857610504366112f3565b505050505050602060405163e1b4af6960e01b8152f35b50346101e85760e03660031901126101e8576105356111ac565b5060a03660231901126101e85761054a6112cd565b50604051636e4c1aa760e11b8152602090f35b50346101e85760203660031901126101e8577f3ec5f0b697fc7e9d726d35814f2cf16800b8d58edd21157520e5396874c24f75602060043561059d61157c565b80600855604051908152a180f35b50346101e85760203660031901126101e85760ff60406020926004358152600584522054166040519015158152f35b50346101e85760403660031901126101e85761061e6105f7611254565b6105ff61157c565b60043583526005602052604083209060ff801983541691151516179055565b80f35b50346101e85760203660031901126101e857604060e091600435815260066020522060ff815491600260018201549101549062ffffff60405194818116865260181c166020850152604084015262ffffff81166060840152818160181c1615156080840152818160201c16151560a084015260281c16151560c0820152f35b50346101e85760203660031901126101e8576106ba6111ac565b6106c261157c565b600354906001600160a01b0382166106f1576001600160a01b03166001600160a01b0319919091161760035580f35b6351a05b4d60e01b8352600483fd5b50346101e85761070f366112f3565b5050505050506020604051635b54587d60e11b8152f35b503461085d5761016036600319011261085d576107416111ac565b5060a036602319011261085d5760603660c319011261085d576101443567ffffffffffffffff811161085d5761077b9036906004016111c2565b507f000000000000000000000000000000000000000000000000000000000000000090506001600160a01b03811633036108ba5760a06107ba3661139d565b208091815f52600660205260ff600260405f20015460181c16801561089e575b610875575b50505f52600960205260ff60405f20541680610861575b610812575b60409081519063b47b2fb160e01b82526020820152f35b6002546001600160a01b031690813b1561085d575f809260046040518095819363232c320360e01b83525af161084a575b90506107fb565b505f6108559161137b565b60405f610843565b5f80fd5b506002546001600160a01b031615156107f6565b61089791610882916115a2565b50509050825f52600760205260405f20611bb6565b805f6107df565b50815f52600660205260ff600260405f20015460201c166107da565b63f655705d60e01b5f5260045ffd5b3461085d57602036600319011261085d576004355f526004602052602060ff60405f2054166040519015158152f35b3461085d5761090636611263565b5050604080516327c18fbf60e21b81525f60208201529095509350505050f35b3461085d57602036600319011261085d576004355f526009602052602060ff60405f2054166040519015158152f35b3461085d575f36600319011261085d575f546040516001600160a01b039091168152602090f35b3461085d57602036600319011261085d576109956111ac565b61099d61157c565b600180546001600160a01b0319166001600160a01b039290921691821790557fe6c09ffe4572dc9ceaa5ddde4ae41befa655d6fdfe8052077af0970f700e942e5f80a2005b3461085d575f36600319011261085d576001546001600160a01b031633141580610a62575b610a5357610a1361155f565b5f805460ff60a01b1916600160a01b1790556040513381527f62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a25890602090a1005b630fd901ef60e01b5f5260045ffd5b505f546001600160a01b0316331415610a07565b3461085d575f36600319011261085d576003546040516001600160a01b039091168152602090f35b3461085d575f36600319011261085d57610ab661157c565b5f80546001600160a01b0319811682556001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08280a3005b3461085d5761010036600319011261085d57610b0f6111ac565b5060a036602319011261085d57610b246112cd565b50610b2d6112e3565b50604051636fe7e6eb60e01b8152602090f35b3461085d5760a036600319011261085d57610b59611448565b005b3461085d57610b6936611263565b505060408051633615df3f60e11b81525f60208201529095509350505050f35b3461085d57602036600319011261085d57610ba26111ac565b610baa61157c565b600280546001600160a01b0319166001600160a01b039290921691821790557f161584aed96e7f34998117c9ad67e2d21ff46d2a42775c22b11ed282f3c7b2cd5f80a2005b3461085d575f36600319011261085d576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461085d575f36600319011261085d57602060ff5f5460a01c166040519015158152f35b3461085d5761014036600319011261085d57610c716111ac565b5060a036602319011261085d5760603660c319011261085d576101243567ffffffffffffffff811161085d57610cab9036906004016111c2565b507f000000000000000000000000000000000000000000000000000000000000000090506001600160a01b03811633036108ba5760a0610cea3661139d565b2090815f526006602052610d028260405f20926115a2565b50509050600282015460ff8160201c16610edb575b835f52600460205260ff60405f20541680610ec7575b15610e53575090610d3e918361184e565b90925b5f52600960205260ff60405f20541680610e3f575b610d7f575b62ffffff906060936040519363ffffffff60e01b1684526020840152166040820152f35b60e4355f811215610e3a57610d9390611424565b600854811015610da4575b50610d5b565b6002546001600160a01b03169060c435801515919082810361085d57602092604491505f60405195869485936304753a0560e01b8552600485015260248401525af115610d9e576020813d602011610e32575b81610e046020938361137b565b8101031261085d5751906fffffffffffffffffffffffffffffffff8216820361085d57905062ffffff610d9e565b3d9150610df7565b610d93565b506002546001600160a01b03161515610d56565b91926315d7892d60e21b925f945f9360ff8360181c16610e76575b505050610d41565b839450610eb4610ebd9392610e9e62ffffff9362400000975f52600760205260405f206116d6565b600182549201549184808260181c169116611737565b91169084611787565b1790848080610e6e565b506003546001600160a01b03161515610d2d565b835f526007602052610ef08260405f20611666565b610d17565b3461085d57602036600319011261085d576004355f5260076020526040805f205460ff8251918060020b835260881c1615156020820152f35b3461085d575f36600319011261085d576001546040516001600160a01b039091168152602090f35b3461085d575f36600319011261085d57610f6e61157c565b5f5460ff8160a01c1615610fb35760ff60a01b19165f556040513381527f5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa90602090a1005b638dfc202b60e01b5f5260045ffd5b3461085d57604036600319011261085d576004357fb1fbfd52db68f0959505929382ee20b39fd7f611771cad964153fb2eb53ba4c96020611001611254565b61100961157c565b835f52600982526110298160405f209060ff801983541691151516179055565b6040519015158152a2005b3461085d57604036600319011261085d57610b59611050611254565b61105861157c565b6004355f52600460205260405f209060ff801983541691151516179055565b3461085d57602036600319011261085d576004355f52600b602052602063ffffffff60405f205416604051908152f35b3461085d576110b5366111f0565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330390506108ba576110f261155f565b6002546001600160a01b039081169116036111195760405163259982e560e01b8152602090f35b636bada06160e11b5f5260045ffd5b3461085d57611136366111f0565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330390506108ba576002546001600160a01b039081169116036111195760405163021d0ee760e41b8152602090f35b3461085d575f36600319011261085d5780610ac860209252f35b600435906001600160a01b038216820361085d57565b9181601f8401121561085d5782359167ffffffffffffffff831161085d576020838186019501011161085d57565b9061016060031983011261085d576004356001600160a01b038116810361085d579160a060231982011261085d57602491608060c31983011261085d5760c491610144359067ffffffffffffffff821161085d57611250916004016111c2565b9091565b60243590811515820361085d57565b906101a060031983011261085d576004356001600160a01b038116810361085d579160a060231982011261085d57602491608060c31983011261085d5760c49161014435916101643591610184359067ffffffffffffffff821161085d57611250916004016111c2565b60c435906001600160a01b038216820361085d57565b60e435908160020b820361085d57565b61012060031982011261085d576004356001600160a01b038116810361085d579160a060231983011261085d5760249160c4359160e43591610104359067ffffffffffffffff821161085d57611250916004016111c2565b60a0810190811067ffffffffffffffff82111761136757604052565b634e487b7160e01b5f52604160045260245ffd5b90601f8019910116810190811067ffffffffffffffff82111761136757604052565b60a090602319011261085d57604051906113b68261134b565b816024356001600160a01b038116810361085d5781526044356001600160a01b038116810361085d57602082015260643562ffffff8116810361085d5760408201526084358060020b810361085d57606082015260a435906001600160a01b038216820361085d5760800152565b600160ff1b8114611434575f0390565b634e487b7160e01b5f52601160045260245ffd5b60a036600319011261085d576040516114608161134b565b6004356001600160a01b038116810361085d5781526024356001600160a01b038116810361085d57602082015260443562ffffff8116810361085d5760408201526064358060020b810361085d576060820152608435906001600160a01b038216820361085d5760a091608082015220805f52600760205260405f2060ff815460881c161561155b5760407f5e6708c0408b7890cf44d46877c488539aefbf199ced0aaa7aec9cb98a2b158091611537847f00000000000000000000000000000000000000000000000000000000000000006115a2565b50509190506115468282611bb6565b5460020b90825191825260020b6020820152a2565b5050565b60ff5f5460a01c1661156d57565b63d93c066560e01b5f5260045ffd5b5f546001600160a01b0316330361158f57565b63118cdaa760e01b5f523360045260245ffd5b919060209060405182810191825260066040820152604081526115c660608261137b565b519020604051631e2eaeaf60e01b8152600481019190915292839060249082906001600160a01b03165afa91821561165b575f92611627575b506001600160a01b0382169160a081901c60020b9162ffffff60b883901c81169260d01c1690565b9091506020813d602011611653575b816116436020938361137b565b8101031261085d5751905f6115ff565b3d9150611636565b6040513d5f823e3d90fd5b9081549160ff8360881c161580156116ab575b6116a65762ffffff9161168b916116d6565b9160501c161061169757565b6369e2517960e11b5f5260045ffd5b505050565b508260501c60020b15611679565b600291820b910b0390627fffff198212627fffff83131761143457565b549060ff8260881c16156117115762ffffff9160020b90818160020b12155f146117085790611704916116b9565b1690565b611704916116b9565b50505f90565b8181029291811591840414171561143457565b9190820180921161143457565b62ffffff61174a81956117519495611717565b911661172a565b90828116611773575081620f42405b1680821161176d57501690565b90501690565b8290611760565b9190820391821161143457565b9291835f52600a60205262ffffff60405f205416845f52600b60205263ffffffff60405f20541681158015611841575b156117fe57505050915b805f52600a60205260405f2062ffffff841662ffffff198254161790555f52600b60205260405f2063ffffffff431663ffffffff19825416179055565b919290914363ffffffff1681036118195750509050916117c1565b61183b9362ffffff61182e611835934361177a565b9116611717565b91611cef565b916117c1565b5062ffffff8316156117b7565b60035460408051631504460f60e01b8152600481018490529295945f94929091908490602490829088906001600160a01b03165af192831561165b575f905f94611b60575b506001600160a01b031615611a9a57505062ffffff1692620f4240841015611a8b5760e4355f811380611a74575b611a65575f81129460c4358015159081810361085d57508603611a4057602435906001600160a01b038216820361085d57620f424092826119129350975b1561190d5761190d90611424565b611717565b04938415611a29576003546001600160a01b03908116917f000000000000000000000000000000000000000000000000000000000000000090911690813b1561085d575f91606483926040519485938492630b0d9c0960e01b845260018060a01b03169788600485015260248401528b60448401525af1801561165b57611a14575b506003546001600160a01b031691823b1561041a579060648492836040519586948593634a268d8760e01b8552600485015260248401528960448401525af18015611a09576119f4575b506315d7892d60e21b9260801b91624000009150565b6119ff82809261137b565b6101e857806119de565b6040513d84823e3d90fd5b611a219193505f9061137b565b5f915f611994565b506315d7892d60e21b93505f926240000092509050565b604435906001600160a01b038216820361085d57620f424092826119129350976118ff565b6321b865b360e01b5f5260045ffd5b50815f52600560205260ff60405f205416156118c1565b63cd4e616760e01b5f5260045ffd5b9093949250819360028201549360ff8560181c16611acc575b506315d7892d60e21b955f956240000017945092505050565b60019462ffffff611b148195611af0611b1c96865f52600760205260405f206116d6565b815491848360181c1680155f14611b56575084620186a09b8c925b01549316611737565b911691611787565b911662ffffff821611611b4e575b5062ffffff811662ffffff831611611b46575b80808080611ab3565b90505f611b3d565b91505f611b2a565b85909b8c92611b0b565b9350506040833d604011611bae575b81611b7c6040938361137b565b8101031261085d578251926001600160a01b038416840361085d57602001519262ffffff8416840361085d575f611893565b3d9150611b6f565b60ff815460881c1615611cb557805463ffffffff8160181c16804314611caf57611be3611c16914361177a565b63ffffffff8360681c1680155f14611ca4575063ffffffff60015b16808211611c9c575b5062ffffff8360381c16611717565b9060020b90808203915f821281841281169082851390151617611434575f828201928312911290801582169115161761143457611c829360020b82811215611c845750505b815466ffffffffffffff191662ffffff91909116174360181b66ffffffff00000016179055565b565b90915081811315611c955750611c5b565b9050611c5b565b90505f611c07565b63ffffffff90611bfe565b50505050565b805466ffffffffffffff191662ffffff909216919091174360181b66ffffffff00000016178155805460ff60881b1916600160881b179055565b90919062ffffff168015611d595762ffffff831691818311611d3d5780821115611d3357611d1c9161177a565b80915b1015611d2f5762ffffff91501690565b5090565b50505f8091611d1f565b611d469161172a565b8091115f14611d2f5762ffffff91501690565b50509056fea2646970667358221220781e4f53725c953bdf30b2db850f8bce38ad0b39090e7dbaa48facf7fa83aeb764736f6c634300081a0033" as const;
