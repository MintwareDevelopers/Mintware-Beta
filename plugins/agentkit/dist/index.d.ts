import { z } from 'zod';
declare const API_BASE = "https://mintware.finance";
declare const BASE_MAINNET_CONTRACT: "0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421";
declare const mintwareGetScoreAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        address: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address?: string | undefined;
    }, {
        address?: string | undefined;
    }>;
    invoke: (walletProvider: {
        getAddress(): string;
    }, args: {
        address?: string;
    }) => Promise<string>;
};
declare const mintwareRegisterAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    invoke: (walletProvider: {
        getAddress(): string;
    }, _args: Record<string, never>) => Promise<string>;
};
declare const mintwareClaimPendingAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    invoke: (walletProvider: {
        getAddress(): string;
    }, _args: Record<string, never>) => Promise<string>;
};
/** Minimal wallet surface the x402 + parking actions need. `signTypedData` (x402 pay) and `sendTransaction`
 *  (park) are present on EVM AgentKit providers. */
interface X402Wallet {
    getAddress(): string;
    signTypedData?(params: {
        domain: unknown;
        types: unknown;
        primaryType: string;
        message: unknown;
    }): Promise<string>;
    sendTransaction?(tx: {
        to: string;
        data: string;
        value?: string;
    }): Promise<string>;
}
declare const mintwareX402QuoteAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
    }, {
        url: string;
    }>;
    invoke: (_wallet: X402Wallet, args: {
        url: string;
    }) => Promise<string>;
};
declare const mintwareX402PayAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        url: z.ZodString;
        maxAmountUsd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        maxAmountUsd?: number | undefined;
    }, {
        url: string;
        maxAmountUsd?: number | undefined;
    }>;
    invoke: (wallet: X402Wallet, args: {
        url: string;
        maxAmountUsd?: number;
    }) => Promise<string>;
};
declare const mintwareParkAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        amountUsd: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        amountUsd: number;
    }, {
        amountUsd: number;
    }>;
    invoke: (wallet: X402Wallet, args: {
        amountUsd: number;
    }) => Promise<string>;
};
declare const mintwareUnparkAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        amountUsd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        amountUsd?: number | undefined;
    }, {
        amountUsd?: number | undefined;
    }>;
    invoke: (wallet: X402Wallet, args: {
        amountUsd?: number;
    }) => Promise<string>;
};
declare const mintwareTreasuryAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        address: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address?: string | undefined;
    }, {
        address?: string | undefined;
    }>;
    invoke: (wallet: X402Wallet, args: {
        address?: string;
    }) => Promise<string>;
};
declare const mintwareVaultListAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        status: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status?: string | undefined;
    }, {
        status?: string | undefined;
    }>;
    invoke: (_wallet: unknown, args: {
        status?: string;
    }) => Promise<string>;
};
declare const mintwareYieldsAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    invoke: () => Promise<string>;
};
declare const mintwarePoolsAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    invoke: () => Promise<string>;
};
declare const mintwareSwapQuoteAction: {
    name: string;
    description: string;
    schema: z.ZodObject<{
        chainId: z.ZodNumber;
        sellToken: z.ZodString;
        buyToken: z.ZodString;
        sellAmount: z.ZodString;
        taker: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        chainId: number;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        taker: string;
    }, {
        chainId: number;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        taker: string;
    }>;
    invoke: (_wallet: unknown, args: {
        chainId: number;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        taker: string;
    }) => Promise<string>;
};
export declare const mintwareActions: ({
    name: string;
    description: string;
    schema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    invoke: (walletProvider: {
        getAddress(): string;
    }, _args: Record<string, never>) => Promise<string>;
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
    }, {
        url: string;
    }>;
    invoke: (_wallet: X402Wallet, args: {
        url: string;
    }) => Promise<string>;
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{
        url: z.ZodString;
        maxAmountUsd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        maxAmountUsd?: number | undefined;
    }, {
        url: string;
        maxAmountUsd?: number | undefined;
    }>;
    invoke: (wallet: X402Wallet, args: {
        url: string;
        maxAmountUsd?: number;
    }) => Promise<string>;
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{
        amountUsd: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        amountUsd: number;
    }, {
        amountUsd: number;
    }>;
    invoke: (wallet: X402Wallet, args: {
        amountUsd: number;
    }) => Promise<string>;
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{
        amountUsd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        amountUsd?: number | undefined;
    }, {
        amountUsd?: number | undefined;
    }>;
    invoke: (wallet: X402Wallet, args: {
        amountUsd?: number;
    }) => Promise<string>;
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{
        address: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address?: string | undefined;
    }, {
        address?: string | undefined;
    }>;
    invoke: (wallet: X402Wallet, args: {
        address?: string;
    }) => Promise<string>;
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{
        status: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status?: string | undefined;
    }, {
        status?: string | undefined;
    }>;
    invoke: (_wallet: unknown, args: {
        status?: string;
    }) => Promise<string>;
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{
        chainId: z.ZodNumber;
        sellToken: z.ZodString;
        buyToken: z.ZodString;
        sellAmount: z.ZodString;
        taker: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        chainId: number;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        taker: string;
    }, {
        chainId: number;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        taker: string;
    }>;
    invoke: (_wallet: unknown, args: {
        chainId: number;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        taker: string;
    }) => Promise<string>;
})[];
export { mintwareGetScoreAction, mintwareRegisterAction, mintwareClaimPendingAction, mintwareParkAction, mintwareUnparkAction, mintwareTreasuryAction, mintwareX402QuoteAction, mintwareX402PayAction, mintwareVaultListAction, mintwareYieldsAction, mintwarePoolsAction, mintwareSwapQuoteAction, BASE_MAINNET_CONTRACT, API_BASE, };
