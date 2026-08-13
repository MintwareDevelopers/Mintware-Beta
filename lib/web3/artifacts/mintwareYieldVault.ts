// AUTO-EXTRACTED from contracts-v4/src/payments/MintwareYieldVault.sol via forge out (do not edit by hand).
// YPN v1 single-asset USDC vault over an IYieldAdapter. Constructor: (usdc, adapter, owner).
export const YIELD_VAULT_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "usdc_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "adapter_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "VIRTUAL",
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
    "name": "adapter",
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
    "name": "burnForPayment",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "sharesToBurn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "assetsRedeemed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "convertToAssets",
    "inputs": [
      {
        "name": "shares_",
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
    "name": "deposit",
    "inputs": [
      {
        "name": "assets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
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
    "name": "gateway",
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
    "name": "idleBuffer",
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
    "name": "previewDeposit",
    "inputs": [
      {
        "name": "assets",
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
    "name": "previewWithdraw",
    "inputs": [
      {
        "name": "assets",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "shares_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "redeem",
    "inputs": [
      {
        "name": "sharesToBurn",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "assetsOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "setGateway",
    "inputs": [
      {
        "name": "gateway_",
        "type": "address",
        "internalType": "address"
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
    "name": "totalAssets",
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
    "name": "totalShares",
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
    "type": "event",
    "name": "Deposit",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
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
        "name": "sharesMinted",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "GatewaySet",
    "inputs": [
      {
        "name": "gateway",
        "type": "address",
        "indexed": true,
        "internalType": "address"
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
    "name": "PaymentBurn",
    "inputs": [
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
        "name": "sharesBurned",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "assetsRedeemed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Redeem",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sharesBurned",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "assets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
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
    "name": "GatewayAlreadySet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientIdleLiquidity",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientShares",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyGateway",
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
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const

export const YIELD_VAULT_BYTECODE = '0x60c03461019957601f61146e38819003918201601f19168301916001600160401b0383118484101761019d5780849260609460405283398101031261019957610047816101b1565b90610054602082016101b1565b906001600160a01b039061006a906040016101b1565b16918215610186575f80546001600160a01b031981168517825560405194916001600160a01b03909116907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09080a360017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00556001600160a01b031680158015610175575b610166576080526001600160a01b031660a0526112a890816101c68239608051818181610236015281816103dd01528181610613015281816108f701528181610b1201528181610d000152610e72015260a05181818161075d015281816109f801528181610abd01528181610cab0152610f5a0152f35b63d92e233d60e01b5f5260045ffd5b506001600160a01b038216156100ef565b631e4fbdf760e01b5f525f60045260245ffd5b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036101995756fe60806040526004361015610011575f80fd5b5f3560e01c806301e1d11414610a2757806303eadcfc146109e357806307a2d13a146109c55780630a28a4771461096b578063116191b6146109435780633a98ef39146109265780633e413bee146108e25780633f4ba83a146108765780635c975abb14610852578063671d3e001461073f5780636e553f65146105c4578063715018a61461056d5780638456cb591461050d5780638cf552c6146104f15780638da5cb5b146104ca57806390646b4a14610443578063a66c9578146102fa578063ce7c2ac2146102c2578063db006a75146101b7578063ef8b30f7146101895763f2fde38b14610100575f80fd5b3461018557602036600319011261018557610119610a41565b610121610c20565b6001600160a01b03168015610172575f80546001600160a01b03198116831782556001600160a01b0316907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09080a3005b631e4fbdf760e01b5f525f60045260245ffd5b5f80fd5b346101855760203660031901126101855760206101af6101a7610aa9565b600435610bf9565b604051908152f35b34610185576020366003190112610185576004356101d3610c46565b6101db610c7e565b335f52600260205260405f205481156102b3578082116102a4578161020b81610205602095610bbf565b93610bec565b335f526002845260405f205561022381600354610bec565b60035561022f82610e5d565b61025a82337f0000000000000000000000000000000000000000000000000000000000000000610ffd565b60405190815281838201527fe5b754fb1abb7f01b499791d0b820ae3b6af3424ac1c59768edb53f4ec31a92960403392a260015f8051602061125383398151915255604051908152f35b633999656760e01b5f5260045ffd5b631f2a200560e01b5f5260045ffd5b34610185576020366003190112610185576001600160a01b036102e3610a41565b165f526002602052602060405f2054604051908152f35b3461018557606036600319011261018557610313610a41565b60443590602435906001600160a01b03831690818403610185576001546001600160a01b0316330361043457610347610c46565b61034f610c7e565b8115610425576001600160a01b03165f8181526002602052604090205483156102b3578084116102a4576040846104017f8fb4a203549a6f7bf4133985e18cbb4508eaf0532999f153bf48042fd4986658936020986103b86103b085610bbf565b998a93610bec565b875f5260028b52855f20556103cf84600354610bec565b6003556103db82610e5d565b7f0000000000000000000000000000000000000000000000000000000000000000610ffd565b81519081528587820152a360015f8051602061125383398151915255604051908152f35b63d92e233d60e01b5f5260045ffd5b63ec76af1360e01b5f5260045ffd5b346101855760203660031901126101855761045c610a41565b610464610c20565b600154906001600160a01b0382166104bb576001600160a01b0316908115610425576001600160a01b03191681176001557f5317fa585931182194fed99f2ea5f2efd38af9cff9724273704c8501c521e34b5f80a2005b633c3a86d560e01b5f5260045ffd5b34610185575f366003190112610185575f546040516001600160a01b039091168152602090f35b34610185575f3660031901126101855760206040516103e88152f35b34610185575f36600319011261018557610525610c20565b61052d610c7e565b5f805460ff60a01b1916600160a01b1790556040513381527f62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a25890602090a1005b34610185575f36600319011261018557610585610c20565b5f80546001600160a01b0319811682556001600160a01b03167f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08280a3005b34610185576040366003190112610185576004356024356001600160a01b03811690819003610185576105f5610c46565b6105fd610c7e565b81156102b357801561042557610611610aa9565b7f00000000000000000000000000000000000000000000000000000000000000006040516323b872dd60e01b5f5233600452306024528460445260205f60648180865af19060015f511482161561071e575b6040525f606052156106fe575061067a9083610bf9565b9081156102b357602092815f526002845260405f2061069a848254610a9c565b90556106a883600354610a9c565b6003556106b481610c9b565b60405190815282848201527fdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d760403392a360015f8051602061125383398151915255604051908152f35b635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b90600181151661073657823b15153d15161690610663565b503d5f823e3d90fd5b34610185575f366003190112610185576040516278744560e21b81527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316602082600481845afa918215610812575f9261081d575b509060206004926040519384809263d3c3962f60e01b82525afa8015610812575f906107df575b60209250808210156107d85750604051908152f35b90506101af565b506020823d60201161080a575b816107f960209383610a57565b8101031261018557602091516107c3565b3d91506107ec565b6040513d5f823e3d90fd5b91506020823d60201161084a575b8161083860209383610a57565b8101031261018557905190602061079c565b3d915061082b565b34610185575f36600319011261018557602060ff5f5460a01c166040519015158152f35b34610185575f3660031901126101855761088e610c20565b5f5460ff8160a01c16156108d35760ff60a01b19165f556040513381527f5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa90602090a1005b638dfc202b60e01b5f5260045ffd5b34610185575f366003190112610185576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610185575f366003190112610185576020600354604051908152f35b34610185575f366003190112610185576001546040516001600160a01b039091168152602090f35b3461018557602036600319011261018557610984610aa9565b600354906103e882018092116109b1576103e881018091116109b15760016101af91602093600435611055565b634e487b7160e01b5f52601160045260245ffd5b346101855760203660031901126101855760206101af600435610bbf565b34610185575f366003190112610185576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610185575f3660031901126101855760206101af610aa9565b600435906001600160a01b038216820361018557565b90601f8019910116810190811067ffffffffffffffff821117610a7957604052565b634e487b7160e01b5f52604160045260245ffd5b90816020910312610185575190565b919082018092116109b157565b6040516278744560e21b81526020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610812575f91610b8d575b506040516370a0823160e01b8152306004820152906020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610812575f91610b57575b610b549250610a9c565b90565b90506020823d602011610b85575b81610b7260209383610a57565b8101031261018557610b54915190610b4a565b3d9150610b65565b90506020813d602011610bb7575b81610ba860209383610a57565b8101031261018557515f610af5565b3d9150610b9b565b610bc7610aa9565b600354906103e881018091116109b1576103e882018092116109b157610b54926110c7565b919082039182116109b157565b600354916103e883018093116109b1576103e881018091116109b157610b54925f92611055565b5f546001600160a01b03163303610c3357565b63118cdaa760e01b5f523360045260245ffd5b60025f805160206112538339815191525414610c6f5760025f8051602061125383398151915255565b633ee5aeb560e01b5f5260045ffd5b60ff5f5460a01c16610c8c57565b63d93c066560e01b5f5260045ffd5b6040516342bb207560e01b8152907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602083600481855afa8015610812575f935f91610e2b575b5080821015610e235750905b8115610d71577f000000000000000000000000000000000000000000000000000000000000000091610d2b818385611166565b15610de6575b813b15610185576040519063b6b55f2560e01b825260048201525f8160248183865af19081610dd1575b50610d7157610d6b838284611166565b15610d76575b505050565b610d8081836111b3565b15610db55782610d909183611217565b15610d99575050565b635274afe760e01b82526001600160a01b031660045260249150fd5b635274afe760e01b83526001600160a01b038216600452602483fd5b610dde9194505f90610a57565b5f925f610d5b565b610df082846111b3565b15610e0557610e00818385611217565b610d31575b635274afe760e01b5f9081526001600160a01b038416600452602490fd5b905090610cf8565b90506020813d602011610e55575b81610e4660209383610a57565b8101031261018557515f610cec565b3d9150610e39565b6040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa908115610812575f91610fcb575b50828110610f31575b506020602491604051928380926370a0823160e01b82523060048301525afa908115610812575f91610eff575b5010610ef057565b63267e966b60e11b5f5260045ffd5b90506020813d602011610f29575b81610f1a60209383610a57565b8101031261018557515f610ee8565b3d9150610f0d565b610f3b9083610bec565b604051632e1a7d4d60e01b81526004810191909152906020826024815f7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af190811561081257602492602092610f9e575b509150610ebb565b610fbd90833d8511610fc4575b610fb58183610a57565b810190610a8d565b505f610f96565b503d610fab565b90506020813d602011610ff5575b81610fe660209383610a57565b8101031261018557515f610eb2565b3d9150610fd9565b916040519163a9059cbb60e01b5f5260018060a01b031660045260245260205f60448180865af19060015f511482161561103d575b604052156106fe5750565b90600181151661073657823b15153d15161690611032565b92916110628183866110c7565b9260048110156110b3576001809116149182611088575b5050610b549250151590610a9c565b908092501561109f57610b54930915155f80611079565b634e487b7160e01b5f52601260045260245ffd5b634e487b7160e01b5f52602160045260245ffd5b90915f19838309928083029283808610950394808603951461115857848311156111405790829109815f0382168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b82634e487b715f52156003026011186020526024601cfd5b50508092501561109f570490565b92916040519163095ea7b360e01b5f5260018060a01b031660045260245260205f60448180875af19260015f51148416156111a2575b50604052565b3d15903b151516909216915f61119c565b60405163095ea7b360e01b5f9081526001600160a01b03909316600452602483905290929160209060448180875af19260015f51148416156111f55750604052565b6001849294151661120e573b15153d151616915f61119c565b833d5f823e3d90fd5b92916040519163095ea7b360e01b5f5260018060a01b031660045260245260205f60448180875af19260015f51148416156111f5575060405256fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a26469706673582212200eeee5d53327ef463b9b4f0d964b7985f26ba6d464e63ef8eaa9f7bf1cbd81fc64736f6c634300081a0033' as const
