import { z } from 'zod';
declare const API_BASE = "https://mintware.finance";
declare const BASE_MAINNET_CONTRACT: "0xb9FB965Caa7197932b52631e0121Ea54586e2B88";
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
export declare const mintwareActions: ({
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
} | {
    name: string;
    description: string;
    schema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    invoke: (walletProvider: {
        getAddress(): string;
    }, _args: Record<string, never>) => Promise<string>;
})[];
export { mintwareGetScoreAction, mintwareRegisterAction, mintwareClaimPendingAction, BASE_MAINNET_CONTRACT, API_BASE, };
