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

export const PAIR_VAULT_BYTECODE = "0x610120604052346105205760405161839038819003601f8101601f191683016001600160401b03811184821017610524578392829160405283398101039061014082126105205760a061005182610538565b92601f1901126105205760405160a081016001600160401b038111828210176105245760405261008360208301610538565b815261009160408301610538565b906020810191825260608301519162ffffff83168303610520576040820192835260808401518060020b8103610520576060830190815260a0850151906001600160a01b0382168203610520576080840191825260c08601519460038610156105205761010060e08801610538565b61010d6101008901610538565b976001600160a01b03906101249061012001610538565b1698891561050d575f80546001600160a01b031981168c1782556040519b916001600160a01b03909116907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09080a360017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00556001600160a01b0390811660805260a0829052161580156104fc575b6104dc57845184516001600160a01b039081169691169490851580156104f4575b80156104eb575b6104dc5751600280546001600160a01b03199081166001600160a01b0393841617909155915160038054945195516001600160d01b03199095169183169190911760a09590951b62ffffff60a01b169490941762ffffff60b81b60b89490941b9390931692909217909255915160048054909216921691909117905560c05260e0526005805460ff60381b191660389290921b67ff0000000000000016919091179055610100526010805463ffffffff19166303e80bb8179055617e43908161054d82396080518181816109d501528181610cd901528181610fd001528181611f6901528181612d72015281816135ab0152818161391d01528181613db30152818161447001528181614ca2015281816159ad01528181615a4d01528181615b5601528181616098015281816164b3015281816168fb01528181616b900152818161780c0152617a98015260a051818181611b0901528181611e7001528181611ec001528181613b5f01528181615e1601528181615e6701528181615f3901528181615f8901528181617054015281816170e301528181617310015261738d015260c0518181816106ed015281816119e901528181611e4101528181611ee10152818161294b01528181612b7001528181612ca8015281816139eb01528181613e9e015281816145b80152818161496301528181614f22015281816155e1015281816158f701528181615e8801528181615f0a01528181615faa015281816163080152818161682901528181616c120152617837015260e05181818161071e01528181610abf015281816119c801528181611e1101528181611e9101528181612ba301528181612cd601528181613d2c01528181613f5801528181614613015281816149ba01528181614ef0015281816156e1015281816157eb01528181615e3701528181615ed801528181615f5a015281816162790152818161679e01528181616c680152617ac601526101005181818161067d015281816108f501528181610c7b01528181610f1f0152818161263b015281816127350152612a230152f35b6301f30c8760e21b5f5260045ffd5b508686146101db565b5086156101d4565b506001600160a01b038716156101b3565b631e4fbdf760e01b5f525f60045260245ffd5b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036105205756fe6080806040526004361015610012575f80fd5b5f905f3560e01c9081623c8bd41461312c57508062ce24e61461311057806301c5be2814612c5057806302f0599614612b0057806304753a0514612a9557806304aedc7614612a7a57806307f0197d14612a52578063085d488314612a0e5780630ba39847146129975780630d88169a1461297a5780630dfe1681146129365780630f0824dc146128ff57806314caf881146128bc5780631523fc7f1461289757806315770f921461286e578063182148ef146128125780631fcaecb8146127ea578063200e4092146127cd57806322fd85b11461270e578063232c3203146126ca5780632374ff2914612628578063249d39e91461260c57806325d2a3f3146125805780632f4d89ee1461255957806332fcd9661461253757806335cd299e146124d25780633af349cc146124b55780633dfd3873146124095780633f4ba83a1461239d578063452a9320146123755780634ac375081461234d5780634b92d98d146123305780634b9738901461231357806355b812a8146122f157806359c4f905146122ce5780635c23058f146122b15780635c974c9c146122945780635c975abb146122705780635db3e0a7146122545780635dccdb0e146122215780635de9a137146121bb5780635fa51bd014611b3857806361d027b314611af45780636720abd914611ad75780636abe200c1461196a5780636c0e475b1461194c578063715018a6146118f25780637211dc36146118cb57806375859154146118ad578063770d9c75146118455780637a9262a2146117ef5780637f5a7c7b146117c25780638456cb591461172d57806384b241e01461170f57806388e8e12c146116f35780638a0dac4a1461168b5780638da5cb5b146116645780639174d85c1461164657806391dd7346146115d2578063929bf136146115a657806392f6b31c1461157f5780639c57e2da1461155b578063a0eb1ad214611537578063a8f0bcef14611519578063aa2f892d146113bc578063ab48b09e14610ef5578063ab60636c14610ec8578063b06f15a714610c59578063b61a21d214610c34578063b86b9fdd14610bdb578063b98ad25514610bb8578063bc6d6a4214610b7c578063c879657214610b27578063ce7c2ac214610aee578063d21220a714610aa9578063d282ad6b14610a8b578063d294f09314610a5c578063d4e3210d14610a3e578063d6ad3bdd14610a20578063d810a6e914610a04578063dc4c90d3146109bf578063e00f368f146108cd578063e148e4c1146108af578063e1960ca614610886578063e38f6a5514610868578063e7e452a41461082f578063e80cfa5e1461080d578063e8d991d114610669578063f2923a241461064d578063f2fde38b146105c7578063f5dd6a08146105aa578063f7fd6e9614610571578063f883b1cd14610548578063f89784011461045a5763fe26810f14610431575f80fd5b3461045757806003193601126104575760206001600160801b03601d5416604051908152f35b80fd5b50346104575760403660031901126104575760043561ffff81168091036105445760243561ffff8116908181036105405761049361505d565b610fa06104a083856132da565b11610531578263ffff00006010549260101b169163ffffffff19161717601055816127100361ffff811161051d5761ffff829116039061ffff821161051d579161ffff6060927fdaaf57b4facaa4cff151ba70473385f6ed2714defe0683dedc9b92d4a3f7c6b1946040519384526020840152166040820152a180f35b634e487b7160e01b84526011600452602484fd5b631dd0258b60e31b8452600484fd5b8380fd5b5080fd5b50346104575780600319360112610457576016546040516001600160a01b039091168152602090f35b5034610457576020366003190112610457576020906040906001600160a01b03610599613147565b168152600d83522054604051908152f35b503461045757806003193601126104575760206040516103e88152f35b5034610457576020366003190112610457576105e1613147565b6105e961505d565b6001600160a01b031680156106395781546001600160a01b03198116821783556001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08380a380f35b631e4fbdf760e01b82526004829052602482fd5b5034610457578060031936011261045757602060405160c88152f35b5034610457578060031936011261045757337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161415806107f9575b6107ea576106b9614d7f565b6106c1614db7565b60ff601d5460b01c166107db576016546001600160a01b03169081156107cc57604061071283601854907f000000000000000000000000000000000000000000000000000000000000000090616ee7565b60175460195461074c917f0000000000000000000000000000000000000000000000000000000000000000906001600160a01b0316617180565b83929192158015906107c3575b61077d575b505060015f80516020617dae8339815191525582519182526020820152f35b845184815260208101849052604081019290925260608201527f64cc470d924ef687ff28d709b7ef348c355fbe6f2b2e4157a21353815d9c477490608090a1838061075e565b50821515610759565b630e12f94160e11b8152600490fd5b636687fb8760e01b8152600490fd5b63eb79da3b60e01b8152600490fd5b5080546001600160a01b03163314156106ad565b5034610457578060031936011261045757602061ffff60105416604051908152f35b5034610457576020366003190112610457576020906040906001600160a01b03610857613147565b168152600c83522054604051908152f35b50346104575780600319360112610457576020601b54604051908152f35b50346104575780600319360112610457576011546040516001600160a01b039091168152602090f35b5034610457578060031936011261045757602060405162278d008152f35b5034610457576020366003190112610457576004356001600160801b038116810361054457337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161415806109ab575b61099c57610931614d7f565b610939614db7565b60ff601d5460b01c1661098d576016546001600160a01b03161561097e5761096a90610963615adb565b505061659f565b60015f80516020617dae8339815191525580f35b630e12f94160e11b8252600482fd5b636687fb8760e01b8252600482fd5b63eb79da3b60e01b8252600482fd5b5081546001600160a01b0316331415610925565b50346104575780600319360112610457576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5034610457578060031936011261045757602060405160648152f35b50346104575780600319360112610457576020601f54604051908152f35b50346104575780600319360112610457576020601454604051908152f35b5034610457578060031936011261045757610a75614d7f565b60ff601d5460b01c166107db5761096a33614dd4565b50346104575780600319360112610457576020600b54604051908152f35b50346104575780600319360112610457576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5034610457576020366003190112610457576020906040906001600160a01b03610b16613147565b168152600783522054604051908152f35b5034610457578060031936011261045757610b40614d7f565b610b48614db7565b60ff601d5460b01c166107db576040610b5f615adb565b60015f80516020617dae8339815191525582519182526020820152f35b50346104575780600319360112610457576020610bb06001600160801b03600654166001600160801b03601a5416906132da565b604051908152f35b5034610457578060031936011261045757602060ff600554166040519015158152f35b5034610457576040366003190112610457577fd5e7a8aa8f7d318f4da08b3c4ec9dfcf0837bf7448f974f37d95c14c5322ac096040600435602435610c1e61505d565b81601e5580601f5582519182526020820152a180f35b5034610457578060031936011261045757602061ffff60105460101c16604051908152f35b50346104575760203660031901126104575760043590600382101561045757337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316141580610eb4575b6107ea57610cb7614d7f565b610cbf614db7565b60ff601d5460b01c166107db5760ff6005541615610ea5577f000000000000000000000000000000000000000000000000000000000000000091610d1a610d1060a0610d09613354565b208561511f565b5050905082616eb2565b9060020b9060020b81811315610e965783610dc68196610d38615adb565b505060055460ff60381b8760381b169060ff60381b191617600555610d94610da260405187602082015286604082015260408152610d776060826131d1565b60405192839160026020840152604080840152606083019061316a565b03601f1981018352826131d1565b6040519788809481936348c8949160e01b835260206004840152602483019061316a565b03926001600160a01b03165af1938415610e8b57610e366060947f9c8daf43131b569ba832e1a36c541080a4ce144333aa10bd18693bdc14bfad77927fc2df45ace19779c8cee33727e1cf9829c78beb3141250e153674e7825f631dad97610e6b575b506040519182918261318e565b0390a16001600160801b03600654169060405192835260208301526040820152a160015f80516020617dae8339815191525580f35b610e86903d808b833e610e7e81836131d1565b810190613241565b610e29565b6040513d87823e3d90fd5b631929b88360e21b8452600484fd5b63486aa30760e01b8152600490fd5b5080546001600160a01b0316331415610cab565b5034610457578060031936011261045757610ef160ff60055460381c166040519182918261318e565b0390f35b5034610457576020366003190112610457576004356001600160a01b038116908181036113b857337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161415806113a4575b6113955760055460ff81166113865760ff191660011760055560405163313b65df60e11b8152600280546001600160a01b03908116600480850191909152600354808316602486015260a081901c62ffffff16604486015260b81c90920b606484015290548116608483015260a48201849052602090829060c490829088907f0000000000000000000000000000000000000000000000000000000000000000165af1801561137b57611344575b5060a0611008613354565b207f3feb82bb33469ba3cf8cff6b083c3f75ac5efabca67d981c5e161d2c8acf01c46020604051858152a273fffd8963efd1fc6a506488495d951d51639616826401000276a21982016001600160a01b0316116113305760201b640100000000600160c01b03168080156105405760ff826001600160801b031060071b83811c67ffffffffffffffff1060061b1783811c63ffffffff1060051b1783811c61ffff1060041b1783811c821060031b177f07060605060205000602030205040001060502050303040105050304000000006f8421084210842108cc6318c6db6d54be85831c1c601f161a17169160808310155f146113245750607e1982011c5b800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c800280607f1c8160ff1c1c80029081607f1c8260ff1c1c80029283607f1c8460ff1c1c80029485607f1c8660ff1c1c80029687607f1c8860ff1c1c80029889607f1c8a60ff1c1c80029a8b607f1c8c60ff1c1c80029c8d80607f1c9060ff1c1c800260cd1c6604000000000000169d60cc1c6608000000000000169c60cb1c6610000000000000169b60ca1c6620000000000000169a60c91c6640000000000000169960c81c6680000000000000169860c71c670100000000000000169760c61c670200000000000000169660c51c670400000000000000169560c41c670800000000000000169460c31c671000000000000000169360c21c672000000000000000169260c11c674000000000000000169160c01c6780000000000000001690607f190160401b1717171717171717171717171717693627a301d71055774c85026f028f6481ab7f045a5af012a19d003aa919810160801d60020b906fdb2df09e81959a81455e260799a0632f0160801d60020b908181145f149266ffffff0000000093611300575090505b6112dd6005549160ff8360381c16616eb2565b929060081b63ffffff00169260201b169066ffffffffffff001916171760055580f35b6001600160a01b0361131184615219565b161161131d57506112ca565b90506112ca565b905081607f031b611107565b6318521d4960e21b83526004829052602483fd5b6020813d602011611373575b8161135d602093836131d1565b810103126105405761136e90614460565b610ffd565b3d9150611350565b6040513d86823e3d90fd5b637983c05160e01b8452600484fd5b63eb79da3b60e01b8352600483fd5b5082546001600160a01b0316331415610f4f565b8280fd5b5034610457576020366003190112610457576004356113d9614d7f565b60ff601d5460b01c1661098d57338252600860205260408220546201518081018091116114d257421061150a57801580156114f5575b6114e65762093a8042018042116114d2576040516060810181811067ffffffffffffffff8211176114be5760405282815260026020820191838352604081019286845233875260096020526040872091518255516001820155019051151560ff8019835416911617905560405191825260208201527f58fe322fc5911ed072ec92f570e517b9793e350eb1ff7be0019fd9f3fade87bc60403392a260015f80516020617dae8339815191525580f35b634e487b7160e01b85526041600452602485fd5b634e487b7160e01b83526011600452602483fd5b633999656760e01b8252600482fd5b5033825260076020526040822054811161140f565b6331a3a70d60e11b8252600482fd5b50346104575780600319360112610457576020601854604051908152f35b50346104575780600319360112610457576020601d5460981c60020b604051908152f35b50346104575780600319360112610457576020601d5460801c60020b604051908152f35b503461045757806003193601126104575760206001600160801b03601a5416604051908152f35b503461045757806003193601126104575760206115c1614be9565b6001600160801b0360405191168152f35b50346104575760203660031901126104575760043567ffffffffffffffff811161054457366023820112156105445780600401359167ffffffffffffffff831161045757366024848401011161045757610ef1611632846024850161446e565b60405191829160208352602083019061316a565b50346104575780600319360112610457576020602354604051908152f35b5034610457578060031936011261045757546040516001600160a01b039091168152602090f35b5034610457576020366003190112610457576116a5613147565b6116ad61505d565b600180546001600160a01b0319166001600160a01b039290921691821790557fe6c09ffe4572dc9ceaa5ddde4ae41befa655d6fdfe8052077af0970f700e942e8280a280f35b5034610457578060031936011261045757602060405160328152f35b50346104575780600319360112610457576020600f54604051908152f35b50346104575780600319360112610457576001546001600160a01b0316331415806117ae575b61179f5761175f614db7565b805460ff60a01b1916600160a01b1781556040513381527f62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a25890602090a180f35b630fd901ef60e01b8152600490fd5b5080546001600160a01b0316331415611753565b5034610457578060031936011261045757601c5460405160089190911c6001600160a01b03168152602090f35b5034610457576020366003190112610457576060906040906001600160a01b03611817613147565b16815260096020522080549060ff600260018301549201541690604051928352602083015215156040820152f35b50346104575760203660031901126104575761185f613147565b61186761505d565b601180546001600160a01b0319166001600160a01b039290921691821790557fd703b9ccbd1ceac73b34c75ae5ea56096a2c2e2e6804b9f4fce2df6b2f75501e8280a280f35b5034610457578060031936011261045757602060405162ed4e008152f35b503461045757806003193601126104575760206001600160801b0360065416604051908152f35b503461045757806003193601126104575761190b61505d565b80546001600160a01b03198116825581906001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08280a380f35b50346104575780600319360112610457576020601e54604051908152f35b5034611ab5576040366003190112611ab557611984613147565b6024359061199061505d565b6001600160a01b038116908115611ac857600e546001600160a01b038116611ab9576001600160a01b0319168217600e55600f8390557f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000833b15611ab557604051631647f7cb60e01b8152600481018690526001600160a01b038281166024830152831660448201525f8160648183895af18015611aaa57611a8a575b5090611a5e83611a639493616ab4565b616ab4565b7fba1b2edb5fc75597ba8a2c3eedf1e91cd0dce55ee0109f44ed9fda79f77356e68380a380f35b611a6393929196505f611a9c916131d1565b5f9591925090611a5e611a4e565b6040513d5f823e3d90fd5b5f80fd5b631cba885360e01b5f5260045ffd5b632f83aa0f60e21b5f5260045ffd5b34611ab5575f366003190112611ab5576020602254604051908152f35b34611ab5575f366003190112611ab5576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611ab5575f366003190112611ab557611b50614d7f565b611b58614db7565b60ff601d5460b01c166121ac57335f52600960205260405f20805490811561219d57600281019081549060ff821661218e5760010154421061217f5782335f52600760205260405f205410612169575b60ff19166001179055611bb9615adb565b5050611bc433614dd4565b60055460401c6001600160801b0316908115908115612148575f915b8015612132575f935b811561211c575f915b156120f757505f5b335f52600760205260405f20611c11848254613318565b9055600554600160401b600160c01b03611c406001600160801b0386166001600160801b038460401c16614440565b60401b1690600160401b600160c01b031916176005556006546001600160801b03611c6d86828416614440565b16906001600160801b03191617600655611c8985601854613318565b601855611c9882601954613318565b6019556001600160801b03611cb2601a5492828416614440565b16906001600160801b03191617601a555f905f9480612078575b5080611fea575b505f6001600160801b035f941680611f0a575b50604094611cfb611d2a9493611d01936132da565b946132da565b92611d44611d0e33616a09565b91611d3e61271080611d2086856132e7565b04968795896132e7565b0493849281611eba575b83611e6a57613318565b95613318565b92335f526007602052670de0b6b3a7640000611d66875f2054600a54906132e7565b04335f52600c602052865f2055335f526007602052670de0b6b3a7640000611d94875f2054600b54906132e7565b04335f52600d602052865f205584611e3a575b83611e0a575b85519283528460208401528386840152606083015260808201527f09018aaedaafcf3a655b4c0e4a7c39bad2f98f367ef23f57b6d9062057db754760a03392a260015f80516020617dae8339815191525582519182526020820152f35b611e3584337f0000000000000000000000000000000000000000000000000000000000000000615005565b611dad565b611e6585337f0000000000000000000000000000000000000000000000000000000000000000615005565b611da7565b611eb5847f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000615005565b613318565b611f05827f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000615005565b611d34565b611f64939294505f9150611f42610d949160405190602082015260208152611f336040826131d1565b6040519283916020830161320d565b604051809481926348c8949160e01b835260206004840152602483019061316a565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af1918215611aaa57604094611cfb611fc2611d2a95611d01945f91611fd0575b50602080825183010191016133f4565b969093509394505094611ce6565b611fe491503d805f833e610e7e81836131d1565b89611fb2565b601754604051632e1a7d4d60e01b8152600481018390529550602090869060249082905f906001600160a01b03165af1948515611aaa575f95612044575b5084106120355784611cd3565b63cef98b7760e01b5f5260045ffd5b9094506020813d602011612070575b81612060602093836131d1565b81010312611ab557519385612028565b3d9150612053565b601654604051632e1a7d4d60e01b8152600481018390529350602090849060249082905f906001600160a01b03165af1928315611aaa575f936120c3575b5082106120355785611ccc565b9092506020813d6020116120ef575b816120df602093836131d1565b81010312611ab5575191866120b6565b3d91506120d2565b6121166001600160801b03916121118584601a54166132e7565b6132fa565b16611bfa565b61212c81612111856019546132e7565b91611bf2565b61214284612111846018546132e7565b93611be9565b6001600160801b03612162846121118484600654166132e7565b1691611be0565b335f908152600760205260409020549250611ba8565b6345c6758360e01b5f5260045ffd5b630dc1019760e01b5f5260045ffd5b6333ff64eb60e21b5f5260045ffd5b636687fb8760e01b5f5260045ffd5b34611ab5576020366003190112611ab5576001600160a01b036121dc613147565b165f526008602052608060405f2060ff815491600260018201549101549060405193845260208401526122146040840183831661315d565b60081c1615156060820152f35b34611ab5576020366003190112611ab5576004356003811015611ab557612249602091614417565b6040519060020b8152f35b34611ab5575f366003190112611ab55760206040516109c48152f35b34611ab5575f366003190112611ab557602060ff5f5460a01c166040519015158152f35b34611ab5575f366003190112611ab5576020601554604051908152f35b34611ab5575f366003190112611ab5576020600a54604051908152f35b34611ab5575f366003190112611ab557602060055460081c60020b604051908152f35b34611ab5575f366003190112611ab5576020600554811c60020b604051908152f35b34611ab5575f366003190112611ab5576020601354604051908152f35b34611ab5575f366003190112611ab5576020601254604051908152f35b34611ab5575f366003190112611ab557601054604051602091821c6001600160a01b03168152f35b34611ab5575f366003190112611ab5576001546040516001600160a01b039091168152602090f35b34611ab5575f366003190112611ab5576123b561505d565b5f5460ff8160a01c16156123fa5760ff60a01b19165f556040513381527f5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa90602090a1005b638dfc202b60e01b5f5260045ffd5b34611ab5576020366003190112611ab557612422613147565b61242a61505d565b601c54600881901c6001600160a01b03166124a6576001600160a01b03821691821561249757610100600160a81b031990911660089190911b610100600160a81b031617601c557f4eab7b127c764308788622363ad3e9532de3dfba7845bd4f84c125a22544255a5f80a2005b63d92e233d60e01b5f5260045ffd5b635f7c8ab560e11b5f5260045ffd5b34611ab5575f366003190112611ab55760206040516276a7008152f35b34611ab5576020366003190112611ab5576004356124ee61505d565b6127108111612528576020817f54f0cb007518f20824cb2e1a56d23f020ebf45033b89ad9ab7a1ff858291879b92601b55604051908152a1005b6395de507d60e01b5f5260045ffd5b34611ab5575f366003190112611ab5576020604051670de0b6b3a76400008152f35b34611ab5575f366003190112611ab55760206040515f80516020617dee8339815191528152f35b34611ab5576020366003190112611ab55760406001600160a01b036125a3613147565b16805f526007602052612600825f205491670de0b6b3a76400006125ed6125e3826125d0600a54886132e7565b04845f52600c602052875f205490613318565b94600b54906132e7565b04905f52600d602052835f205490613318565b82519182526020820152f35b34611ab5575f366003190112611ab55760206040516127108152f35b34611ab5575f366003190112611ab557337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161415806126b6575b6126a757612677614d7f565b61267f614db7565b60ff601d5460b01c166121ac5761269461435d565b60015f80516020617dae83398151915255005b63eb79da3b60e01b5f5260045ffd5b505f546001600160a01b031633141561266b565b34611ab5575f366003190112611ab557601c5460081c6001600160a01b031633036126ff576126f7614d7f565b612694613d9f565b635a91834f60e01b5f5260045ffd5b34611ab5576020366003190112611ab5576004356001600160801b0381168103611ab557337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161415806127b9575b6126a757612771614d7f565b612779614db7565b60ff601d5460b01c166121ac576016546001600160a01b0316156127aa57612694906127a3615adb565b5050616027565b630e12f94160e11b5f5260045ffd5b505f546001600160a01b0316331415612765565b34611ab5575f366003190112611ab557602060405162093a808152f35b34611ab5575f366003190112611ab5576017546040516001600160a01b039091168152602090f35b34611ab5575f366003190112611ab55760028054600354600454604080516001600160a01b039485168152838516602082015260a084811c62ffffff169282019290925260b89390931c90940b60608301529091166080820152f35b34611ab5575f366003190112611ab55760206001600160801b0360055460401c16604051908152f35b34611ab5575f366003190112611ab557602060ff601d5460b01c166040519015158152f35b34611ab5576040366003190112611ab5576128d5613147565b6128dd614d7f565b6128e5614db7565b60ff601d5460b01c166121ac5761269490602435906139c5565b34611ab5575f366003190112611ab557612917614d7f565b61291f614db7565b60ff601d5460b01c166121ac576040610b5f6138b0565b34611ab5575f366003190112611ab5576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611ab5575f366003190112611ab5576020601954604051908152f35b34611ab5576020366003190112611ab5576129b0613147565b6129b861505d565b60108054640100000000600160c01b031916602083901b640100000000600160c01b03161790556001600160a01b03167fc47debb30fbf1731ae61ac481bc381805a623ae1adaf1d7610f19c57ab6793185f80a2005b34611ab5575f366003190112611ab5576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611ab5575f366003190112611ab557600e546040516001600160a01b039091168152602090f35b34611ab5575f366003190112611ab557602060405160058152f35b34611ab5576040366003190112611ab5576004358015158103611ab557601c5460081c6001600160a01b031633036126ff57612ade602091612ad5614d7f565b60243590613498565b60015f80516020617dae833981519152556001600160801b0360405191168152f35b34611ab5576040366003190112611ab557612b19613147565b6024356001600160a01b0381169190829003611ab557612b3761505d565b601654906001600160a01b03821615801590612c3c575b612c2d576001600160a01b03169081158015612c25575b612497578190612b9e7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031683615083565b612bd17f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031685615083565b6bffffffffffffffffffffffff60a01b1617601655816bffffffffffffffffffffffff60a01b60175416176017557f1480292b57c926add498b39efa3c345474cf76026bdf1aee212af0a09cc686895f80a3005b508215612b65565b634dd6edb160e11b5f5260045ffd5b506017546001600160a01b03161515612b4e565b34611ab5576080366003190112611ab55760043560243590606435916004831015611ab557612c7d614d7f565b612c85614db7565b60ff601d5460b01c166121ac5760ff600554161561310157612ca633614dd4565b7f000000000000000000000000000000000000000000000000000000000000000092612cd483303387614f73565b7f000000000000000000000000000000000000000000000000000000000000000090612d0283303385614f73565b60ff19601c54169160ff8216809317601c55612d6d5f610d94612d4b60405189602082015288604082015260408152612d3c6060826131d1565b604051928391602083016131f3565b604051809381926348c8949160e01b835260206004840152602483019061316a565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af18015611aaa57612dbd915f916130e7575b50602080825183010191016132b8565b979192909560ff19601c5416601c556001600160801b03841680156130d857612dfd6001600160801b03600654166001600160801b03601a5416906132da565b906001600160801b0360055460401c16906103e882018092116130c457612e23916132e7565b906103e881018091116130c457612e39916132fa565b97881580156130b9575b6130aa576001600160801b0389116130aa5789938189809311613095575b505050828111613078575b505050335f52600760205260405f20612e868682546132da565b9055600554600160401b600160c01b03612eb56001600160801b0388166001600160801b038460401c16613325565b60401b1690600160401b600160c01b031916176005556001600160801b03612ee260065492828416613325565b16906001600160801b03191617600655335f52600860205260405f2094612f11612f0b83617423565b426132da565b92600287019060ff825460081c1680613063575b1561303957505460ff1660048110156130255782036130165785612fcf93600160209801805482811161300e575b50554290555b335f5260078652670de0b6b3a7640000612f7a60405f2054600a54906132e7565b04335f52600c875260405f2055335f5260078652670de0b6b3a7640000612fa860405f2054600b54906132e7565b04335f52600d875260405f205560405193845285840152836040840152606083019061315d565b7f1bd31e31c1a5218572a726205ef78f27c8c37cd5173136d21170a3f2e43b2d7860803392a260015f80516020617dae83398151915255604051908152f35b915089612f53565b633d23cdaf60e01b5f5260045ffd5b634e487b7160e01b5f52602160045260245ffd5b936001602098612fcf9660ff19855416178455428155015561010061ff0019825416179055612f59565b50335f52600760205260405f20541515612f25565b61308d9261308591613318565b903390615005565b858780612e6c565b6130a29261308591613318565b868a80612e61565b633999656760e01b5f5260045ffd5b506044358910612e43565b634e487b7160e01b5f52601160045260245ffd5b630200e8a960e31b5f5260045ffd5b6130fb91503d805f833e610e7e81836131d1565b88612dad565b63486aa30760e01b5f5260045ffd5b34611ab5575f366003190112611ab5576020604051610fa08152f35b34611ab5575f366003190112611ab557806201518060209252f35b600435906001600160a01b0382168203611ab557565b9060048210156130255752565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b9190602083019260038210156130255752565b6080810190811067ffffffffffffffff8211176131bd57604052565b634e487b7160e01b5f52604160045260245ffd5b90601f8019910116810190811067ffffffffffffffff8211176131bd57604052565b90604061320a925f8152816020820152019061316a565b90565b90604061320a9260018152816020820152019061316a565b67ffffffffffffffff81116131bd57601f01601f191660200190565b602081830312611ab55780519067ffffffffffffffff8211611ab5570181601f82011215611ab55780519061327582613225565b9261328360405194856131d1565b82845260208383010111611ab557815f9260208093018386015e8301015290565b51906001600160801b0382168203611ab557565b90816060910312611ab5576132cc816132a4565b916040602083015192015190565b919082018092116130c457565b818102929181159184041417156130c457565b8115613304570490565b634e487b7160e01b5f52601260045260245ffd5b919082039182116130c457565b906001600160801b03809116911601906001600160801b0382116130c457565b90816020910312611ab5575190565b6040519060a0820182811067ffffffffffffffff8211176131bd576040908152600280546001600160a01b039081168552600354808216602087015260a081901c62ffffff169386019390935260b89290921c900b6060840152600454166080830152565b9060020b9060020b0190627fffff198212627fffff8313176130c457565b600291820b910b0390627fffff198212627fffff8313176130c457565b9190826040910312611ab5576020825192015190565b60606101609260018060a01b0360025416835260016002015460018060a01b038116602085015262ffffff8160a01c16604085015260b81c60020b8284015260018060a01b036002800154166080840152805160020b60a0840152602081015160020b60c0840152604081015160e084015201516101008201526101406101208201525f6101408201520190565b91909160ff601d5460b01c166137f95760ff60055416156137f957801561389f576017546001600160a01b03165b6001600160a01b0316928315613833578115613897576019545b60405163d3c3962f60e01b8152826020826004818a5afa918215611aaa575f92613863575b50811061385b575b50818110613853575b50601e54801515818382613849575b5050613841575b5061353561745e565b8082101561383a57505b8015613833575f9360246020926040519687938492632e1a7d4d60e01b845260048401525af1928315611aaa575f936137ff575b5082156137f95760205443036137ec575b613590836021546132da565b60215580156137d8576135a583601954613318565b6019555b7f0000000000000000000000000000000000000000000000000000000000000000906135df60a06135d8613354565b208361511f565b505092905060035460b81c60020b60058102938460020b9485036130c45783156137b25761361791613610916151be565b93846133d7565b905b61362282615219565b8661362c86615219565b85156137a35761363b92615598565b955b6001600160801b0387161561379057905f949392916001600160801b038816906040519361366a856131a1565b60406136b58260020b958688528960020b9788602082015286848201525f80516020617dee833981519152606082015283519b8c80948193632d35e7ed60e11b83526004830161340a565b03926001600160a01b03165af1968715611aaa576136fe60a0987f51625364fd0b5bcbac19e3406c92d98ea9e094d20e366ff9594c684d0b8e1aba9a5f91613760575b5061592d565b601d5491600160b01b9260ff60b01b199162ffffff60801b9060801b169069ffffffffffffffffffff60b01b1617169062ffffff60981b9060981b1617831717601d5560405194151585526020850152604084015260608301526080820152a1565b613782915060403d604011613789575b61377a81836131d1565b8101906133f4565b505f6136f8565b503d613770565b9350505061379f9293506157ca565b5f90565b6137ac92615546565b9561363d565b816137c66137d2936137cb939795976151be565b6133b9565b91826133b9565b92613619565b6137e483601854613318565b6018556135a9565b436020555f602155613584565b505f9150565b9092506020813d60201161382b575b8161381b602093836131d1565b81010312611ab55751915f613573565b3d915061380e565b505f925050565b905061353f565b90505f61352c565b119050815f613525565b90505f613516565b91505f61350d565b9091506020813d60201161388f575b8161387f602093836131d1565b81010312611ab55751905f613505565b3d9150613872565b6018546134e0565b6016546001600160a01b03166134c6565b60225415806139bb575b6139b5576139186020915f610d946138f76040516138d887826131d1565b838152604051928391600489840152604080840152606083019061316a565b604051809481926348c8949160e01b8352876004840152602483019061316a565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af18015611aaa5761398b7f74d538bd1ba8f68e36a9ef8bfedf127f41e4c9edabdb15b4f88b2e43a7b133cc916040945f9161399b575b508580825183010191016133f4565b93908481968351928352820152a1565b6139af91503d805f833e610e7e81836131d1565b5f61397c565b5f905f90565b50602354156138ba565b6011546001600160a01b03163303613d60578115613d5c576001600160a01b03908116917f0000000000000000000000000000000000000000000000000000000000000000909116821490811580613d29575b613d1a576040516370a0823160e01b815230600482015290602082602481875afa918215611aaa575f92613ce4575b50613a5490303386614f73565b6040516370a0823160e01b815230600482015290602082602481875afa8015611aaa575f90613cb0575b613a889250613318565b908115613cab57600e546001600160a01b031615613b315715613b2957805f5b600e54600f5491906001600160a01b0316803b15611ab557604051633d27ad3f60e11b8152600481019390935260248301949094526044820152915f908390606490829084905af1908115611aaa575f80516020617dce83398151915292602092613b19575b505b604051908152a2565b5f613b23916131d1565b5f613b0e565b5f9080613aa8565b60055460401c6001600160801b03169081613b89575050602081613b845f80516020617dce833981519152937f000000000000000000000000000000000000000000000000000000000000000086615005565b613b10565b15613c285750613b9b816012546132da565b670de0b6b3a7640000810291818304670de0b6b3a764000014821517156130c457613c11602092670de0b6b3a7640000613c0a5f80516020617dce83398151915296613bf66001600160801b0360055460401c1680926132fa565b613c0281600a546132da565b600a556132e7565b0490613318565b601255613c20816014546132da565b601455613b10565b613c34826013546132da565b91670de0b6b3a76400008302838104670de0b6b3a764000014841517156130c4575f80516020617dce83398151915293670de0b6b3a7640000613c0a85613c80602097613c94966132fa565b613c8c81600b546132da565b600b556132e7565b601355613ca3816015546132da565b601555613b10565b505050565b506020823d602011613cdc575b81613cca602093836131d1565b81010312611ab557613a889151613a7e565b3d9150613cbd565b9091506020813d602011613d12575b81613d00602093836131d1565b81010312611ab5575190613a54613a47565b3d9150613cf3565b6301f30c8760e21b5f5260045ffd5b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316831415613a18565b5050565b63995e1c6960e01b5f5260045ffd5b600160ff1b81146130c4575f0390565b600f0b6f7fffffffffffffffffffffffffffffff1981146130c4575f0390565b601d54905f9160ff8160b01c1615614358577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690613e4590604090613df56001600160801b038216613d6f565b825191613e01836131a1565b8060801c60020b835260981c60020b6020830152828201525f80516020617dee8339815191526060820152815180938192632d35e7ed60e11b83526004830161340a565b03815f865af1908115611aaa575f91614338575b508060801d9381600f0b945f81600f0b818112614312575b8188126142e5575b13156142da576001600160801b0391501660018060a01b03600254169160245f9260207f0000000000000000000000000000000000000000000000000000000000000000604051938480926370a0823160e01b82528a600483015260018060a01b03165afa8015611aaa5784925f916142a5575b508082101561429f5750805b81614236575b81613f0991613318565b94856141ac575b5093965b131561417c576003546040516370a0823160e01b8152600481018690526001600160a01b03918216956001600160801b0393909316939291602090829060249082907f0000000000000000000000000000000000000000000000000000000000000000165afa90811561417157839161413f575b50808410156141395750825b83806140d0575b613fa491613318565b948561402d575b5050507f322c42a9023e2e0ad1b1d451bc9f999f48b09a582a390714604d532bb2f15b9f93946140289193905b613fe1846155cd565b613fea856156cd565b6fffffffffffffffffff00ffffffffffff60801b601d5416601d55604051948594859094939260609260808301968352602083015260408201520152565b0390a1565b813b156113b857604051630ab714fb60e11b81523060048201526024810191909152604481018690529082908290606490829084905af180156140c5576140b0575b50507f322c42a9023e2e0ad1b1d451bc9f999f48b09a582a390714604d532bb2f15b9f9394614028916140a4856023546132da565b60235591819695613fab565b6140bb8280926131d1565b610457578061406f565b6040513d84823e3d90fd5b50813b156113b857604051630b0d9c0960e01b81526001600160a01b038716600482015230602482015260448101859052838160648183875af1801561137b5785918591614120575b5050613f9b565b8192509061412d916131d1565b6113b85783835f614119565b92613f94565b90506020813d602011614169575b8161415a602093836131d1565b81010312611ab557515f613f88565b3d915061414d565b6040513d85823e3d90fd5b5091506140287f322c42a9023e2e0ad1b1d451bc9f999f48b09a582a390714604d532bb2f15b9f93948390613fd8565b909150853b1561054057604051630ab714fb60e11b81523060048201526024810191909152604481018590528381606481838a5af1801561137b57908491614221575b5090811561420d57614203856023546132da565b6023555b5f613f10565b614219856022546132da565b602255614207565b8161422b916131d1565b6113b857825f6141ef565b909150853b15611ab557604051630b0d9c0960e01b81526001600160a01b0386166004820152306024820152604481018390525f81606481838b5af18015611aaa57614286575b50908391613eff565b614294919294505f906131d1565b5f9290613f0961427d565b90613ef9565b9250506020823d6020116142d2575b816142c1602093836131d1565b81010312611ab5578391515f613eed565b3d91506142b4565b505f91815f96613f14565b60035461430d906001600160a01b03166001600160801b036143068b613d7f565b16906164b1565b613e79565b600254614333906001600160a01b03166001600160801b0361430686613d7f565b613e71565b614351915060403d6040116137895761377a81836131d1565b505f613e59565b509050565b6016546001600160a01b0316156127aa57614376615adb565b50506001600160801b03600654166001600160801b03601a54169061439b82826132da565b8015613cab576143b161271091601b54906132e7565b0491828211156143de5750506001600160801b036143d66143dc928260065416613318565b16616027565b565b8282106143ea57505050565b6143ff6001600160801b03926143dc94613318565b9080821161440f575b501661659f565b90505f614408565b6003811015613025578015614439576001146144335761096090565b6104b090565b5061025890565b906001600160801b03809116911603906001600160801b0382116130c457565b51908160020b8203611ab557565b7f0000000000000000000000000000000000000000000000000000000000000000916001600160a01b038316919033839003614bda578101604082820312611ab5578135916005831015611ab55760208101359067ffffffffffffffff8211611ab557019181601f84011215611ab55782356144e981613225565b936144f760405195866131d1565b818552602085019360208383010111611ab557815f9260208093018637850101528015614bbb576001811461493457600381146148475760041461481657604082805181010312611ab557604061455061455792614460565b9201614460565b926001600160801b03600654168061479f575b506005548460201b66ffffff00000000169063ffffff008460081b169066ffffffffffff00191617176005556040516370a0823160e01b815230600482015260208160248160018060a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa8015611aaa575f9061476b575b6145f5915060145490613318565b6040516370a0823160e01b81523060048201529091906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115611aaa575f91614730575b50906001600160801b039261467b6146696146969460155490613318565b9260a0614674613354565b209061511f565b50505061468786615219565b61469089615219565b9161774a565b1692836146c6575b5050506001600160801b031960065416176006556040516146c06020826131d1565b5f815290565b5f9260409261470e928451916146db836131a1565b60020b825260020b602082015285848201528460608201528351948580948193632d35e7ed60e11b83526004830161340a565b03925af18015611aaa57614728915f91613760575061592d565b5f808061469e565b9190506020823d602011614763575b8161474c602093836131d1565b81010312611ab55790516001600160801b0361464b565b3d915061473f565b506020813d602011614797575b81614785602093836131d1565b81010312611ab5576145f590516145e7565b3d9150614778565b60406147f4916147b160055491613d6f565b8251916147bd836131a1565b8060081c60020b835260201c60020b6020830152828201525f6060820152815180938192632d35e7ed60e11b83526004830161340a565b03815f885af18015611aaa57614810915f91613760575061592d565b5f61456a565b505050506148226177e5565b61482a617a70565b60405191602083015260408201526040815261320a6060826131d1565b5050505f915061489c604091600554835190614862826131a1565b8060081c60020b825260201c60020b602082015284848201528460608201528351948580948193632d35e7ed60e11b83526004830161340a565b03925af1908115611aaa575f91614914575b506148b88161592d565b8060801d5f81600f0b135f1461490c576001600160801b0316905b5f81600f0b135f14614905576001600160801b031660405191602083015260408201526040815261320a6060826131d1565b505f61482a565b505f906148d3565b61492d915060403d6040116137895761377a81836131d1565b505f6148ae565b50919250806020915181010312611ab55761494e906132a4565b6040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169290602081602481875afa908115611aaa575f91614b89575b506040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316949092602084602481895afa938415611aaa575f94614b51575b50614a5f6040915f96614a1a6001600160801b036005549216613d6f565b845191614a26836131a1565b8060081c60020b835260201c60020b6020830152848201528760608201528351978880948193632d35e7ed60e11b83526004830161340a565b03925af1908115611aaa57614a7f6020926024965f91613760575061592d565b6040516370a0823160e01b815230600482015294859182905afa928315611aaa575f93614b1b575b50614ab6602091602494613318565b93604051938480926370a0823160e01b82523060048301525afa8015611aaa575f90614ae7575b61482a9250613318565b506020823d602011614b13575b81614b01602093836131d1565b81010312611ab55761482a9151614add565b3d9150614af4565b92506020833d602011614b49575b81614b36602093836131d1565b81010312611ab557915191614ab6614aa7565b3d9150614b29565b9493506020853d602011614b81575b81614b6d602093836131d1565b81010312611ab55793519293614a5f6149fc565b3d9150614b60565b90506020813d602011614bb3575b81614ba4602093836131d1565b81010312611ab557515f6149a4565b3d9150614b97565b509061320a9350614bd4925080602091510101906133f4565b90616b8d565b63f655705d60e01b5f5260045ffd5b60ff600554161561379f5760a0614bfe613354565b20614c52601d5491604051925f80516020617dee83398151915260268501528060981c60020b600685015260801c60020b60038401523083525f603a600c850120938160408201528160208201525261748a565b600681018091116130c4576040519060208201928352604082015260408152614c7c6060826131d1565b519020604051631afeb18d60e11b81526004810191909152600360248201525f816044817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015611aaa575f90614ce2575b60209150015190565b503d805f833e614cf281836131d1565b810190602081830312611ab55780519067ffffffffffffffff8211611ab557019080601f83011215611ab55781519167ffffffffffffffff83116131bd578260051b9060405193614d4660208401866131d1565b8452602080850192820101928311611ab557602001905b828210614d6f57505050602090614cd9565b8151815260209182019101614d5d565b60025f80516020617dae8339815191525414614da85760025f80516020617dae83398151915255565b633ee5aeb560e01b5f5260045ffd5b60ff5f5460a01c16614dc557565b63d93c066560e01b5f5260045ffd5b6001600160a01b0381165f8181526007602052604090205490918115613cab57600a5490670de0b6b3a7640000614e6d614e2682614e1286886132e7565b04875f52600c60205260405f205490613318565b9482614e56614e4f82614e3b600b54866132e7565b048a5f52600d60205260405f205490613318565b96836132e7565b04875f52600c60205260405f2055600b54906132e7565b04845f52600d60205260405f20558215908115809181614f5f575b84801515809481614f4b575b614f1b575b614eea575b505091614ee2575b50614eb057505050565b7f1ac537f0ad67b64ac68a04587ff3a4cb6977de22eb2c37ee560897a92c6d07c79160409182519182526020820152a2565b90505f614ea6565b614f14917f0000000000000000000000000000000000000000000000000000000000000000615005565b5f84614e9e565b614f4688847f0000000000000000000000000000000000000000000000000000000000000000615005565b614e99565b614f5783601554613318565b601555614e94565b614f6b86601454613318565b601455614e88565b6040516323b872dd60e01b5f9081526001600160a01b039384166004529290931660245260449390935260209060648180865af19060015f5114821615614fe4575b6040525f60605215614fc45750565b635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b906001811516614ffc57823b15153d15161690614fb5565b503d5f823e3d90fd5b916040519163a9059cbb60e01b5f5260018060a01b031660045260245260205f60448180865af19060015f5114821615615045575b60405215614fc45750565b906001811516614ffc57823b15153d1516169061503a565b5f546001600160a01b0316330361507057565b63118cdaa760e01b5f523360045260245ffd5b6040516338d52e0f60e01b81529190602090839060049082906001600160a01b03165afa5f92816150db575b506150b8575050565b6001600160a01b039081169116036150cc57565b6329d8acbd60e11b5f5260045ffd5b9092506020813d602011615117575b816150f7602093836131d1565b81010312611ab557516001600160a01b0381168103611ab557915f6150af565b3d91506150ea565b919061512c60209161748a565b604051631e2eaeaf60e01b8152600481019190915292839060249082906001600160a01b03165afa918215611aaa575f9261518a575b506001600160a01b0382169160a081901c60020b9162ffffff60b883901c81169260d01c1690565b9091506020813d6020116151b6575b816151a6602093836131d1565b81010312611ab55751905f615162565b3d9150615199565b60020b908060020b801561330457627fffff1983145f198214166130c45780830560020b028060020b9081036130c45780925f8112908161520e575b5061520457505090565b61320a92506133d7565b90508114155f6151fa565b60020b908160ff1d82810118620d89e881116155335763ffffffff9192600182167001fffcb933bd6fad37aa2d162d1a59400102600160801b189160028116615517575b600481166154fb575b600881166154df575b601081166154c3575b602081166154a7575b6040811661548b575b6080811661546f575b6101008116615453575b6102008116615437575b610400811661541b575b61080081166153ff575b61100081166153e3575b61200081166153c7575b61400081166153ab575b618000811661538f575b620100008116615373575b620200008116615358575b62040000811661533d575b6208000016615324575b5f1261531c575b0160201c90565b5f1904615315565b6b048a170391f7dc42444e8fa290910260801c9061530e565b6d2216e584f5fa1ea926041bedfe9890920260801c91615304565b916e5d6af8dedb81196699c329225ee6040260801c916152f9565b916f09aa508b5b7a84e1c677de54f3e99bc90260801c916152ee565b916f31be135f97d08fd981231505542fcfa60260801c916152e3565b916f70d869a156d2a1b890bb3df62baf32f70260801c916152d9565b916fa9f746462d870fdf8a65dc1f90e061e50260801c916152cf565b916fd097f3bdfd2022b8845ad8f792aa58250260801c916152c5565b916fe7159475a2c29b7443b29c7fa6e889d90260801c916152bb565b916ff3392b0822b70005940c7a398e4b70f30260801c916152b1565b916ff987a7253ac413176f2b074cf7815e540260801c916152a7565b916ffcbe86c7900a88aedcffc83b479aa3a40260801c9161529d565b916ffe5dee046a99a2a811c461f1969c30530260801c91615293565b916fff2ea16466c96a3843ec78b326b528610260801c9161528a565b916fff973b41fa98c081472e6896dfb254c00260801c91615281565b916fffcb9843d60f6159c9db58835c9266440260801c91615278565b916fffe5caca7e10e4e61c3624eaa0941cd00260801c9161526f565b916ffff2e50f5f656932ef12357cf3c7fdcc0260801c91615266565b916ffff97272373d413259a46990580e213a0260801c9161525d565b826345c3193d60e11b5f5260045260245ffd5b61320a9261558d929091906001600160a01b0380821690831611615592575b61557b6001600160a01b038281169084166174b0565b9190036001600160a01b031691617583565b617603565b90615565565b61320a9261558d9290916001600160a01b03808316908216116155c7575b90036001600160a01b0316906174f9565b906155b6565b80156156ca576016546001600160a01b03167f00000000000000000000000000000000000000000000000000000000000000008115613cab576040516342bb207560e01b8152602081600481865afa908115611aaa575f91615698575b5015613cab5761563b838383616b3e565b813b15611ab55760405163b6b55f2560e01b8152600481018490525f8160248183875af19081615688575b50615675576143dc9250616b0f565b5050615683906018546132da565b601855565b5f615692916131d1565b5f615666565b90506020813d6020116156c2575b816156b3602093836131d1565b81010312611ab557515f61562a565b3d91506156a6565b50565b80156156ca576017546001600160a01b03167f00000000000000000000000000000000000000000000000000000000000000008115613cab576040516342bb207560e01b8152602081600481865afa908115611aaa575f91615798575b5015613cab5761573b838383616b3e565b813b15611ab55760405163b6b55f2560e01b8152600481018490525f8160248183875af19081615788575b50615775576143dc9250616b0f565b5050615783906019546132da565b601955565b5f615792916131d1565b5f615766565b90506020813d6020116157c2575b816157b3602093836131d1565b81010312611ab557515f61572a565b3d91506157a6565b8115613d5c57801561591c576017546001600160a01b03165b81156158f5577f0000000000000000000000000000000000000000000000000000000000000000905b6001600160a01b03169182156158bd576040516342bb207560e01b8152602081600481875afa908115611aaa575f916158c3575b50156158bd57615851848484616b3e565b823b15611ab55760405163b6b55f2560e01b8152600481018590525f8160248183885af190816158ad575b5061588c57506143dc9250616b0f565b9150505f146158a157615783906019546132da565b615683906018546132da565b5f6158b7916131d1565b5f61587c565b50505050565b90506020813d6020116158ed575b816158de602093836131d1565b81010312611ab557515f615840565b3d91506158d1565b7f00000000000000000000000000000000000000000000000000000000000000009061580c565b6016546001600160a01b03166157e3565b8060801d81600f0b915f9180600f0b5f81125f14615a335750615966906001600160801b0361430660018060a01b036002541692613d7f565b818312156159905750506143dc906001600160801b0361430660018060a01b036003541692613d7f565b9080921361599c575050565b6003546001600160a01b03908116917f000000000000000000000000000000000000000000000000000000000000000090911690813b1561054057604051630b0d9c0960e01b81526001600160a01b039390931660048401523060248401526001600160801b0316604483015282908290606490829084905af180156140c55715613d5c57615a2c8280926131d1565b6104575750565b5f12615a40575b50615966565b6002546001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008116929116823b15611ab557604051630b0d9c0960e01b81526001600160a01b039190911660048201523060248201526001600160801b03919091166044820152905f908290606490829084905af18015611aaa5715615a3a57615ad39192505f906131d1565b5f905f615a3a565b60055460ff811615908115616012575b508015615fff575b6139b557602090615b515f610d94615b30604051615b1187826131d1565b838152604051928391600389840152604080840152606083019061316a565b604051809381926348c8949160e01b8352876004840152602483019061316a565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af18015611aaa57615ba0915f91615fe5575b508380825183010191016133f4565b9190928284159081615fdc575b50615fd357615bbb84617626565b615bc486617626565b601054919592939091871c6001600160a01b031680615eb25750615be885846132da565b615bf287866132da565b9080615e61575b5080615e10575b505b600e546001600160a01b031615615d45578015801590615d3c575b615c6f575b50509160c093917f472d3768bc16f9205ad3ebbd417adcaed0ddd501007b5f43d1202d88779a509d95935b88604051958b875286015260408501526060840152608083015260a0820152a1565b94929095939160018060a01b03600e541696600f5497803b15611ab557604051633d27ad3f60e11b8152600481019990995260248901889052604489018290525f908990606490829084905af1978815611aaa57604060c0987fd5dc9d358dcea5f90a12ff926dd789d5129808c7d740659e8f51a6a66e8df10f927f472d3768bc16f9205ad3ebbd417adcaed0ddd501007b5f43d1202d88779a509d9b615d2c575b50600f5493825191825289820152a291939581939550615c22565b5f615d36916131d1565b5f615d11565b50811515615c1d565b949290959391670de0b6b3a76400008602868104670de0b6b3a764000014871517156130c457615d8f615d876001600160801b0360055460401c1680936132fa565b600a546132da565b600a55670de0b6b3a7640000880297808904670de0b6b3a764000014811517156130c457615dfd60c098615df2615dea615e08957f472d3768bc16f9205ad3ebbd417adcaed0ddd501007b5f43d1202d88779a509d9d6132fa565b600b546132da565b600b556014546132da565b6014556015546132da565b601555615c4d565b615e5b907f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000615005565b5f615c00565b615eac907f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000615005565b5f615bf9565b83615f83575b84615f33575b85615f03575b8680615ed2575b5050615c02565b615efc917f0000000000000000000000000000000000000000000000000000000000000000615005565b5f86615ecb565b615f2e86827f0000000000000000000000000000000000000000000000000000000000000000615005565b615ec4565b615f7e857f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000615005565b615ebe565b615fce847f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000615005565b615eb8565b505f9250829150565b9050155f615bad565b615ff991503d805f833e610e7e81836131d1565b5f615b91565b506001600160801b036006541615615af3565b6001600160801b03915060401c16155f615aeb565b905f6001600160801b0383168015801561649e575b616498576006546001600160801b03811680921161648f575b6016546040516342bb207560e01b815290602090829060049082906001600160a01b03165afa908115611aaa575f9161645d575b501580156163ef575b6163e8577f0000000000000000000000000000000000000000000000000000000000000000915f80876160cf60a06160c8613354565b208761511f565b505050926005546160f46160e88260081c60020b615219565b9160201c60020b615219565b916001600160a01b0386811690831681116163ac575050616116939450617d3f565b1590816163a3575b5061639b575f9283926001600160801b0361613c896161be95614440565b16906001600160801b03191617600655601a546001600160801b0361616389828416613325565b16906001600160801b03191617601a55610d9461619a6040516001600160801b038a16602082015260208152611f336040826131d1565b6040519485809481936348c8949160e01b835260206004840152602483019061316a565b03926001600160a01b03165af18015611aaa576161eb915f916163815750602080825183010191016133f4565b9390916161fa836018546132da565b601855616209856019546132da565b601955826162f4575b84616265575b506140287fa4a3c8a44968854271fe3a2bffddc178c5f12da611f33aea8810735f86d031639394604051938493846040919493926001600160801b03606083019616825260208201520152565b60175461629d9086906001600160a01b03167f0000000000000000000000000000000000000000000000000000000000000000616b3e565b6017546001600160a01b0316803b156105445781809160246040518094819363b6b55f2560e01b83528b60048401525af180156140c5576162df575b50616218565b6162ea8280926131d1565b61045757806162d9565b60165461632c9084906001600160a01b03167f0000000000000000000000000000000000000000000000000000000000000000616b3e565b6016546001600160a01b0316803b15611ab5575f809160246040518094819363b6b55f2560e01b83528960048401525af18015611aaa5761636e575b50616212565b61637a91505f906131d1565b5f80616368565b61639591503d805f833e610e7e81836131d1565b5f611fb2565b505050509050565b9050155f61611e565b919450906001600160a01b03831611156163dd5750926163d1826163d7949583617d3f565b93617d13565b90616116565b93506163d792617d13565b5050509050565b506017546040516342bb207560e01b815290602090829060049082906001600160a01b03165afa908115611aaa575f9161642b575b5015616092565b90506020813d602011616455575b81616446602093836131d1565b81010312611ab557515f616424565b3d9150616439565b90506020813d602011616487575b81616478602093836131d1565b81010312611ab557515f616089565b3d915061646b565b93508093616055565b50509050565b506001600160801b03600654161561603c565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031691823b15611ab557604051632961046560e21b81526001600160a01b03909216600483018190525f92838160248183895af18015611aaa57616580575b5092616528602092828596615005565b600460405180958193630476982d60e21b83525af1908115616574575061654c5750565b6156ca9060203d60201161656d575b61656581836131d1565b810190613345565b503d61655b565b604051903d90823e3d90fd5b849193506020926165945f616528936131d1565b5f9492509250616518565b905f6001600160801b038316801580156169f6575b616498576001600160801b03601a54168091116169ee575b806121116165ee6165f7936121116001600160801b03601854991680996132e7565b956019546132e7565b9280156169e657601654604051632e1a7d4d60e01b81526004810192909252602090829060249082905f906001600160a01b03165af1908115611aaa575f916169b4575b50925b80156169ac57601754604051632e1a7d4d60e01b81526004810192909252602090829060249082905f906001600160a01b03165af1908115611aaa575f9161697a575b50905b5f905f925f958015801590616971575b6168a6575b866167288661672e936166ae82601854613318565b6018556166bd84601954613318565b6019556006546001600160801b036166d78a828416613325565b6fffffffffffffffffffffffffffffffff19909216911617600655601a546001600160801b036167138282168b831681106168a0578b90614440565b16906001600160801b03191617601a55613318565b92613318565b9080616815575b508061678a575b50506140287fa9754b81ef2a4999df2b2d8464d6c77cc22182c9efba9f17d53df2c66208f57c9394604051938493846040919493926001600160801b03606083019616825260208201520152565b6017546167c29082906001600160a01b03167f0000000000000000000000000000000000000000000000000000000000000000616b3e565b6017546001600160a01b031690813b156113b857829160248392604051948593849263b6b55f2560e01b845260048401525af180156140c5571561673c5761680b8280926131d1565b610457578061673c565b60165461684d9082906001600160a01b03167f0000000000000000000000000000000000000000000000000000000000000000616b3e565b6016546001600160a01b031690813b15611ab5575f9160248392604051948593849263b6b55f2560e01b845260048401525af18015611aaa5715616735576168989192505f906131d1565b5f905f616735565b80614440565b925092506168f694505f610d946168d460405185602082015286604082015260408152612d3c6060826131d1565b604051809781926348c8949160e01b835260206004840152602483019061316a565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af1928315611aaa5761694d61672e94616728975f916169575750602080825183010191016132b8565b9750945092616699565b61696b91503d805f833e610e7e81836131d1565b5f612dad565b50811515616694565b90506020813d6020116169a4575b81616995602093836131d1565b81010312611ab557515f616681565b3d9150616988565b505f90616684565b90506020813d6020116169de575b816169cf602093836131d1565b81010312611ab557515f61663b565b3d91506169c2565b505f9261663e565b9250826165cc565b506001600160801b03601a5416156165b4565b6001600160a01b03165f908152600860205260409020600281015460ff166004811015613025578015616aae576001820154421015616aae57616a4e616a5691617423565b915442613318565b9080616a8d57505060645b60148110616a875760328110616a8157605011616a7c575f90565b603290565b50606490565b5060c890565b6064820291808304606414901517156130c457616aa9916132fa565b616a61565b50505f90565b90616ac15f19828461765e565b15616aca575050565b616ad481836176ab565b15616aee57616ae6905f19908361770f565b15614fc45750565b50635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b90616b1b5f828461765e565b15616b24575050565b616b2e81836176ab565b15616aee575f616ae6918361770f565b9190616b4b82828561765e565b15616b5557505050565b616b5f81846176ab565b15616b6f5790616ae6918361770f565b635274afe760e01b5f9081526001600160a01b038416600452602490fd5b907f000000000000000000000000000000000000000000000000000000000000000091616bea616bc060a0610d09613354565b50505092600554928360081c60020b94616bd986615219565b9460201c60020b9461469086615219565b906001600160801b038216938415616e89576040516370a0823160e01b8152306004820152907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602083602481855afa928315611aaa575f93616e55575b506040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169790946020866024818c5afa958615611aaa575f96616e1b575b50915f97616ced92604094855192616cc1846131a1565b83526020830152848201528860608201528351988980948193632d35e7ed60e11b83526004830161340a565b03926001600160a01b03165af1908115611aaa57616d166020926024975f91613760575061592d565b6040516370a0823160e01b815230600482015295869182905afa938415611aaa575f94616de5575b50616d4d602494602092613318565b94604051948580926370a0823160e01b82523060048301525afa928315611aaa575f93616daf575b50616d8661320a93610d9492613318565b604051948593602085016040919493926001600160801b03606083019616825260208201520152565b92506020833d602011616ddd575b81616dca602093836131d1565b81010312611ab557915191616d86616d75565b3d9150616dbd565b93506020843d602011616e13575b81616e00602093836131d1565b81010312611ab557925192616d4d616d3e565b3d9150616df3565b91929095506020823d602011616e4d575b81616e39602093836131d1565b81010312611ab5579051949091905f616caa565b3d9150616e2c565b9092506020813d602011616e81575b81616e71602093836131d1565b81010312611ab55751915f616c52565b3d9150616e64565b50505050506040515f60208201525f60408201525f60608201526060815261320a6080826131d1565b61320a90929192616edc616ece60035460b81c60020b92614417565b616ee183616edc83896133d7565b6151be565b956133b9565b6040516278744560e21b8152919291906001600160a01b0316602082600481845afa918215611aaa575f9261714c575b5082821115617142576024616f2f5f94602094613318565b6040519485938492632e1a7d4d60e01b845260048401525af1908115611aaa575f91617110575b508015617108576109c481028181046109c4036130c457612710616f8191048092816170dd57613318565b9182156170d557600e546001600160a01b0316156170355750600e54600f5492939192906001600160a01b0316803b15611ab557604051633d27ad3f60e11b81526004810192909252602482018590525f60448301819052908290606490829084905af18015611aaa57617025575b50600f547fd5dc9d358dcea5f90a12ff926dd789d5129808c7d740659e8f51a6a66e8df10f604080518681525f6020820152a2565b5f61702f916131d1565b5f616ff0565b60055460401c6001600160801b031661708257906170798361707e94937f000000000000000000000000000000000000000000000000000000000000000090615005565b6132da565b5f91565b509091670de0b6b3a76400008302838104670de0b6b3a764000014841517156130c457615d876170c1916001600160801b0360055460401c16906132fa565b600a556170d0836014546132da565b601455565b505f92909150565b611eb5827f000000000000000000000000000000000000000000000000000000000000000087615005565b50505f905f90565b90506020813d60201161713a575b8161712b602093836131d1565b81010312611ab557515f616f56565b3d915061711e565b505050505f905f90565b9091506020813d602011617178575b81617168602093836131d1565b81010312611ab55751905f616f17565b3d915061715b565b6040516278744560e21b81526001600160a01b039091169391925f91602081600481895afa908115611aaa575f916173f1575b50818111156173e6579460246171cd6020935f9798613318565b6040519687938492632e1a7d4d60e01b845260048401525af1928315611aaa575f936173b2575b508215615fd3576109c483028381046109c4036130c45761271061721f910480948161738757613318565b93841561738057600e546001600160a01b0316156172e8575080156172e05783815b60018060a01b03600e5416600f54813b156113b857604051633d27ad3f60e11b8152600481019190915260248101849052604481018590529082908290606490829084905af180156140c5576172c9575b505060407fd5dc9d358dcea5f90a12ff926dd789d5129808c7d740659e8f51a6a66e8df10f91600f549382519182526020820152a2565b816172d3916131d1565b805f126104575780617292565b5f8491617241565b939091926001600160801b0360055460401c1680155f146173395750617079826173359495967f000000000000000000000000000000000000000000000000000000000000000090615005565b9091565b919450929150670de0b6b3a76400008402848104670de0b6b3a764000014851517156130c45761736c91615dea916132fa565b600b5561737b836015546132da565b601555565b505f935050565b611eb5827f000000000000000000000000000000000000000000000000000000000000000089615005565b9092506020813d6020116173de575b816173ce602093836131d1565b81010312611ab55751915f6171f4565b3d91506173c1565b505f94508493505050565b90506020813d60201161741b575b8161740c602093836131d1565b81010312611ab557515f6171b3565b3d91506173ff565b60048110156130255760018114617456576002811461744e57600314617447575f90565b62ed4e0090565b506276a70090565b5062278d0090565b601f54801561748457602054430361320a5760215480821115616aae5761320a91613318565b505f1990565b6040516020810191825260066040820152604081526174aa6060826131d1565b51902090565b81810291905f1982820991838084109303928084039384600160601b1115611ab557146174f057600160601b910990828211900360a01b910360601c1790565b50505060601c90565b90606082901b905f19600160601b840992828085109403938085039485841115611ab5571461757c578190600160601b900981805f03168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b5091500490565b91818302915f1981850993838086109503948086039586851115611ab557146175fb579082910981805f03168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b505091500490565b906001600160801b03821680920361761757565b6393dafdf160e01b5f5260045ffd5b61ffff9161320a60105492611eb561271061765581617647898916866132e7565b0497889760101c16846132e7565b04948592613318565b92916040519163095ea7b360e01b5f5260018060a01b031660045260245260205f60448180875af19260015f511484161561769a575b50604052565b3d15903b151516909216915f617694565b60405163095ea7b360e01b5f9081526001600160a01b03909316600452602483905290929160209060448180875af19260015f51148416156176ed5750604052565b60018492941516617706573b15153d151616915f617694565b833d5f823e3d90fd5b92916040519163095ea7b360e01b5f5260018060a01b031660045260245260205f60448180875af19260015f51148416156176ed5750604052565b936001600160a01b03838116908316116177dd575b6001600160a01b0385811695908316861161778057505061320a9350615546565b919490939192906001600160a01b03821611156177d15782916177a7916177ad9594615546565b93615598565b6001600160801b0381166001600160801b038316105f146177cc575090565b905090565b91505061320a92615598565b90919061775f565b602254908115617a6b576002546016546040516370a0823160e01b81526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660048301819052957f0000000000000000000000000000000000000000000000000000000000000000949382169382169290916020908290602490829089165afa908115611aaa575f91617a39575b5080821015617a315750945b8515617a2857803b15611ab557604051637a94c56560e11b81523060048201526001600160a01b0383166024820152604481018790525f8160648183865af18015611aaa57617a18575b50803b15611ab557604051630b0d9c0960e01b81526001600160a01b03929092166004830152306024830152604482018690525f908290606490829084905af18015611aaa57617a08575b5061792a84602254613318565b6022556001600160a01b0316801515806179a9575b617947575050565b617952848284616b3e565b803b15611ab55760405163b6b55f2560e01b8152600481018590525f8160248183865af19081617999575b5061798b576143dc91616b0f565b5050615683826018546132da565b5f6179a3916131d1565b5f61797d565b506040516342bb207560e01b8152602081600481855afa908115611aaa575f916179d6575b50151561793f565b90506020813d602011617a00575b816179f1602093836131d1565b81010312611ab557515f6179ce565b3d91506179e4565b5f617a12916131d1565b5f61791d565b5f617a22916131d1565b5f6178d2565b505f9450505050565b905094617888565b90506020813d602011617a63575b81617a54602093836131d1565b81010312611ab557515f61787c565b3d9150617a47565b5f9150565b5f9060235480156137f9576003546017546040516370a0823160e01b81526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660048301819052938116967f000000000000000000000000000000000000000000000000000000000000000095909493821693929091602090829060249082908a165afa908115611aaa575f91617ce1575b5080821015617cd95750955b8615617ccf57813b15611ab557604051637a94c56560e11b81523060048201526001600160a01b0382166024820152604481018890525f8160648183875af18015611aaa57617cba575b50813b1561054057604051630b0d9c0960e01b81526001600160a01b03919091166004820152306024820152604481018790529083908290606490829084905af1801561417157908391617ca5575b5050617bbe85602354613318565b6023556001600160a01b03169081151580617c46575b617bdd57505050565b617be8858385616b3e565b813b156104575760405163b6b55f2560e01b81526004810186905290808260248183875af19182617c31575b5050617c23576143dc91616b0f565b5050615783826019546132da565b617c3c8280926131d1565b6104575780617c14565b506040516342bb207560e01b8152602081600481865afa9081156140c5578291617c73575b501515617bd4565b90506020813d602011617c9d575b81617c8e602093836131d1565b81010312611ab557515f617c6b565b3d9150617c81565b81617caf916131d1565b61054457815f617bb0565b617cc79194505f906131d1565b5f925f617b61565b505f955050505050565b905095617b17565b90506020813d602011617d0b575b81617cfc602093836131d1565b81010312611ab557515f617b0b565b3d9150617cef565b61320a926001600160a01b03928316919092160360ff81901d90810118906001600160801b03166174b0565b906001600160a01b0380821690831611617da7575b6001600160a01b038216918215617d9b5761320a93612111926001600160a01b0380821693909103169060601b6fffffffffffffffffffffffffffffffff60601b16617583565b62bfc9215f526004601cfd5b90617d5456fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00f807ed7de821bda1f30b14a07785929f138dd9691606aedbed486d267ae2aaee1a915d52045db80201f451cb9ed487b2ecafc496b3e5f28cfa28bff3467ee654a2646970667358221220fd4a7f50dbf9b5a54d8f981e9cbf6449b95c417cd3300aceb1c9379ee654255464736f6c634300081a0033" as const;
