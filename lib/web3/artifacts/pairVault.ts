// AUTO-GENERATED from forge build — MintwareDeFiPairVault — engine build (idle-in-Aave + JIT + surge + 60/30/10).
// Full ABI + creation bytecode. Regenerate after any contract change.
export const PAIR_VAULT_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_poolManager",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_poolKey",
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
        "name": "_profile",
        "type": "uint8",
        "internalType": "enum PoolProfile"
      },
      {
        "name": "_treasury",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_provider",
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
    "name": "ACC_PRECISION",
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
    "name": "BPS",
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
    "name": "JIT_SALT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "JIT_WIDTH_SPACINGS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "LOCK_ALIGNED",
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
    "name": "LOCK_COMMITTED",
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
    "name": "LOCK_CORE",
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
    "name": "MAX_NON_LP_FEE_BPS",
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
    "name": "MINTWARE_FEE_BPS",
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
    "name": "MIN_HOLD_PERIOD",
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
    "name": "NOTICE_PERIOD",
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
    "name": "PENALTY_TIER_1_BPS",
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
    "name": "PENALTY_TIER_2_BPS",
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
    "name": "PENALTY_TIER_3_BPS",
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
    "name": "VIRTUAL_LIQUIDITY",
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
    "name": "accFee0PerShare",
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
    "name": "accFee1PerShare",
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
    "name": "adapter0",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IYieldAdapter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "adapter1",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IYieldAdapter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bufferRatioBps",
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
    "name": "buybackFeeBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "buybackSink",
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
    "name": "claimFees",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "collectFees",
    "inputs": [],
    "outputs": [
      {
        "name": "fee0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "fee1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "amount0Desired",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1Desired",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minShares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "enum LockTier"
      }
    ],
    "outputs": [
      {
        "name": "sharesMinted",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "distributorVaultId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "executeRedeem",
    "inputs": [],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "fee0Debt",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "fee1Debt",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "feeReserve0",
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
    "name": "feeReserve1",
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
    "name": "fundRent",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
    "name": "harvestYield",
    "inputs": [],
    "outputs": [
      {
        "name": "lp0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lp1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hook",
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
    "name": "idle0",
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
    "name": "idle1",
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
    "name": "idleLiquidity",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initializePool",
    "inputs": [
      {
        "name": "sqrtPriceX96",
        "type": "uint160",
        "internalType": "uint160"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "jitActive",
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
    "name": "jitClaim0",
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
    "name": "jitClaim1",
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
    "name": "jitClose",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "jitLiquidity",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "jitMaxPerBlock",
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
    "name": "jitMaxPerSwap",
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
    "name": "jitOpen",
    "inputs": [
      {
        "name": "zeroForOne",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "outputBudget",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "L",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "jitPositionLiquidity",
    "inputs": [],
    "outputs": [
      {
        "name": "liq",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "jitTickLower",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "jitTickUpper",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "locks",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "depositedAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lockedUntil",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "enum LockTier"
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
    "name": "pendingFees",
    "inputs": [
      {
        "name": "lp",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "fee0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "fee1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolInitialized",
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
    "name": "poolKey",
    "inputs": [],
    "outputs": [
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
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolManager",
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
    "name": "positionLiquidity",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "profile",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum PoolProfile"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "profileHalfWidth",
    "inputs": [
      {
        "name": "p",
        "type": "uint8",
        "internalType": "enum PoolProfile"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "provider",
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
    "name": "rebalanceBuffer",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rebalanceToProfile",
    "inputs": [
      {
        "name": "p",
        "type": "uint8",
        "internalType": "enum PoolProfile"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recallIdle",
    "inputs": [
      {
        "name": "deltaL",
        "type": "uint128",
        "internalType": "uint128"
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
    "name": "rentDust0",
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
    "name": "rentDust1",
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
    "name": "rentFunder",
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
    "name": "requestRedeem",
    "inputs": [
      {
        "name": "shares_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAdapters",
    "inputs": [
      {
        "name": "a0",
        "type": "address",
        "internalType": "contract IYieldAdapter"
      },
      {
        "name": "a1",
        "type": "address",
        "internalType": "contract IYieldAdapter"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setBufferRatio",
    "inputs": [
      {
        "name": "bps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setBuybackSink",
    "inputs": [
      {
        "name": "sink",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFeeSplit",
    "inputs": [
      {
        "name": "treasuryBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "buybackBps",
        "type": "uint16",
        "internalType": "uint16"
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
    "name": "setHook",
    "inputs": [
      {
        "name": "h",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setJitCaps",
    "inputs": [
      {
        "name": "perSwap",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "perBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRentFunder",
    "inputs": [
      {
        "name": "_funder",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setWeightedDistributor",
    "inputs": [
      {
        "name": "dist",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vaultId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "shares",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "supplyIdle",
    "inputs": [
      {
        "name": "deltaL",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sweepJitClaims",
    "inputs": [],
    "outputs": [
      {
        "name": "r0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "r1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tickLower",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tickUpper",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token0",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token1",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalLiquidity",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalManagedLiquidity",
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
    "name": "treasury",
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
    "name": "treasuryFeeBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unlockCallback",
    "inputs": [
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
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
    "name": "weightedDistributor",
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
    "name": "withdrawals",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "noticeExpiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "executed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AdaptersSet",
    "inputs": [
      {
        "name": "adapter0",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "adapter1",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BufferRatioSet",
    "inputs": [
      {
        "name": "bufferRatioBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BuybackSinkSet",
    "inputs": [
      {
        "name": "sink",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Deposited",
    "inputs": [
      {
        "name": "lp",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "sharesMinted",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "tier",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum LockTier"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeSplitSet",
    "inputs": [
      {
        "name": "treasuryBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "buybackBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "lpBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesClaimed",
    "inputs": [
      {
        "name": "lp",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesCollected",
    "inputs": [
      {
        "name": "fee0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "treasury0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "treasury1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "buyback0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "buyback1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesRoutedToDistributor",
    "inputs": [
      {
        "name": "vaultId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "lp0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lp1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
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
    "name": "HookSet",
    "inputs": [
      {
        "name": "hook",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Idled",
    "inputs": [
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "amount0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JitCapsSet",
    "inputs": [
      {
        "name": "perSwap",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "perBlock",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JitClaimsSwept",
    "inputs": [
      {
        "name": "redeemed0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "redeemed1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JitClosed",
    "inputs": [
      {
        "name": "taken0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "taken1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "claimed0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "claimed1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JitOpened",
    "inputs": [
      {
        "name": "zeroForOne",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "principal",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "tickLower",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
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
    "name": "PoolInitialized",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sqrtPriceX96",
        "type": "uint160",
        "indexed": false,
        "internalType": "uint160"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProfileSet",
    "inputs": [
      {
        "name": "profile",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum PoolProfile"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Rebalanced",
    "inputs": [
      {
        "name": "tickLower",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "indexed": false,
        "internalType": "int24"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RedeemRequested",
    "inputs": [
      {
        "name": "lp",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "shares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "noticeExpiry",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Redeemed",
    "inputs": [
      {
        "name": "lp",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "shares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "penalty0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "penalty1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Refilled",
    "inputs": [
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "amount0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RentFunded",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RentFunderSet",
    "inputs": [
      {
        "name": "funder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
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
    "name": "WeightedDistributorSet",
    "inputs": [
      {
        "name": "distributor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "vaultId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "YieldHarvested",
    "inputs": [
      {
        "name": "lp0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lp1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "mintware0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "mintware1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AaveTemporarilyIlliquid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AdapterAssetMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AdaptersAlreadySet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AdaptersNotSet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyExecuted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadBufferRatio",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadFeeSplit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyRange",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HookAlreadySet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientShares",
    "inputs": []
  },
  {
    "type": "error",
    "name": "JitInProgress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LockTierChangeNotAllowed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MinHoldNotMet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoRequest",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotGuardianOrOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoticeNotExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyHook",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyProvider",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyRentFunder",
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
    "name": "PoolAlreadyInitialized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PoolNotInitialized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "WeightedDistributorAlreadySet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroDistributor",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroLiquidity",
    "inputs": []
  }
] as const;

export const PAIR_VAULT_BYTECODE = "0x610120604052346104865760405161621e38819003601f8101601f191683016001600160401b0381118482101761048a578392829160405283398101039061014082126104865760a06100518261049e565b92601f1901126104865760405160a081016001600160401b0381118282101761048a576040526100836020830161049e565b81526100916040830161049e565b906020810191825260608301519162ffffff83168303610486576040820192835260808401518060020b8103610486576060830190815260a0850151906001600160a01b0382168203610486576080840191825260c08601519460038610156104865761010060e0880161049e565b61010d610100890161049e565b976001600160a01b0390610124906101200161049e565b16988915610473575f80546001600160a01b031981168c1782556040519b916001600160a01b03909116907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09080a360017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00556001600160a01b0390811660805260a082905216158015610462575b61044257845184516001600160a01b0390811696911694908515801561045a575b8015610451575b6104425751600280546001600160a01b03199081166001600160a01b0393841617909155915160038054945195516001600160d01b03199095169183169190911760a09590951b62ffffff60a01b169490941762ffffff60b81b60b89490941b9390931692909217909255915160048054909216921691909117905560c05260e0526005805460ff60381b191660389290921b67ff0000000000000016919091179055610100526010805463ffffffff19166303e80bb8179055615d6b90816104b38239608051818181610bbd01528181610ee901528181611227015281816124d1015281816132e601528181613cff015281816143b3015281816148f901528181614e680152818161500401528181615ad50152615ba7015260a0518181816107fd01528181612063015281816123ca0152818161241a01528181613f41015281816152c401528181615315015281816153e70152615437015260c05181818161079f01528181611f430152818161239b0152818161243b01528181612eb3015281816130d80152818161321301528181613dcd01528181614b7b01528181614ea901528181615336015281816153b80152818161545801528181615b150152615be7015260e0518181816107c401528181610ca701528181611f220152818161236b015281816123eb0152818161310b015281816132410152818161410e01528181614b4901528181614ed1015281816152e5015281816153860152818161540801528181615b430152615c1501526101005181818161067d01528181610aec01528181610e630152818161117601528181612ba301528181612c9d0152612f8b0152f35b6301f30c8760e21b5f5260045ffd5b508686146101db565b5086156101d4565b506001600160a01b038716156101b3565b631e4fbdf760e01b5f525f60045260245ffd5b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036104865756fe6080806040526004361015610012575f80fd5b5f905f3560e01c9081623c8bd4146136b057508062ce24e61461369457806301c5be28146131b857806302f059961461306857806304753a0514612ffd57806304aedc7614612fe257806307f0197d14612fba578063085d488314612f765780630ba3984714612eff5780630d88169a14612ee25780630dfe168114612e9e5780630f0824dc14612e6757806314caf88114612e245780631523fc7f14612dff57806315770f9214612dd6578063182148ef14612d7a5780631fcaecb814612d52578063200e409214612d3557806322fd85b114612c76578063232c320314612c325780632374ff2914612b90578063249d39e914612b7457806325d2a3f314612ae85780632f4d89ee14612ac157806332fcd96614612a9f57806335cd299e14612a3a5780633af349cc14612a1d5780633dfd3873146129715780633f4ba83a14612905578063452a9320146128dd5780634ac37508146128b55780634b92d98d146128985780634b9738901461287b57806355b812a81461285957806359c4f905146128365780635c23058f146128195780635c974c9c146127fc5780635c975abb146127d85780635db3e0a7146127bc5780635dccdb0e146127895780635de9a137146127235780635fa51bd01461209257806361d027b31461204e5780636720abd9146120315780636abe200c14611ec45780636c0e475b14611ea6578063715018a614611e4c5780637211dc3614611e255780637585915414611e07578063770d9c7514611d9f5780637a9262a214611d495780637f5a7c7b14611d1c5780638456cb5914611c8757806384b241e014611c6957806388e8e12c14611c4d5780638a0dac4a14611be55780638da5cb5b14611bbe5780639174d85c14611ba057806391dd734614611b2e578063929bf13614611b0257806392f6b31c14611adb5780639c57e2da14611ab7578063a0eb1ad214611a93578063a8f0bcef14611a75578063aa2f892d14611919578063ab48b09e1461114b578063ab60636c1461111e578063b06f15a714610e41578063b61a21d214610e1c578063b86b9fdd14610dc3578063b98ad25514610da0578063bc6d6a4214610d64578063c879657214610d0f578063ce7c2ac214610cd6578063d21220a714610c91578063d282ad6b14610c73578063d294f09314610c44578063d4e3210d14610c26578063d6ad3bdd14610c08578063d810a6e914610bec578063dc4c90d314610ba7578063e00f368f14610ac4578063e148e4c114610aa6578063e1960ca614610a7d578063e38f6a5514610a5f578063e7e452a414610a26578063e80cfa5e14610a04578063e8d991d114610669578063f2923a241461064d578063f2fde38b146105c7578063f5dd6a08146105aa578063f7fd6e9614610571578063f883b1cd14610548578063f89784011461045a5763fe26810f14610431575f80fd5b3461045757806003193601126104575760206001600160801b03601d5416604051908152f35b80fd5b50346104575760403660031901126104575760043561ffff81168091036105445760243561ffff81169081810361054057610493614cb6565b610fa06104a08385613874565b11610531578263ffff00006010549260101b169163ffffffff19161717601055816127100361ffff811161051d5761ffff829116039061ffff821161051d579161ffff6060927fdaaf57b4facaa4cff151ba70473385f6ed2714defe0683dedc9b92d4a3f7c6b1946040519384526020840152166040820152a180f35b634e487b7160e01b84526011600452602484fd5b631dd0258b60e31b8452600484fd5b8380fd5b5080fd5b50346104575780600319360112610457576016546040516001600160a01b039091168152602090f35b5034610457576020366003190112610457576020906040906001600160a01b036105996136cb565b168152600d83522054604051908152f35b503461045757806003193601126104575760206040516103e88152f35b5034610457576020366003190112610457576105e16136cb565b6105e9614cb6565b6001600160a01b031680156106395781546001600160a01b03198116821783556001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08380a380f35b631e4fbdf760e01b82526004829052602482fd5b5034610457578060031936011261045757602060405160c88152f35b5034610457578060031936011261045757337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161415806109f0575b6109e1576106b96149d8565b6106c1614a10565b60ff601d5460b01c166109d2576016546001600160a01b031680156109c3576106e8615970565b600a548152600b5460208201908152601454906040830191825260155492606081019384528560405161071a81613725565b8181528160208201528160408201528160608201528160808201528160a08201528160c08201528160e0820152816101008201526101200152600160a01b6001900360175416600160a01b60019003600e5416600f54601854906019549260055460401c6001600160801b0316946040519061079582613725565b6001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811683527f000000000000000000000000000000000000000000000000000000000000000081166020840190815260408085019e8f52606085019384527f000000000000000000000000000000000000000000000000000000000000000083166080860190815260a0860196875260c0860197885260e086019889526101008601998a5261012086019a8b52905163017a17f360e61b81529451831660048601529051821660248501529c51811660448401529051811660648301529a518b166084820152905190991660a48a01525160c48901525160e488015251610104870152516001600160801b0316610124860152516101448501525161016484015251610184830152516101a4820152808073__$3f3546bcd813ee5b64548ead6cd9e9417a$__5a926101c49160c094f480156109b857828092819261093a575b505060608360409451600a556020810151600b5584810151601455015160155560015f80516020615cd68339815191525582519182526020820152f35b92509250508060c03d60c0116109b1575b61095581836137c2565b81010360c081126109ad57608013610544576040809250519061097782613755565b8051825260208101516020830152828101518383015260608101516060830152606060a0608083015192015192919291936108fd565b8280fd5b503d61094b565b6040513d84823e3d90fd5b630e12f94160e11b8252600482fd5b636687fb8760e01b8152600490fd5b63eb79da3b60e01b8152600490fd5b5080546001600160a01b03163314156106ad565b5034610457578060031936011261045757602061ffff60105416604051908152f35b5034610457576020366003190112610457576020906040906001600160a01b03610a4e6136cb565b168152600c83522054604051908152f35b50346104575780600319360112610457576020601b54604051908152f35b50346104575780600319360112610457576011546040516001600160a01b039091168152602090f35b5034610457578060031936011261045757602060405162278d008152f35b5034610457576020366003190112610457576004356001600160801b038116810361054457337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316141580610b93575b610b8457610b286149d8565b610b30614a10565b60ff601d5460b01c16610b75576016546001600160a01b0316156109c357610b6190610b5a614f89565b50506156b7565b60015f80516020615cd68339815191525580f35b636687fb8760e01b8252600482fd5b63eb79da3b60e01b8252600482fd5b5081546001600160a01b0316331415610b1c565b50346104575780600319360112610457576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5034610457578060031936011261045757602060405160648152f35b50346104575780600319360112610457576020601f54604051908152f35b50346104575780600319360112610457576020601454604051908152f35b5034610457578060031936011261045757610c5d6149d8565b60ff601d5460b01c166109d257610b6133614a2d565b50346104575780600319360112610457576020600b54604051908152f35b50346104575780600319360112610457576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5034610457576020366003190112610457576020906040906001600160a01b03610cfe6136cb565b168152600783522054604051908152f35b5034610457578060031936011261045757610d286149d8565b610d30614a10565b60ff601d5460b01c166109d2576040610d47614f89565b60015f80516020615cd68339815191525582519182526020820152f35b50346104575780600319360112610457576020610d986001600160801b03600654166001600160801b03601a541690613874565b604051908152f35b5034610457578060031936011261045757602060ff600554166040519015158152f35b5034610457576040366003190112610457577fd5e7a8aa8f7d318f4da08b3c4ec9dfcf0837bf7448f974f37d95c14c5322ac096040600435602435610e06614cb6565b81601e5580601f5582519182526020820152a180f35b5034610457578060031936011261045757602061ffff60105460101c16604051908152f35b50346104575760203660031901126104575760043590600382101561045757337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614158061110a575b6109e157610e9f6149d8565b610ea7614a10565b60ff601d5460b01c166109d25760ff60055416156110fb57610ed260a0610ecc6147f2565b20615c54565b604051631e2eaeaf60e01b815260048101919091527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169290602081602481875afa80156110f05783906110bc575b610f3a915060a01c60020b82615922565b9060020b9060020b818113156110ad5783610fe68196610f58614f89565b505060055460ff60381b8760381b169060ff60381b191617600555610fb4610fc260405187602082015286604082015260408152610f976060826137c2565b6040519283916002602084015260408084015260608301906136ee565b03601f1981018352826137c2565b6040519788809481936348c8949160e01b83526020600484015260248301906136ee565b03925af19384156110a25761104d6060947f9c8daf43131b569ba832e1a36c541080a4ce144333aa10bd18693bdc14bfad77927fc2df45ace19779c8cee33727e1cf9829c78beb3141250e153674e7825f631dad97611082575b5060405191829182613712565b0390a16001600160801b03600654169060405192835260208301526040820152a160015f80516020615cd68339815191525580f35b61109d903d808b833e61109581836137c2565b8101906137fe565b611040565b6040513d87823e3d90fd5b631929b88360e21b8452600484fd5b506020813d6020116110e8575b816110d6602093836137c2565b810103126109ad57610f3a9051610f29565b3d91506110c9565b6040513d85823e3d90fd5b63486aa30760e01b8152600490fd5b5080546001600160a01b0316331415610e93565b503461045757806003193601126104575761114760ff60055460381c1660405191829182613712565b0390f35b5034610457576020366003190112610457576004356001600160a01b038116919082810361054457337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316141580611905575b610b845760055460ff81166118f65760ff191660011760055560405163313b65df60e11b8152600280546001600160a01b03908116600480850191909152600354808316602486015260a081901c62ffffff16604486015260b81c90920b606484015290548116608483015260a48201859052602090829060c490829087907f0000000000000000000000000000000000000000000000000000000000000000165af180156110f0576118bf575b5060a061125f6147f2565b207f3feb82bb33469ba3cf8cff6b083c3f75ac5efabca67d981c5e161d2c8acf01c46020604051868152a273fffd8963efd1fc6a506488495d951d51639616826401000276a21982016001600160a01b0316116118ac5760201b640100000000600160c01b03168080156109ad5760ff826001600160801b031060071b83811c6001600160401b031060061b1783811c63ffffffff1060051b1783811c61ffff1060041b1783811c821060031b177f07060605060205000602030205040001060502050303040105050304000000006f8421084210842108cc6318c6db6d54be85831c1c601f161a17169160808310155f146118a05750607e1982011c5b800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c80029081607f1c8260ff1c1c80029283607f1c8460ff1c1c80029485607f1c8660ff1c1c80029687607f1c8860ff1c1c80029889607f1c8a60ff1c1c80029a8b607f1c8c60ff1c1c80029c8d80607f1c9060ff1c1c800260cd1c6604000000000000169d60cc1c6608000000000000169c60cb1c6610000000000000169b60ca1c6620000000000000169a60c91c6640000000000000169960c81c6680000000000000169860c71c670100000000000000169760c61c670200000000000000169660c51c670400000000000000169560c41c670800000000000000169460c31c671000000000000000169360c21c672000000000000000169260c11c674000000000000000169160c01c6780000000000000001690607f190160401b1717171717171717171717171717693627a301d71055774c85026f028f6481ab7f045a5af012a19d003aa919810160801d60020b906fdb2df09e81959a81455e260799a0632f0160801d60020b8082145f14611554575066ffffff000000009192505b6115316005549160ff8360381c16615922565b929060081b63ffffff00169260201b169066ffffffffffff001916171760055580f35b908160ff1d8281011893620d89e8851161188c57929366ffffff000000009390600160801b7001fffcb933bd6fad37aa2d162d1a5940016001831602189060028116611870575b60048116611854575b60088116611838575b6010811661181c575b60208116611800575b604081166117e4575b608081166117c8575b61010081166117ac575b6102008116611790575b6104008116611774575b6108008116611758575b611000811661173c575b6120008116611720575b6140008116611704575b61800081166116e8575b6201000081166116cc575b6202000081166116b1575b620400008116611696575b6208000016611680575b858413611678575b63ffffffff0160201c6001600160a01b031611611671575061151e565b905061151e565b5f1904611654565b6b048a170391f7dc42444e8fa20260801c61164c565b6d2216e584f5fa1ea926041bedfe9890910260801c90611642565b906e5d6af8dedb81196699c329225ee6040260801c90611637565b906f09aa508b5b7a84e1c677de54f3e99bc90260801c9061162c565b906f31be135f97d08fd981231505542fcfa60260801c90611621565b906f70d869a156d2a1b890bb3df62baf32f70260801c90611617565b906fa9f746462d870fdf8a65dc1f90e061e50260801c9061160d565b906fd097f3bdfd2022b8845ad8f792aa58250260801c90611603565b906fe7159475a2c29b7443b29c7fa6e889d90260801c906115f9565b906ff3392b0822b70005940c7a398e4b70f30260801c906115ef565b906ff987a7253ac413176f2b074cf7815e540260801c906115e5565b906ffcbe86c7900a88aedcffc83b479aa3a40260801c906115db565b906ffe5dee046a99a2a811c461f1969c30530260801c906115d1565b906fff2ea16466c96a3843ec78b326b528610260801c906115c8565b906fff973b41fa98c081472e6896dfb254c00260801c906115bf565b906fffcb9843d60f6159c9db58835c9266440260801c906115b6565b906fffe5caca7e10e4e61c3624eaa0941cd00260801c906115ad565b906ffff2e50f5f656932ef12357cf3c7fdcc0260801c906115a4565b906ffff97272373d413259a46990580e213a0260801c9061159b565b6345c3193d60e11b84526004839052602484fd5b905081607f031b61135d565b506024916318521d4960e21b8252600452fd5b6020813d6020116118ee575b816118d8602093836137c2565b810103126109ad576118e9906138df565b611254565b3d91506118cb565b637983c05160e01b8352600483fd5b5081546001600160a01b03163314156111a6565b5034610457576020366003190112610457576004356119366149d8565b60ff601d5460b01c16610b755733825260086020526040822054620151808101809111611a2e574210611a665780158015611a51575b611a425762093a804201804211611a2e57604051606081018181106001600160401b03821117611a1a5760405282815260026020820191838352604081019286845233875260096020526040872091518255516001820155019051151560ff8019835416911617905560405191825260208201527f58fe322fc5911ed072ec92f570e517b9793e350eb1ff7be0019fd9f3fade87bc60403392a260015f80516020615cd68339815191525580f35b634e487b7160e01b85526041600452602485fd5b634e487b7160e01b83526011600452602483fd5b633999656760e01b8252600482fd5b5033825260076020526040822054811161196c565b6331a3a70d60e11b8252600482fd5b50346104575780600319360112610457576020601854604051908152f35b50346104575780600319360112610457576020601d5460981c60020b604051908152f35b50346104575780600319360112610457576020601d5460801c60020b604051908152f35b503461045757806003193601126104575760206001600160801b03601a5416604051908152f35b50346104575780600319360112610457576020611b1d614840565b6001600160801b0360405191168152f35b5034610457576020366003190112610457576004356001600160401b0381116105445736602382011215610544578060040135916001600160401b03831161045757366024848401011161045757611147611b8c84602485016143b0565b6040519182916020835260208301906136ee565b50346104575780600319360112610457576020602354604051908152f35b5034610457578060031936011261045757546040516001600160a01b039091168152602090f35b503461045757602036600319011261045757611bff6136cb565b611c07614cb6565b600180546001600160a01b0319166001600160a01b039290921691821790557fe6c09ffe4572dc9ceaa5ddde4ae41befa655d6fdfe8052077af0970f700e942e8280a280f35b5034610457578060031936011261045757602060405160328152f35b50346104575780600319360112610457576020600f54604051908152f35b50346104575780600319360112610457576001546001600160a01b031633141580611d08575b611cf957611cb9614a10565b805460ff60a01b1916600160a01b1781556040513381527f62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a25890602090a180f35b630fd901ef60e01b8152600490fd5b5080546001600160a01b0316331415611cad565b5034610457578060031936011261045757601c5460405160089190911c6001600160a01b03168152602090f35b5034610457576020366003190112610457576060906040906001600160a01b03611d716136cb565b16815260096020522080549060ff600260018301549201541690604051928352602083015215156040820152f35b503461045757602036600319011261045757611db96136cb565b611dc1614cb6565b601180546001600160a01b0319166001600160a01b039290921691821790557fd703b9ccbd1ceac73b34c75ae5ea56096a2c2e2e6804b9f4fce2df6b2f75501e8280a280f35b5034610457578060031936011261045757602060405162ed4e008152f35b503461045757806003193601126104575760206001600160801b0360065416604051908152f35b5034610457578060031936011261045757611e65614cb6565b80546001600160a01b03198116825581906001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08280a380f35b50346104575780600319360112610457576020601e54604051908152f35b503461200f57604036600319011261200f57611ede6136cb565b60243590611eea614cb6565b6001600160a01b03811690811561202257600e546001600160a01b038116612013576001600160a01b0319168217600e55600f8390557f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000833b1561200f57604051631647f7cb60e01b8152600481018690526001600160a01b038281166024830152831660448201525f8160648183895af1801561200457611fe4575b5090611fb883611fbd9493615792565b615792565b7fba1b2edb5fc75597ba8a2c3eedf1e91cd0dce55ee0109f44ed9fda79f77356e68380a380f35b611fbd93929196505f611ff6916137c2565b5f9591925090611fb8611fa8565b6040513d5f823e3d90fd5b5f80fd5b631cba885360e01b5f5260045ffd5b632f83aa0f60e21b5f5260045ffd5b3461200f575f36600319011261200f576020602254604051908152f35b3461200f575f36600319011261200f576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461200f575f36600319011261200f576120aa6149d8565b6120b2614a10565b60ff601d5460b01c1661271457335f52600960205260405f20805490811561270557600281019081549060ff82166126f6576001015442106126e75782335f52600760205260405f2054106126d1575b60ff19166001179055612113614f89565b505061211e33614a2d565b60055460401c6001600160801b03169081159081156126b0575f915b801561269a575f935b8115612684575f915b1561265f57505f5b335f52600760205260405f2061216b8482546138b2565b9055600554600160401b600160c01b0361219a6001600160801b0386166001600160801b038460401c16614390565b60401b1690600160401b600160c01b031916176005556006546001600160801b036121c786828416614390565b16906001600160801b031916176006556121e3856018546138b2565b6018556121f2826019546138b2565b6019556001600160801b0361220c601a5492828416614390565b16906001600160801b03191617601a555f905f94806125e0575b5080612552575b505f6001600160801b035f941680612464575b50604094612255612284949361225b93613874565b94613874565b9261229e612268336156e7565b916122986127108061227a8685613881565b0496879589613881565b0493849281612414575b836123c4576138b2565b956138b2565b92335f526007602052670de0b6b3a76400006122c0875f2054600a5490613881565b04335f52600c602052865f2055335f526007602052670de0b6b3a76400006122ee875f2054600b5490613881565b04335f52600d602052865f205584612394575b83612364575b85519283528460208401528386840152606083015260808201527f09018aaedaafcf3a655b4c0e4a7c39bad2f98f367ef23f57b6d9062057db754760a03392a260015f80516020615cd68339815191525582519182526020820152f35b61238f84337f0000000000000000000000000000000000000000000000000000000000000000614c5e565b612307565b6123bf85337f0000000000000000000000000000000000000000000000000000000000000000614c5e565b612301565b61240f847f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000614c5e565b6138b2565b61245f827f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000614c5e565b61228e565b6124cc939294505f91506124aa610fb4916040519060208201526020815261248d6040826137c2565b6040519283916001602084015260408084015260608301906136ee565b604051809481926348c8949160e01b83526020600484015260248301906136ee565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19182156120045760409461225561252a6122849561225b945f91612538575b5060208082518301019101613c7c565b969093509394505094612240565b61254c91503d805f833e61109581836137c2565b8961251a565b601754604051632e1a7d4d60e01b8152600481018390529550602090869060249082905f906001600160a01b03165af1948515612004575f956125ac575b50841061259d578461222d565b63cef98b7760e01b5f5260045ffd5b9094506020813d6020116125d8575b816125c8602093836137c2565b8101031261200f57519385612590565b3d91506125bb565b601654604051632e1a7d4d60e01b8152600481018390529350602090849060249082905f906001600160a01b03165af1928315612004575f9361262b575b50821061259d5785612226565b9092506020813d602011612657575b81612647602093836137c2565b8101031261200f5751918661261e565b3d915061263a565b61267e6001600160801b03916126798584601a5416613881565b613894565b16612154565b6126948161267985601954613881565b9161214c565b6126aa8461267984601854613881565b93612143565b6001600160801b036126ca84612679848460065416613881565b169161213a565b335f908152600760205260409020549250612102565b6345c6758360e01b5f5260045ffd5b630dc1019760e01b5f5260045ffd5b6333ff64eb60e21b5f5260045ffd5b636687fb8760e01b5f5260045ffd5b3461200f57602036600319011261200f576001600160a01b036127446136cb565b165f526008602052608060405f2060ff8154916002600182015491015490604051938452602084015261277c604084018383166136e1565b60081c1615156060820152f35b3461200f57602036600319011261200f57600435600381101561200f576127b1602091614367565b6040519060020b8152f35b3461200f575f36600319011261200f5760206040516109c48152f35b3461200f575f36600319011261200f57602060ff5f5460a01c166040519015158152f35b3461200f575f36600319011261200f576020601554604051908152f35b3461200f575f36600319011261200f576020600a54604051908152f35b3461200f575f36600319011261200f57602060055460081c60020b604051908152f35b3461200f575f36600319011261200f576020600554811c60020b604051908152f35b3461200f575f36600319011261200f576020601354604051908152f35b3461200f575f36600319011261200f576020601254604051908152f35b3461200f575f36600319011261200f57601054604051602091821c6001600160a01b03168152f35b3461200f575f36600319011261200f576001546040516001600160a01b039091168152602090f35b3461200f575f36600319011261200f5761291d614cb6565b5f5460ff8160a01c16156129625760ff60a01b19165f556040513381527f5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa90602090a1005b638dfc202b60e01b5f5260045ffd5b3461200f57602036600319011261200f5761298a6136cb565b612992614cb6565b601c54600881901c6001600160a01b0316612a0e576001600160a01b0382169182156129ff57610100600160a81b031990911660089190911b610100600160a81b031617601c557f4eab7b127c764308788622363ad3e9532de3dfba7845bd4f84c125a22544255a5f80a2005b63d92e233d60e01b5f5260045ffd5b635f7c8ab560e11b5f5260045ffd5b3461200f575f36600319011261200f5760206040516276a7008152f35b3461200f57602036600319011261200f57600435612a56614cb6565b6127108111612a90576020817f54f0cb007518f20824cb2e1a56d23f020ebf45033b89ad9ab7a1ff858291879b92601b55604051908152a1005b6395de507d60e01b5f5260045ffd5b3461200f575f36600319011261200f576020604051670de0b6b3a76400008152f35b3461200f575f36600319011261200f5760206040515f80516020615d168339815191528152f35b3461200f57602036600319011261200f5760406001600160a01b03612b0b6136cb565b16805f526007602052612b68825f205491670de0b6b3a7640000612b55612b4b82612b38600a5488613881565b04845f52600c602052875f2054906138b2565b94600b5490613881565b04905f52600d602052835f2054906138b2565b82519182526020820152f35b3461200f575f36600319011261200f5760206040516127108152f35b3461200f575f36600319011261200f57337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316141580612c1e575b612c0f57612bdf6149d8565b612be7614a10565b60ff601d5460b01c1661271457612bfc6142af565b60015f80516020615cd683398151915255005b63eb79da3b60e01b5f5260045ffd5b505f546001600160a01b0316331415612bd3565b3461200f575f36600319011261200f57601c5460081c6001600160a01b03163303612c6757612c5f6149d8565b612bfc614151565b635a91834f60e01b5f5260045ffd5b3461200f57602036600319011261200f576004356001600160801b038116810361200f57337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316141580612d21575b612c0f57612cd96149d8565b612ce1614a10565b60ff601d5460b01c16612714576016546001600160a01b031615612d1257612bfc90612d0b614f89565b50506155e0565b630e12f94160e11b5f5260045ffd5b505f546001600160a01b0316331415612ccd565b3461200f575f36600319011261200f57602060405162093a808152f35b3461200f575f36600319011261200f576017546040516001600160a01b039091168152602090f35b3461200f575f36600319011261200f5760028054600354600454604080516001600160a01b039485168152838516602082015260a084811c62ffffff169282019290925260b89390931c90940b60608301529091166080820152f35b3461200f575f36600319011261200f5760206001600160801b0360055460401c16604051908152f35b3461200f575f36600319011261200f57602060ff601d5460b01c166040519015158152f35b3461200f57604036600319011261200f57612e3d6136cb565b612e456149d8565b612e4d614a10565b60ff601d5460b01c1661271457612bfc9060243590613da7565b3461200f575f36600319011261200f57612e7f6149d8565b612e87614a10565b60ff601d5460b01c16612714576040610d47613c92565b3461200f575f36600319011261200f576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461200f575f36600319011261200f576020601954604051908152f35b3461200f57602036600319011261200f57612f186136cb565b612f20614cb6565b60108054640100000000600160c01b031916602083901b640100000000600160c01b03161790556001600160a01b03167fc47debb30fbf1731ae61ac481bc381805a623ae1adaf1d7610f19c57ab6793185f80a2005b3461200f575f36600319011261200f576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461200f575f36600319011261200f57600e546040516001600160a01b039091168152602090f35b3461200f575f36600319011261200f57602060405160058152f35b3461200f57604036600319011261200f57600435801515810361200f57601c5460081c6001600160a01b03163303612c675761304660209161303d6149d8565b60243590613a70565b60015f80516020615cd6833981519152556001600160801b0360405191168152f35b3461200f57604036600319011261200f576130816136cb565b6024356001600160a01b038116919082900361200f5761309f614cb6565b601654906001600160a01b038216158015906131a4575b613195576001600160a01b0316908115801561318d575b6129ff5781906131067f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031683614cdc565b6131397f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031685614cdc565b6bffffffffffffffffffffffff60a01b1617601655816bffffffffffffffffffffffff60a01b60175416176017557f1480292b57c926add498b39efa3c345474cf76026bdf1aee212af0a09cc686895f80a3005b5082156130cd565b634dd6edb160e11b5f5260045ffd5b506017546001600160a01b031615156130b6565b3461200f57608036600319011261200f5760043560243590606435600481101561200f576131e46149d8565b6131ec614a10565b60ff601d5460b01c166127145760ff6005541615613685576132e19061321133614a2d565b7f00000000000000000000000000000000000000000000000000000000000000009061323f84303385614bcc565b7f000000000000000000000000000000000000000000000000000000000000000061326c86303384614bcc565b60ff19601c54169260ff8316809417601c555f610fb46132bf6040518960208201528a6040820152604081526132a36060826137c2565b60405192839185602084015260408084015260608301906136ee565b604051809781926348c8949160e01b83526020600484015260248301906136ee565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af1948515612004575f95613669575b5060608580518101031261200f5761333860208601613860565b91606060408701519601519760ff19601c5416601c556001600160801b038416801561365a5761337f6001600160801b03600654166001600160801b03601a541690613874565b906001600160801b0360055460401c16906103e88201809211613646576133a591613881565b906103e88101809111613646576133bb91613894565b978815801561363b575b61362c576001600160801b03891161362c5789938189809311613617575b5050508281116135fa575b505050335f52600760205260405f20613408868254613874565b9055600554600160401b600160c01b036134376001600160801b0388166001600160801b038460401c166138bf565b60401b1690600160401b600160c01b031916176005556001600160801b03613464600654928284166138bf565b16906001600160801b03191617600655335f52600860205260405f209461349361348d83615994565b42613874565b92600287019060ff825460081c16806135e5575b156135bb57505460ff1660048110156135a75782036135985785613551936001602098018054828111613590575b50554290555b335f5260078652670de0b6b3a76400006134fc60405f2054600a5490613881565b04335f52600c875260405f2055335f5260078652670de0b6b3a764000061352a60405f2054600b5490613881565b04335f52600d875260405f20556040519384528584015283604084015260608301906136e1565b7f1bd31e31c1a5218572a726205ef78f27c8c37cd5173136d21170a3f2e43b2d7860803392a260015f80516020615cd683398151915255604051908152f35b9150896134d5565b633d23cdaf60e01b5f5260045ffd5b634e487b7160e01b5f52602160045260245ffd5b9360016020986135519660ff19855416178455428155015561010061ff00198254161790556134db565b50335f52600760205260405f205415156134a7565b61360f92613607916138b2565b903390614c5e565b8587806133ee565b61362492613607916138b2565b868a806133e3565b633999656760e01b5f5260045ffd5b5060443589106133c5565b634e487b7160e01b5f52601160045260245ffd5b630200e8a960e31b5f5260045ffd5b61367e9195503d805f833e61109581836137c2565b938761331e565b63486aa30760e01b5f5260045ffd5b3461200f575f36600319011261200f576020604051610fa08152f35b3461200f575f36600319011261200f57806201518060209252f35b600435906001600160a01b038216820361200f57565b9060048210156135a75752565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b9190602083019260038210156135a75752565b61014081019081106001600160401b0382111761374157604052565b634e487b7160e01b5f52604160045260245ffd5b608081019081106001600160401b0382111761374157604052565b61010081019081106001600160401b0382111761374157604052565b60a081019081106001600160401b0382111761374157604052565b60c081019081106001600160401b0382111761374157604052565b90601f801991011681019081106001600160401b0382111761374157604052565b6001600160401b03811161374157601f01601f191660200190565b60208183031261200f578051906001600160401b03821161200f570181601f8201121561200f57805190613831826137e3565b9261383f60405194856137c2565b8284526020838301011161200f57815f9260208093018386015e8301015290565b51906001600160801b038216820361200f57565b9190820180921161364657565b8181029291811591840414171561364657565b811561389e570490565b634e487b7160e01b5f52601260045260245ffd5b9190820391821161364657565b906001600160801b03809116911601906001600160801b03821161364657565b51908160020b820361200f57565b91908261010091031261200f5760405161390681613770565b809261391181613860565b82526020810151801515810361200f5760e09182916020850152613937604082016138df565b6040850152613948606082016138df565b60608501526080810151608085015260a081015160a085015260c081015160c08501520151910152565b80516001600160a01b03908116835260208083015182169084015260408083015162ffffff169084015260608083015160020b9084015260809182015116910152565b80516001600160a01b0316825260208082015161012092916139da9190850190613972565b60408101516001600160a01b0390811660c08501526060820151811660e08501526080820151811661010085015260a09091015116910152565b60e080916001600160801b038151168452602081015115156020850152604081015160020b6040850152606081015160020b60608501526080810151608085015260a081015160a085015260c081015160c08501520151910152565b919060ff601d5460b01c16613c765760ff6005541615613c76575f19601e5480151580613c6d575b613c65575b50613aa66159cf565b80821015613c5e57505b613ab8614d78565b613ac0614e3d565b94613af460035460b81c60020b92613ae96040519863800bba4b60e01b8a5260048a01906139b5565b610144880190613a14565b1515928361024487015261026486015261028485015260056102a48501525f80516020615d168339815191526102c48501526102e4840152610140836103048173__$e9cccd0b12f8eb18dba9157dd21ebd0428$__5af48015612004575f915f945f92613c08575b506001600160801b038583613bdd575b613b7585614f03565b169182613b83575b50505050565b8360a093606060407f51625364fd0b5bcbac19e3406c92d98ea9e094d20e366ff9594c684d0b8e1aba97015160020b92015160020b926040519485526020850152604084015260608301526080820152a15f808080613b7d565b6020544303613bfb575b613bf384602154613874565b602155613b6c565b436020555f602155613be7565b92509350506101403d8111613c57575b613c2281836137c2565b81016101408282031261200f57613c3990826138ed565b92610120613c4a6101008401613860565b920151939193905f613b5c565b503d613c18565b9050613ab0565b90505f613a9d565b50808211613a98565b505f9150565b919082604091031261200f576020825192015190565b6022541580613d9d575b613d9757613cfa6020915f610fb4613cd9604051613cba87826137c2565b83815260405192839160048984015260408084015260608301906136ee565b604051809481926348c8949160e01b835287600484015260248301906136ee565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af1801561200457613d6d7f74d538bd1ba8f68e36a9ef8bfedf127f41e4c9edabdb15b4f88b2e43a7b133cc916040945f91613d7d575b50858082518301019101613c7c565b93908481968351928352820152a1565b613d9191503d805f833e61109581836137c2565b5f613d5e565b5f905f90565b5060235415613c9c565b6011546001600160a01b0316330361414257811561413e576001600160a01b03908116917f000000000000000000000000000000000000000000000000000000000000000090911682149081158061410b575b6140fc576040516370a0823160e01b815230600482015290602082602481875afa918215612004575f926140c6575b50613e3690303386614bcc565b6040516370a0823160e01b815230600482015290602082602481875afa8015612004575f90614092575b613e6a92506138b2565b90811561408d57600e546001600160a01b031615613f135715613f0b57805f5b600e54600f5491906001600160a01b0316803b1561200f57604051633d27ad3f60e11b8152600481019390935260248301949094526044820152915f908390606490829084905af1908115612004575f80516020615cf683398151915292602092613efb575b505b604051908152a2565b5f613f05916137c2565b5f613ef0565b5f9080613e8a565b60055460401c6001600160801b03169081613f6b575050602081613f665f80516020615cf6833981519152937f000000000000000000000000000000000000000000000000000000000000000086614c5e565b613ef2565b1561400a5750613f7d81601254613874565b670de0b6b3a7640000810291818304670de0b6b3a7640000148215171561364657613ff3602092670de0b6b3a7640000613fec5f80516020615cf683398151915296613fd86001600160801b0360055460401c168092613894565b613fe481600a54613874565b600a55613881565b04906138b2565b60125561400281601454613874565b601455613ef2565b61401682601354613874565b91670de0b6b3a76400008302838104670de0b6b3a76400001484151715613646575f80516020615cf683398151915293670de0b6b3a7640000613fec8561406260209761407696613894565b61406e81600b54613874565b600b55613881565b60135561408581601554613874565b601555613ef2565b505050565b506020823d6020116140be575b816140ac602093836137c2565b8101031261200f57613e6a9151613e60565b3d915061409f565b9091506020813d6020116140f4575b816140e2602093836137c2565b8101031261200f575190613e36613e29565b3d91506140d5565b6301f30c8760e21b5f5260045ffd5b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316831415613dfa565b5050565b63995e1c6960e01b5f5260045ffd5b60ff601d5460b01c16156142ad57614167614d78565b61419a614172614e3d565b604051637553091560e11b8152929061418f9060048501906139b5565b610144830190613a14565b5f80516020615d16833981519152610244820152610180816102648173__$e9cccd0b12f8eb18dba9157dd21ebd0428$__5af48015612004575f915f925f905f925f9461422b575b5091608093916142137f322c42a9023e2e0ad1b1d451bc9f999f48b09a582a390714604d532bb2f15b9f9694614f03565b604051938452602084015260408301526060820152a1565b9450505050506101803d81116142a6575b61424681836137c2565b81016101808282031261200f57816142816080927f322c42a9023e2e0ad1b1d451bc9f999f48b09a582a390714604d532bb2f15b9f946138ed565b61010082015161012083015161014084015161016090940151919591945091906141e2565b503d61423c565b565b6016546001600160a01b031615612d12576142c8614f89565b50506001600160801b03600654166001600160801b03601a5416906142ed8282613874565b801561408d5761430361271091601b5490613881565b04918282111561432e5750506001600160801b036143286142ad9282600654166138b2565b166155e0565b82821061433a57505050565b61434f6001600160801b03926142ad946138b2565b9080821161435f575b50166156b7565b90505f614358565b60038110156135a7578015614389576001146143835761096090565b6104b090565b5061025890565b906001600160801b03809116911603906001600160801b03821161364657565b907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036147e357810160408282031261200f57813591600583101561200f576020810135906001600160401b03821161200f57019181601f8401121561200f578235614425816137e3565b9361443360405195866137c2565b81855260208501936020838301011161200f57815f926020809301863785010152801561477357600181146146f95760038114614690576004146145b85760408280518101031261200f57604061448c614493926138df565b92016138df565b61449b615b8c565b916001600160801b0360065416601454601554916144ca6040519663080607c960e11b885260048801906158a8565b6101448601526101648501526101848401528060020b6101a48401528160020b6101c48401526020836101e48173__$de09faa1e66113861ca0ab8e29d2732529$__5af4918215612004575f92614576575b6001600160801b03935063ffffff006005549160201b66ffffff00000000169260081b169066ffffffffffff0019161717600555166001600160801b031960065416176006556040516145706020826137c2565b5f815290565b91506020833d6020116145b0575b81614591602093836137c2565b8101031261200f576145aa6001600160801b0393613860565b9161451c565b3d9150614584565b50506145c2614d78565b6145ea6145cd614e3d565b604051638a572aa160e01b8152929061418f9060048501906139b5565b610140816102448173__$e9cccd0b12f8eb18dba9157dd21ebd0428$__5af48015612004575f80925f92614643575b5061462390614f03565b6040519160208301526040820152604081526146406060826137c2565b90565b925050506101403d8111614689575b61465c81836137c2565b81016101408282031261200f5761467390826138ed565b6101008201516101209092015190614623614619565b503d614652565b50505061469b615b8c565b60405163c2cb10eb60e01b8152906146b79060048301906158a8565b5f816101448173__$de09faa1e66113861ca0ab8e29d2732529$__5af4908115612004575f916146e5575090565b61464091503d805f833e61109581836137c2565b509080602091518101031261200f5761471190613860565b6001600160801b03614721615b8c565b6040516365c4e05f60e01b8152929061473e9060048501906158a8565b166101448201525f816101648173__$de09faa1e66113861ca0ab8e29d2732529$__5af4908115612004575f916146e5575090565b506020826147849351010190613c7c565b61478c615b8c565b604051635bc34fcb60e11b815292906147a99060048501906158a8565b6101448301526101648201525f816101848173__$de09faa1e66113861ca0ab8e29d2732529$__5af4908115612004575f916146e5575090565b63f655705d60e01b5f5260045ffd5b604051906147ff8261378c565b600280546001600160a01b039081168452600354808216602086015260a081901c62ffffff16604086015260b81c90910b6060840152600454166080830152565b60ff60055416156149d45760a06148556147f2565b206148a9601d5491604051925f80516020615d1683398151915260268501528060981c60020b600685015260801c60020b60038401523083525f603a600c8501209381604082015281602082015252615c54565b600681018091116136465760405190602082019283526040820152604081526148d36060826137c2565b519020604051631afeb18d60e11b81526004810191909152600360248201525f816044817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015612004575f90614939575b60209150015190565b503d805f833e61494981836137c2565b81019060208183031261200f578051906001600160401b03821161200f57019080601f8301121561200f578151916001600160401b038311613741578260051b906040519361499b60208401866137c2565b845260208085019282010192831161200f57602001905b8282106149c457505050602090614930565b81518152602091820191016149b2565b5f90565b60025f80516020615cd68339815191525414614a015760025f80516020615cd683398151915255565b633ee5aeb560e01b5f5260045ffd5b60ff5f5460a01c16614a1e57565b63d93c066560e01b5f5260045ffd5b6001600160a01b0381165f818152600760205260409020549091811561408d57600a5490670de0b6b3a7640000614ac6614a7f82614a6b8688613881565b04875f52600c60205260405f2054906138b2565b9482614aaf614aa882614a94600b5486613881565b048a5f52600d60205260405f2054906138b2565b9683613881565b04875f52600c60205260405f2055600b5490613881565b04845f52600d60205260405f20558215908115809181614bb8575b84801515809481614ba4575b614b74575b614b43575b505091614b3b575b50614b0957505050565b7f1ac537f0ad67b64ac68a04587ff3a4cb6977de22eb2c37ee560897a92c6d07c79160409182519182526020820152a2565b90505f614aff565b614b6d917f0000000000000000000000000000000000000000000000000000000000000000614c5e565b5f84614af7565b614b9f88847f0000000000000000000000000000000000000000000000000000000000000000614c5e565b614af2565b614bb0836015546138b2565b601555614aed565b614bc4866014546138b2565b601455614ae1565b6040516323b872dd60e01b5f9081526001600160a01b039384166004529290931660245260449390935260209060648180865af19060015f5114821615614c3d575b6040525f60605215614c1d5750565b635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b906001811516614c5557823b15153d15161690614c0e565b503d5f823e3d90fd5b916040519163a9059cbb60e01b5f5260018060a01b031660045260245260205f60448180865af19060015f5114821615614c9e575b60405215614c1d5750565b906001811516614c5557823b15153d15161690614c93565b5f546001600160a01b03163303614cc957565b63118cdaa760e01b5f523360045260245ffd5b6040516338d52e0f60e01b81529190602090839060049082906001600160a01b03165afa5f9281614d34575b50614d11575050565b6001600160a01b03908116911603614d2557565b6329d8acbd60e11b5f5260045ffd5b9092506020813d602011614d70575b81614d50602093836137c2565b8101031261200f57516001600160a01b038116810361200f57915f614d08565b3d9150614d43565b60405190614d8582613770565b81601d546001600160801b038116825260ff8160b01c16151560208301528060801c60020b604083015260981c60020b6060820152602254608082015260235460a082015260185460c082015260e0601954910152565b60405190614de98261378c565b5f6080838281528260208201528260408201528260608201520152565b60405190614e13826137a7565b5f60a083828152614e22614ddc565b60208201528260408201528260608201528260808201520152565b614e45614e06565b50601654601754604051916001600160a01b039182169116614e66836137a7565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168352614e9a6147f2565b60208401526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660408501527f0000000000000000000000000000000000000000000000000000000000000000166060840152608083015260a082015290565b60e0906001600160801b03815116601d5460ff60b01b6020840151151560b01b16604084015160801b91606085015160981b62ffffff60981b169362ffffff60981b19916cffffffffffffffffff00ffffff60981b161716179062ffffff60801b161717601d55608081015160225560a081015160235560c08101516018550151601955565b60055460ff8116159081156154c0575b5080156154ad575b613d9757602090614fff5f610fb4614fde604051614fbf87826137c2565b83815260405192839160038984015260408084015260608301906136ee565b604051809381926348c8949160e01b835287600484015260248301906136ee565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af180156120045761504e915f91615493575b50838082518301019101613c7c565b919092828415908161548a575b5061548157615069846159fb565b615072866159fb565b601054919592939091871c6001600160a01b03168061536057506150968584613874565b6150a08786613874565b908061530f575b50806152be575b505b600e546001600160a01b0316156151f35780158015906151ea575b61511d575b50509160c093917f472d3768bc16f9205ad3ebbd417adcaed0ddd501007b5f43d1202d88779a509d95935b88604051958b875286015260408501526060840152608083015260a0820152a1565b94929095939160018060a01b03600e541696600f5497803b1561200f57604051633d27ad3f60e11b8152600481019990995260248901889052604489018290525f908990606490829084905af197881561200457604060c0987fd5dc9d358dcea5f90a12ff926dd789d5129808c7d740659e8f51a6a66e8df10f927f472d3768bc16f9205ad3ebbd417adcaed0ddd501007b5f43d1202d88779a509d9b6151da575b50600f5493825191825289820152a2919395819395506150d0565b5f6151e4916137c2565b5f6151bf565b508115156150cb565b949290959391670de0b6b3a76400008602868104670de0b6b3a764000014871517156136465761523d6152356001600160801b0360055460401c168093613894565b600a54613874565b600a55670de0b6b3a7640000880297808904670de0b6b3a76400001481151715613646576152ab60c0986152a06152986152b6957f472d3768bc16f9205ad3ebbd417adcaed0ddd501007b5f43d1202d88779a509d9d613894565b600b54613874565b600b55601454613874565b601455601554613874565b6015556150fb565b615309907f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000614c5e565b5f6150ae565b61535a907f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000614c5e565b5f6150a7565b83615431575b846153e1575b856153b1575b8680615380575b50506150b0565b6153aa917f0000000000000000000000000000000000000000000000000000000000000000614c5e565b5f86615379565b6153dc86827f0000000000000000000000000000000000000000000000000000000000000000614c5e565b615372565b61542c857f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000614c5e565b61536c565b61547c847f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000614c5e565b615366565b505f9250829150565b9050155f61505b565b6154a791503d805f833e61109581836137c2565b5f61503f565b506001600160801b036006541615614fa1565b6001600160801b03915060401c16155f614f99565b9081608091031261200f576060604051916154ef83613755565b6154f881613860565b835261550660208201613860565b6020840152604081015160408401520151606082015290565b9161020091949360606001600160801b039260e061022087019860018060a01b038151168852615557602082015160208a0190613972565b6040818101516001600160a01b0390811660c08b810191909152868401518216858c0152608084015182166101008c015260a08401519091166101208b0152820151600290810b6101408b0152929091015190910b61016088015281518516610180880152602082015185166101a08801528101516101c087015201516101e085015216910152565b60806155ea615a33565b6155f2615a6d565b6156106040519485938493631d0b6e9560e21b85526004850161551f565b038173__$3f3546bcd813ee5b64548ead6cd9e9417a$__5af48015612004576142ad915f91615688575b506060906001600160801b038151166001600160801b031960065416176006556001600160801b036020820151166001600160801b0319601a541617601a5560408101516018550151601955565b6156aa915060803d6080116156b0575b6156a281836137c2565b8101906154d5565b5f61563a565b503d615698565b60806156c1615a33565b6156c9615a6d565b615610604051948593849363059c424d60e51b85526004850161551f565b6001600160a01b03165f908152600860205260409020600281015460ff1660048110156135a757801561578c57600182015442101561578c5761572c61573491615994565b9154426138b2565b908061576b57505060645b60148110615765576032811061575f5760501161575a575f90565b603290565b50606490565b5060c890565b6064820291808304606414901517156136465761578791613894565b61573f565b50505f90565b60405163095ea7b360e01b5f9081526001600160a01b0384166004525f1960245291929160209060448180875af19060015f5114821615615899575b604052156157da575050565b60405163095ea7b360e01b5f9081526001600160a01b038316600452602481905260209060448180875af19060015f5114821615615881575b604052156158605760405163095ea7b360e01b5f9081526001600160a01b039092166004525f196024529060209060448180865af19060015f5114821615614c9e5760405215614c1d5750565b50635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b906001811516614c5557833b15153d15161690615813565b90833b15153d151616906157ce565b60a061012091600180831b0381511684526158cb60208201516020860190613972565b600180831b0360408201511660c0850152600180831b0360608201511660e0850152608081015160020b610100850152015160020b910152565b600291820b910b0390627fffff198212627fffff83131761364657565b91909161593760035460b81c60020b91614367565b9261594b826159468684615905565b615c7a565b9360020b9060020b0190627fffff198212627fffff8313176136465761464091615c7a565b6040519061597d82613755565b5f6060838281528260208201528260408201520152565b60048110156135a757600181146159c757600281146159bf576003146159b8575f90565b62ed4e0090565b506276a70090565b5062278d0090565b601f5480156159f5576020544303614640576021548082111561578c57614640916138b2565b505f1990565b61ffff916146406010549261240f612710615a2a81615a1c89891686613881565b0497889760101c1684613881565b049485926138b2565b615a3b615970565b906001600160801b036006541682526001600160801b03601a5416602083015260185460408301526019546060830152565b5f60e0604051615a7c81613770565b828152615a87614ddc565b60208201528260408201528260608201528260808201528260a08201528260c0820152015260018060a01b036016541660018060a01b03601754166005549060405192615ad384613770565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168452615b076147f2565b602085015260018060a01b037f000000000000000000000000000000000000000000000000000000000000000016604085015260018060a01b037f0000000000000000000000000000000000000000000000000000000000000000166060850152608084015260a08301528060081c60020b60c083015260201c60020b60e082015290565b615b94614e06565b5060055460405190615ba5826137a7565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168252615bd96147f2565b602083015260018060a01b037f000000000000000000000000000000000000000000000000000000000000000016604083015260018060a01b037f00000000000000000000000000000000000000000000000000000000000000001660608301528060081c60020b608083015260201c60020b60a082015290565b604051602081019182526006604082015260408152615c746060826137c2565b51902090565b60020b908060020b801561389e57627fffff1983145f198214166136465780830560020b028060020b9081036136465780925f81129081615cca575b50615cc057505090565b6146409250615905565b90508114155f615cb656fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00f807ed7de821bda1f30b14a07785929f138dd9691606aedbed486d267ae2aaee1a915d52045db80201f451cb9ed487b2ecafc496b3e5f28cfa28bff3467ee654a2646970667358221220ab7ae4b01a4467f27959f8133a331e25f87d5e1ad9d9463eb0078a0983e030b064736f6c634300081a0033" as const;

// Unresolved library placeholders (__$<hash>$__) live in the bytecode above; splice each
// deployed library address into every {start,length} offset before deploying the vault.
export const PAIR_VAULT_LINK_REFS = {
  "contracts-v4/src/vaults/lib/MWIdleLib.sol": {
    "MWIdleLib": [
      {
        "start": 3459,
        "length": 20
      },
      {
        "start": 23239,
        "length": 20
      }
    ]
  },
  "contracts-v4/src/vaults/lib/MWJitLib.sol": {
    "MWJitLib": [
      {
        "start": 16361,
        "length": 20
      },
      {
        "start": 18027,
        "length": 20
      },
      {
        "start": 19111,
        "length": 20
      }
    ]
  },
  "contracts-v4/src/vaults/lib/MWPositionLib.sol": {
    "MWPositionLib": [
      {
        "start": 18860,
        "length": 20
      },
      {
        "start": 19314,
        "length": 20
      },
      {
        "start": 19456,
        "length": 20
      },
      {
        "start": 19568,
        "length": 20
      }
    ]
  }
} as const;
