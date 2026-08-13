// AUTO-EXTRACTED from contracts-v4/src/payments/MintwarePaymentGateway.sol via forge out (do not edit by hand).
// YPN v1 payment gateway (AccessControl+EIP712). Constructor: (vault, usdc, treasury, admin).
export const PAYMENT_GATEWAY_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "vault_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "usdc_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "treasury_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "admin_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
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
    "name": "DEFAULT_GLOBAL_DAILY_CAP",
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
    "name": "DELEGATED_SPEND_PERMIT_TYPEHASH",
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
    "name": "EDGE_SIGNER_ROLE",
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
    "name": "HIGH_VALUE_THRESHOLD",
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
    "name": "MAX_SHORT_LIVED_WINDOW",
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
    "name": "PAUSER_ROLE",
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
    "name": "RELAYER_ROLE",
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
    "name": "SHORT_LIVED_HOLD_AUTH_TYPEHASH",
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
    "name": "cancelHold",
    "inputs": [
      {
        "name": "holdId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "circleCpnTreasury",
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
    "name": "dailySpendUSDC",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "domainSeparator",
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
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRoleAdmin",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
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
    "name": "grantRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hasRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
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
    "name": "holds",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountUSDC",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "settledAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "settled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "cancelled",
        "type": "bool",
        "internalType": "bool"
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
    "name": "renounceRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "callerConfirmation",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeNonce",
    "inputs": [
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setCircleCpnTreasury",
    "inputs": [
      {
        "name": "newTreasury",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setUserDailyCap",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newCap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settleSpend",
    "inputs": [
      {
        "name": "holdId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "assets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "permit",
        "type": "tuple",
        "internalType": "struct MintwarePaymentGateway.DelegatedSpendPermit",
        "components": [
          {
            "name": "user",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "maxDailySpendUSDC",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "permitSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "edgeAuth",
        "type": "tuple",
        "internalType": "struct MintwarePaymentGateway.ShortLivedHoldAuth",
        "components": [
          {
            "name": "holdId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "user",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amountUSDC",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "edgeSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "sharesBurned",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
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
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "usdc",
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
    "name": "usedNonces",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "userDailyCap",
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
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IYieldVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HoldCancelled",
    "inputs": [
      {
        "name": "holdId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NonceRevoked",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
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
    "name": "PaymentSettled",
    "inputs": [
      {
        "name": "holdId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "assets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "sharesBurned",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleAdminChanged",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "previousAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleGranted",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleRevoked",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TreasuryUpdated",
    "inputs": [
      {
        "name": "oldTreasury",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newTreasury",
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
    "name": "UserDailyCapUpdated",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newCap",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AccessControlBadConfirmation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AccessControlUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "neededRole",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureLength",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureS",
    "inputs": [
      {
        "name": "s",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "EdgeAuthExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EdgeSignatureRequired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExceedsDailySpendLimit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HoldAlreadySettled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HoldCancelledError",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientIdleLiquidity",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEdgeSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPermitSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NonceRevokedError",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PermitExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const

export const PAYMENT_GATEWAY_BYTECODE = '0x6101a08060405234610299576080816122738038038091610020828561029d565b83398101031261029957610033816102d4565b61003f602083016102d4565b916100586060610051604084016102d4565b92016102d4565b9160405161006760408261029d565b6018815260208101907f4d696e7477617265205061796d656e74204761746577617900000000000000008252604051916100a260408461029d565b600383526020830191620322e360ec1b83526100bd8161053d565b610120526100ca846106d8565b61014052519020918260e05251902080610100524660a0526040519060208201927f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f8452604083015260608201524660808201523060a082015260a0815261013360c08261029d565b5190206080523060c05260017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00556001600160a01b03169283158015610288575b8015610277575b8015610266575b61025757610160939093526001600160a01b03929092166101805260038054610100600160a81b03191660089390931b610100600160a81b0316929092179091556101ea906101d0816102e8565b506101da8161035e565b506101e481610417565b506104aa565b506040516119e290816108118239608051816115a0015260a0518161165d015260c0518161156a015260e051816115ef0152610100518161161501526101205181610c1e01526101405181610c47015261016051818181610191015261067801526101805181610fa60152f35b63d92e233d60e01b5f5260045ffd5b506001600160a01b03831615610182565b506001600160a01b0382161561017b565b506001600160a01b03811615610174565b5f80fd5b601f909101601f19168101906001600160401b038211908210176102c057604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b038216820361029957565b6001600160a01b0381165f9081525f80516020612253833981519152602052604090205460ff16610359576001600160a01b03165f8181525f8051602061225383398151915260205260408120805460ff191660011790553391905f805160206121f38339815191528180a4600190565b505f90565b6001600160a01b0381165f9081527ffaf93c3d007e112089dc8351e013e6685ef67703975d0224b26fc45941d4f1f5602052604090205460ff16610359576001600160a01b03165f8181527ffaf93c3d007e112089dc8351e013e6685ef67703975d0224b26fc45941d4f1f560205260408120805460ff191660011790553391907fe2b7fb3b832174769106daebcfd6d1970523240dda11281102db9363b83b0dc4905f805160206121f38339815191529080a4600190565b6001600160a01b0381165f9081525f80516020612233833981519152602052604090205460ff16610359576001600160a01b03165f8181525f8051602061223383398151915260205260408120805460ff191660011790553391907f1616c181c5786e34bc2b9c4362f059cce08e5c90dabce7e7a645083d699cd0eb905f805160206121f38339815191529080a4600190565b6001600160a01b0381165f9081525f80516020612213833981519152602052604090205460ff16610359576001600160a01b03165f8181525f8051602061221383398151915260205260408120805460ff191660011790553391907f65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a905f805160206121f38339815191529080a4600190565b908151602081105f146105b7575090601f815111610577576020815191015160208210610568571790565b5f198260200360031b1b161790565b604460209160405192839163305a27a960e01b83528160048401528051918291826024860152018484015e5f828201840152601f01601f19168101030190fd5b6001600160401b0381116102c057600154600181811c911680156106ce575b60208210146106ba57601f8111610687575b50602092601f821160011461062657928192935f9261061b575b50508160011b915f199060031b1c19161760015560ff90565b015190505f80610602565b601f1982169360015f52805f20915f5b86811061066f5750836001959610610657575b505050811b0160015560ff90565b01515f1960f88460031b161c191690555f8080610649565b91926020600181928685015181550194019201610636565b60015f52601f60205f20910160051c810190601f830160051c015b8181106106af57506105e8565b5f81556001016106a2565b634e487b7160e01b5f52602260045260245ffd5b90607f16906105d6565b908151602081105f14610703575090601f815111610577576020815191015160208210610568571790565b6001600160401b0381116102c057600254600181811c91168015610806575b60208210146106ba57601f81116107d3575b50602092601f821160011461077257928192935f92610767575b50508160011b915f199060031b1c19161760025560ff90565b015190505f8061074e565b601f1982169360025f52805f20915f5b8681106107bb57508360019596106107a3575b505050811b0160025560ff90565b01515f1960f88460031b161c191690555f8080610795565b91926020600181928685015181550194019201610782565b60025f52601f60205f20910160051c810190601f830160051c015b8181106107fb5750610734565b5f81556001016107ee565b90607f169061072256fe6080806040526004361015610012575f80fd5b5f3560e01c90816301ffc9a71461116c5750806305c1ee20146110f25780631d9a4a52146110ba578063248a9ca3146110905780632f2ff15d1461105357806336568abe1461100f578063383e58f814610fd55780633e413bee14610f915780633f4ba83a14610f2b5780635c975abb14610f095780636a8a689414610ec05780637175a3c214610e5b57806373356c0d14610e21578063772d3b9814610e035780637b5576a614610dc957806383a522c114610d575780638456cb5914610cfe57806384b0196e14610c065780638849bb4f14610bea5780638856d2fa14610ba65780638ef3b2941461044e57806391d1485414610406578063926d7d7f146103cc578063a217fddf146103b2578063a8d8d2a514610318578063ca7b64bb146102fa578063cee058ed14610290578063d547741f1461024c578063e63ab1e914610212578063e84fbba7146101e6578063f698da25146101c45763fbfa77cf1461017c575f80fd5b346101c0575f3660031901126101c0576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5f80fd5b346101c0575f3660031901126101c05760206101de611567565b604051908152f35b346101c0575f3660031901126101c05760035460405160089190911c6001600160a01b03168152602090f35b346101c0575f3660031901126101c05760206040517f65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a8152f35b346101c05760403660031901126101c05761028e60043561026b6111d5565b90610289610284825f525f602052600160405f20015490565b61140c565b6114cc565b005b346101c05760403660031901126101c0576102a96111bf565b7fa172b4ec094c93b7aae396b23bf2906601d5678a168caf7f2e475a540f907dfe6020602435926102d86113bd565b6001600160a01b03165f818152600583526040908190208590555193845292a2005b346101c0575f3660031901126101c0576020604051630ee6b2808152f35b346101c05760203660031901126101c0576103316111bf565b6103396113bd565b6001600160a01b0381169081156103a35760035491600883901c6001600160a01b03167f4ab5be82436d353e61ca18726e984e561f5c1cc7c6d38b29d2553c790434705a5f80a3610100600160a81b031990911660089190911b610100600160a81b031617600355005b63d92e233d60e01b5f5260045ffd5b346101c0575f3660031901126101c05760206040515f8152f35b346101c0575f3660031901126101c05760206040517fe2b7fb3b832174769106daebcfd6d1970523240dda11281102db9363b83b0dc48152f35b346101c05760403660031901126101c05761041f6111d5565b6004355f525f60205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b346101c0576101e03660031901126101c05760043561046b6111d5565b604435916064356001600160a01b0381169290918383036101c05760803660831901126101c0576101043567ffffffffffffffff81116101c0576104b390369060040161120f565b90939060a0366101231901126101c0576101c43567ffffffffffffffff81116101c0576104e490369060040161120f565b9190926104ef61134e565b60027f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f005414610b975760027f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f005561054461154c565b968815610b885715610b72575b60e43590814211610b635761056461125f565b6001600160a01b039687169616869003610b545761062f610626879261062061058b61125f565b9a61061860a4359c8d60c435996040519160208301937fc6a813598a61baa41e1ba9e80ed962c98953b20795050cf0b1419cb829a1c3ba855260018060a01b0316604084015260608301528a608083015260a082015260a081526105f060c08261123d565b5190206105fb611567565b6042916040519161190160f01b8352600283015260228201522090565b92369161128c565b9061187c565b909291926118b6565b6001600160a01b031603610b5457845f52600660205260405f20905f5260205260ff60405f205416610b4557630ee6b2808710156109dd575b505060405162338e9f60e91b81527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169390602081600481885afa80156109165787915f916109a8575b50106108d257815f526007602052600360405f20015460ff81166109995760081c60ff1661098a575f8381526005602052604090205462015180420491901561098057835f52600560205260405f20545b8082101561097957505b835f52600460205260405f20825f5260205260405f20549061073788836112d2565b1161096a5786610746916112d2565b90835f52600460205260405f20905f5260205260405f205560405160a0810181811067ffffffffffffffff82111761095657604052828152602081018681526003604083019242845260608101936001855260808201935f8552865f52600760205260405f209260018060a01b039051166bffffffffffffffffffffffff60a01b845416178355516001830155516002820155019151151560ff8019845416911617825551151561ff0082549160081b169061ff00191617905560405193630a28a47760e01b8552856004860152602085602481875afa948515610916575f95610921575b5060205f916064604051809481936314cd92af60e31b83528860048401528a602484015260018060a01b0316988960448401525af180156109165786915f916108e1575b50106108d2577f68ebe01b4f352b6188e551d6ff2b1636a7df4c2c84a6a9236ec0cc75cd235056604060209681519081528688820152a460017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f0055604051908152f35b63267e966b60e11b5f5260045ffd5b9150506020813d60201161090e575b816108fd6020938361123d565b810103126101c0578590518761086f565b3d91506108f0565b6040513d5f823e3d90fd5b9094506020813d60201161094e575b8161093d6020938361123d565b810103126101c0575193602061082b565b3d9150610930565b634e487b7160e01b5f52604160045260245ffd5b6326e1837160e01b5f5260045ffd5b9050610715565b633b9aca0061070b565b63468d0be960e01b5f5260045ffd5b63045195bb60e31b5f5260045ffd5b9150506020813d6020116109d5575b816109c46020938361123d565b810103126101c057869051886106ba565b3d91506109b7565b8015610b36576101243590838214801590610b1c575b8015610b0f575b610add576101a43591824211610aec5761012c4201804211610afb578311610aec57610a98936106186106209261062695610a33611275565b906040519160208301937fbdef5542e31ee3c2e2fc905bdc9359f035febd2cf8fa1c6c1b8c11e9e0dd39528552604084015260018060a01b031660608301526101643560808301526101843560a083015260c082015260c081526105f060e08261123d565b6001600160a01b03165f9081527fd8fddc8ec489904ab4437d22f3538e8355961ec91a08e899b37466a5c958b565602052604090205460ff1615610add578580610668565b633e28b31560e21b5f5260045ffd5b63ba2fd49760e01b5f5260045ffd5b634e487b7160e01b5f52601160045260245ffd5b50876101643514156109fa565b50846001600160a01b03610b2e611275565b1614156109f3565b630ea3299160e01b5f5260045ffd5b633f80187960e01b5f5260045ffd5b632919505160e21b5f5260045ffd5b63068568f360e21b5f5260045ffd5b60035460081c6001600160a01b03169650610551565b63162908e360e11b5f5260045ffd5b633ee5aeb560e01b5f5260045ffd5b346101c05760403660031901126101c0576001600160a01b03610bc76111bf565b165f52600460205260405f206024355f52602052602060405f2054604051908152f35b346101c0575f3660031901126101c057602060405161012c8152f35b346101c0575f3660031901126101c057610ca2610c427f0000000000000000000000000000000000000000000000000000000000000000611683565b610c6b7f00000000000000000000000000000000000000000000000000000000000000006117ac565b6020610cb060405192610c7e838561123d565b5f84525f368137604051958695600f60f81b875260e08588015260e08701906111eb565b9085820360408701526111eb565b4660608501523060808501525f60a085015283810360c08501528180845192838152019301915f5b828110610ce757505050500390f35b835185528695509381019392810192600101610cd8565b346101c0575f3660031901126101c057610d166112df565b610d1e61154c565b600160ff1960035416176003557f62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a2586020604051338152a1005b346101c05760203660031901126101c057600435610d7361134e565b805f52600760205260405f2060038101805460ff81166109995761ff001916610100179055546001600160a01b0316907f62ce44aaa9b20327c1a3fe0091eda5c238200bc322f7d4e91c67456a352539205f80a3005b346101c0575f3660031901126101c05760206040517fbdef5542e31ee3c2e2fc905bdc9359f035febd2cf8fa1c6c1b8c11e9e0dd39528152f35b346101c0575f3660031901126101c0576020604051633b9aca008152f35b346101c0575f3660031901126101c05760206040517f1616c181c5786e34bc2b9c4362f059cce08e5c90dabce7e7a645083d699cd0eb8152f35b346101c05760203660031901126101c0576004355f52600760205260a060405f2060ff600180841b03825416916001810154906003600282015491015491604051948552602085015260408401528181161515606084015260081c1615156080820152f35b346101c05760403660031901126101c0576001600160a01b03610ee16111bf565b165f52600660205260405f206024355f52602052602060ff60405f2054166040519015158152f35b346101c0575f3660031901126101c057602060ff600354166040519015158152f35b346101c0575f3660031901126101c057610f436112df565b60035460ff811615610f825760ff19166003557f5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa6020604051338152a1005b638dfc202b60e01b5f5260045ffd5b346101c0575f3660031901126101c0576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346101c0575f3660031901126101c05760206040517fc6a813598a61baa41e1ba9e80ed962c98953b20795050cf0b1419cb829a1c3ba8152f35b346101c05760403660031901126101c0576110286111d5565b336001600160a01b038216036110445761028e906004356114cc565b63334bd91960e11b5f5260045ffd5b346101c05760403660031901126101c05761028e6004356110726111d5565b9061108b610284825f525f602052600160405f20015490565b611444565b346101c05760203660031901126101c05760206101de6004355f525f602052600160405f20015490565b346101c05760203660031901126101c0576001600160a01b036110db6111bf565b165f526005602052602060405f2054604051908152f35b346101c05760203660031901126101c057600435335f52600660205260405f20815f5260205260ff60405f205416610b4557335f52600660205260405f20815f5260205260405f20600160ff19825416179055337f22cd1acb7e7a306800a1b2c0ca9b0280187bbc00b7fbf55d38ad6cbf73082aec5f80a3005b346101c05760203660031901126101c0576004359063ffffffff60e01b82168092036101c057602091637965db0b60e01b81149081156111ae575b5015158152f35b6301ffc9a760e01b149050836111a7565b600435906001600160a01b03821682036101c057565b602435906001600160a01b03821682036101c057565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b9181601f840112156101c05782359167ffffffffffffffff83116101c057602083818601950101116101c057565b90601f8019910116810190811067ffffffffffffffff82111761095657604052565b6084356001600160a01b03811681036101c05790565b610144356001600160a01b03811681036101c05790565b92919267ffffffffffffffff821161095657604051916112b6601f8201601f19166020018461123d565b8294818452818301116101c0578281602093845f960137010152565b91908201809211610afb57565b335f9081527ff7c9542c591017a21c74b6f3fab6263c7952fc0aaf9db4c22a2a04ddc7f8674f602052604090205460ff161561131757565b63e2517d3f60e01b5f52336004527f65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a60245260445ffd5b335f9081527ffaf93c3d007e112089dc8351e013e6685ef67703975d0224b26fc45941d4f1f5602052604090205460ff161561138657565b63e2517d3f60e01b5f52336004527fe2b7fb3b832174769106daebcfd6d1970523240dda11281102db9363b83b0dc460245260445ffd5b335f9081527fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5602052604090205460ff16156113f557565b63e2517d3f60e01b5f52336004525f60245260445ffd5b5f8181526020818152604080832033845290915290205460ff161561142e5750565b63e2517d3f60e01b5f523360045260245260445ffd5b5f818152602081815260408083206001600160a01b038616845290915290205460ff166114c6575f818152602081815260408083206001600160a01b0395909516808452949091528120805460ff19166001179055339291907f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d9080a4600190565b50505f90565b5f818152602081815260408083206001600160a01b038616845290915290205460ff16156114c6575f818152602081815260408083206001600160a01b0395909516808452949091528120805460ff19169055339291907ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9080a4600190565b60ff6003541661155857565b63d93c066560e01b5f5260045ffd5b307f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316148061165a575b156115c2577f000000000000000000000000000000000000000000000000000000000000000090565b60405160208101907f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f82527f000000000000000000000000000000000000000000000000000000000000000060408201527f000000000000000000000000000000000000000000000000000000000000000060608201524660808201523060a082015260a0815261165460c08261123d565b51902090565b507f00000000000000000000000000000000000000000000000000000000000000004614611599565b60ff81146116c95760ff811690601f82116116ba57604051916116a760408461123d565b6020808452838101919036833783525290565b632cd44ac360e21b5f5260045ffd5b506040515f6001548060011c91600182169182156117a2575b60208410831461178e57838552849290811561176f5750600114611710575b61170d9250038261123d565b90565b5060015f90815290917fb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf65b81831061175357505090602061170d92820101611701565b602091935080600191548385880101520191019091839261173b565b6020925061170d94915060ff191682840152151560051b820101611701565b634e487b7160e01b5f52602260045260245ffd5b92607f16926116e2565b60ff81146117d05760ff811690601f82116116ba57604051916116a760408461123d565b506040515f6002548060011c9160018216918215611872575b60208410831461178e57838552849290811561176f57506001146118135761170d9250038261123d565b5060025f90815290917f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace5b81831061185657505090602061170d92820101611701565b602091935080600191548385880101520191019091839261183e565b92607f16926117e9565b81519190604183036118ac576118a59250602082015190606060408401519301515f1a9061192a565b9192909190565b50505f9160029190565b600481101561191657806118c8575050565b600181036118df5763f645eedf60e01b5f5260045ffd5b600281036118fa575063fce698f760e01b5f5260045260245ffd5b6003146119045750565b6335e2f38360e21b5f5260045260245ffd5b634e487b7160e01b5f52602160045260245ffd5b91907f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a084116119a1579160209360809260ff5f9560405194855216868401526040830152606082015282805260015afa15610916575f516001600160a01b0381161561199757905f905f90565b505f906001905f90565b5050505f916003919056fea264697066735822122033f6216069d4433211df7058a3da06e72959859c15377a9e9a8f11bdb3589c6464736f6c634300081a00332f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0df7c9542c591017a21c74b6f3fab6263c7952fc0aaf9db4c22a2a04ddc7f8674fd8fddc8ec489904ab4437d22f3538e8355961ec91a08e899b37466a5c958b565ad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5' as const
