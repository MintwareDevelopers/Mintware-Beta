export declare const CONTRACT_ADDRESSES: {
    readonly baseSepolia: `0x${string}`;
    readonly base: `0x${string}`;
};
export declare const DEFAULT_RPC: {
    readonly baseSepolia: "https://sepolia.base.org";
    readonly base: "https://mainnet.base.org";
};
export declare const DEFAULT_CONTRACT: `0x${string}`;
export declare const DEFAULT_RPC_URL: "https://mainnet.base.org";
export declare const AI_ATTRIBUTION_ABI: readonly [{
    readonly name: "registerAgent";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
}, {
    readonly name: "linkErc8004";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "submitMwpHash";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "mwpHash";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "recordVerifiedAction";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
    }, {
        readonly name: "volumeContributed";
        readonly type: "uint256";
    }, {
        readonly name: "mwpContextHash";
        readonly type: "bytes32";
    }, {
        readonly name: "campaignId";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "deadline";
        readonly type: "uint256";
    }, {
        readonly name: "signature";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "nonces";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "createVolumeCampaign";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "targetVolume";
        readonly type: "uint256";
    }, {
        readonly name: "duration";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "campaignId";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getScore";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "total";
        readonly type: "uint256";
    }, {
        readonly name: "behavior";
        readonly type: "uint128";
    }, {
        readonly name: "contribution";
        readonly type: "uint128";
    }, {
        readonly name: "risk";
        readonly type: "uint64";
    }, {
        readonly name: "interpretability";
        readonly type: "uint64";
    }, {
        readonly name: "isTransparent";
        readonly type: "bool";
    }, {
        readonly name: "lastMwpHash";
        readonly type: "bytes32";
    }, {
        readonly name: "erc8004TokenId";
        readonly type: "uint256";
    }];
}, {
    readonly name: "registered";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "getAgentCampaignVolume";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "campaignId";
        readonly type: "uint256";
    }, {
        readonly name: "agent";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "isAgentTransparent";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "AgentRegistered";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "erc8004TokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }];
}, {
    readonly name: "ActionRecorded";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "campaignId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "volumeContributed";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "mwpHash";
        readonly type: "bytes32";
        readonly indexed: false;
    }, {
        readonly name: "newScore";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "MwpHashSubmitted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "mwpHash";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "submissionCount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "Erc8004Linked";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agent";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }];
}];
//# sourceMappingURL=constants.d.ts.map