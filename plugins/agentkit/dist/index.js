// =============================================================================
// @mintwarehq/agentkit-actions
//
// Coinbase AgentKit actions for Mintware AI Attribution.
// Exposes three actions:
//   MINTWARE_GET_SCORE      — look up any agent's on-chain reputation score
//   MINTWARE_REGISTER       — register the agent wallet with Attribution
//   MINTWARE_CLAIM_PENDING  — submit oracle-signed attestations to the contract
//
// Contract (Base mainnet): 0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421
// API base:                https://mintware.finance
// =============================================================================
import { z } from 'zod';
import { registerWithMintwareOracle, claimPendingActions, } from '@mintwarehq/ai-attribution-sdk';
// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = 'https://mintware.finance';
const BASE_MAINNET_CONTRACT = '0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421';
// ── Helper: format score response into a readable string ──────────────────────
function formatScoreResponse(data) {
    const addr = data.address;
    const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    const transparent = data.is_transparent ? 'Yes (MWP hash on-chain)' : 'No';
    let out = `Attribution Score for ${short}\n`;
    out += `─────────────────────────────\n`;
    out += `Total Score:      ${data.total_score ?? 0}\n`;
    out += `Rank:             #${data.rank ?? 'unranked'}\n`;
    out += `\n`;
    out += `Score Breakdown:\n`;
    out += `  Behavior:         ${data.behavior ?? 0}\n`;
    out += `  Contribution:     ${data.contribution ?? 0}\n`;
    out += `  Interpretability: ${data.interpretability ?? 0}\n`;
    out += `  Risk Penalty:     ${data.risk ?? 0}\n`;
    out += `\n`;
    out += `Transparent Agent: ${transparent}\n`;
    if (data.pnl && data.pnl.total_pnl_usd != null) {
        const sign = data.pnl.total_pnl_usd >= 0 ? '+' : '';
        out += `PnL (all-time):    ${sign}$${data.pnl.total_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
        if (data.pnl.realized_pnl_usd != null) {
            const rs = data.pnl.realized_pnl_usd >= 0 ? '+' : '';
            out += `  Realized:        ${rs}$${data.pnl.realized_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
        }
        if (data.pnl.unrealized_pnl_usd != null) {
            const us = data.pnl.unrealized_pnl_usd >= 0 ? '+' : '';
            out += `  Unrealized:      ${us}$${data.pnl.unrealized_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
        }
    }
    return out.trim();
}
// =============================================================================
// Action 1 — MINTWARE_GET_SCORE
// =============================================================================
const mintwareGetScoreAction = {
    name: 'MINTWARE_GET_SCORE',
    description: 'Fetches the Mintware AI Attribution score for an agent address. ' +
        'If no address is provided, looks up the agent\'s own address via walletProvider. ' +
        'Returns total score, rank, behavior, contribution, interpretability, risk, transparent status, and PnL.',
    schema: z.object({
        address: z.string().optional().describe('Ethereum address to look up. Omit to fetch the score for the agent\'s own wallet address.'),
    }),
    invoke: async (walletProvider, args) => {
        const address = (args.address ?? walletProvider.getAddress()).toLowerCase();
        const res = await fetch(`${API_BASE}/api/agents/${address}`);
        if (res.status === 404) {
            return (`No Attribution record found for ${address}. ` +
                `The agent may not be registered yet. Use MINTWARE_REGISTER to sign up.`);
        }
        if (!res.ok) {
            throw new Error(`Mintware API returned ${res.status}: ${res.statusText}`);
        }
        const data = (await res.json());
        return formatScoreResponse(data);
    },
};
// =============================================================================
// Action 2 — MINTWARE_REGISTER
// =============================================================================
const mintwareRegisterAction = {
    name: 'MINTWARE_REGISTER',
    description: 'Registers the agent wallet with the Mintware AI Attribution contract on Base mainnet. ' +
        'Reads the private key from the AGENT_PRIVATE_KEY environment variable. ' +
        'This is a one-time on-chain transaction — the agent pays gas. ' +
        'After registration the oracle watcher begins tracking on-chain activity automatically.',
    schema: z.object({}),
    invoke: async (walletProvider, _args) => {
        const privateKey = process.env.AGENT_PRIVATE_KEY;
        if (!privateKey) {
            throw new Error('AGENT_PRIVATE_KEY environment variable is not set. ' +
                'Set it to the 0x-prefixed hex private key of the agent wallet before using MINTWARE_REGISTER.');
        }
        const { address, txHash } = await registerWithMintwareOracle({
            privateKey: privateKey,
            contractAddress: BASE_MAINNET_CONTRACT,
            apiBase: API_BASE,
        });
        const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;
        const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
        return [
            `Registration successful.`,
            ``,
            `Address:  ${shortAddr}`,
            `Tx Hash:  ${shortTx}`,
            `Network:  Base mainnet`,
            ``,
            `The Mintware oracle watcher will start tracking on-chain activity within ~60 seconds. ` +
                `Use MINTWARE_CLAIM_PENDING periodically to submit oracle-signed attestations and keep the score current.`,
        ].join('\n');
    },
};
// =============================================================================
// Action 3 — MINTWARE_CLAIM_PENDING
// =============================================================================
const mintwareClaimPendingAction = {
    name: 'MINTWARE_CLAIM_PENDING',
    description: 'Fetches pending oracle-signed action attestations from the Mintware API and submits each to the ' +
        'AIAttribution contract on Base mainnet. The agent pays gas. ' +
        'Reads the private key from AGENT_PRIVATE_KEY. ' +
        'Run periodically to keep the Attribution score current.',
    schema: z.object({}),
    invoke: async (walletProvider, _args) => {
        const privateKey = process.env.AGENT_PRIVATE_KEY;
        if (!privateKey) {
            throw new Error('AGENT_PRIVATE_KEY environment variable is not set. ' +
                'Set it to the 0x-prefixed hex private key of the agent wallet before using MINTWARE_CLAIM_PENDING.');
        }
        const agent = walletProvider.getAddress();
        const result = await claimPendingActions({
            agent,
            privateKey: privateKey,
            contractAddress: BASE_MAINNET_CONTRACT,
            apiBase: API_BASE,
        });
        if (result.submitted === 0) {
            return 'No pending actions found. The Attribution score is already up to date.';
        }
        const hashLines = result.hashes
            .map((h, i) => `  ${i + 1}. ${h.slice(0, 10)}…${h.slice(-6)}`)
            .join('\n');
        return [
            `Successfully submitted ${result.submitted} attribution action${result.submitted === 1 ? '' : 's'} on-chain.`,
            ``,
            `Transactions:`,
            hashLines,
            ``,
            `The Attribution score will update on the next oracle sync (~60 seconds).`,
        ].join('\n');
    },
};
// =============================================================================
// x402 — pay for compute per call (spec: docs/developers/agentkit-compute-402-spec.md)
// =============================================================================
// Base64 helpers (Node + edge).
function b64decode(s) {
    return typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : atob(s);
}
function b64encode(s) {
    return typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(s);
}
/** EIP-712 domain for USDC `transferWithAuthorization` (EIP-3009), per x402 network. */
const USDC_DOMAIN = {
    base: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    'base-sepolia': { name: 'USDC', version: '2', chainId: 84532, verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
};
const EIP3009_TYPES = {
    TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
    ],
};
function pad32(hexOrAddr) {
    return hexOrAddr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}
function padUint(n) {
    return n.toString(16).padStart(64, '0');
}
function randomNonce32() {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes); // Web Crypto — global in Node 18+ and browsers
    return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
/** Fetch a resource; if it is 402, return the first advertised requirements (else null = free/served). */
async function readX402Challenge(url) {
    const res = await fetch(url);
    if (res.status !== 402)
        return { res, reqs: null };
    const header = res.headers.get('payment-required') ?? res.headers.get('PAYMENT-REQUIRED');
    const raw = header ? b64decode(header) : await res.clone().text();
    const parsed = JSON.parse(raw);
    const reqs = parsed.accepts?.[0] ?? null;
    return { res, reqs };
}
const mintwareX402QuoteAction = {
    name: 'MINTWARE_X402_QUOTE',
    description: 'Preflight an x402-gated compute/API URL WITHOUT paying. Returns the price (USDC), network, recipient, ' +
        'and description advertised in the 402 challenge, so the agent can decide whether to pay.',
    schema: z.object({
        url: z.string().url().describe('The x402-protected resource URL to quote.'),
    }),
    invoke: async (_wallet, args) => {
        const { res, reqs } = await readX402Challenge(args.url);
        if (!reqs)
            return `No payment required (HTTP ${res.status}). The resource is free or already served.`;
        const usdc = (Number(reqs.maxAmountRequired) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 });
        return [
            `x402 quote for ${reqs.resource}`,
            `  Price:    up to $${usdc} USDC`,
            `  Network:  ${reqs.network}`,
            `  Pay to:   ${reqs.payTo}`,
            `  Scheme:   ${reqs.scheme}`,
            reqs.description ? `  About:    ${reqs.description}` : '',
        ].filter(Boolean).join('\n');
    },
};
const mintwareX402PayAction = {
    name: 'MINTWARE_X402_PAY',
    description: 'Pay for an x402-gated compute/API call from the agent wallet in USDC and return the resource. ' +
        'Reads the 402 challenge, enforces the optional maxAmountUsd cap, signs an EIP-3009 authorization, ' +
        'retries with the payment, and returns the resource body. Use MINTWARE_X402_QUOTE first to preview cost.',
    schema: z.object({
        url: z.string().url().describe('The x402-protected resource URL to pay for and fetch.'),
        maxAmountUsd: z.number().optional().describe('Hard cap on what to pay, in USD. Aborts if the price exceeds it.'),
    }),
    invoke: async (wallet, args) => {
        const { res, reqs } = await readX402Challenge(args.url);
        if (!reqs)
            return await res.text(); // already free/served
        const priceUsd = Number(reqs.maxAmountRequired) / 1e6;
        if (args.maxAmountUsd != null && priceUsd > args.maxAmountUsd) {
            return `Aborted: price $${priceUsd} exceeds your cap $${args.maxAmountUsd}. Nothing paid.`;
        }
        const domain = USDC_DOMAIN[reqs.network];
        if (!domain)
            return `Aborted: network "${reqs.network}" not supported for payment by this action.`;
        if (!wallet.signTypedData) {
            throw new Error('This wallet provider cannot signTypedData — required to authorize an x402 (EIP-3009) payment.');
        }
        const now = Math.floor(Date.now() / 1000);
        const authorization = {
            from: wallet.getAddress(),
            to: reqs.payTo,
            value: reqs.maxAmountRequired,
            validAfter: String(now - 60),
            validBefore: String(now + (reqs.maxTimeoutSeconds ?? 300)),
            nonce: randomNonce32(),
        };
        const signature = await wallet.signTypedData({
            domain,
            types: EIP3009_TYPES,
            primaryType: 'TransferWithAuthorization',
            message: authorization,
        });
        const paymentPayload = { x402Version: 2, scheme: reqs.scheme, network: reqs.network, payload: { signature, authorization } };
        const header = b64encode(JSON.stringify(paymentPayload));
        const paid = await fetch(args.url, { headers: { 'PAYMENT-SIGNATURE': header } });
        if (paid.status === 402)
            return `Payment rejected by the resource (still 402). Nothing was served; check funds/score.`;
        if (!paid.ok)
            throw new Error(`Resource returned ${paid.status} after payment: ${paid.statusText}`);
        const body = await paid.text();
        return `Paid $${priceUsd} USDC on ${reqs.network}. Resource:\n\n${body}`;
    },
};
// Arc parking vault + USDC (env-overridable). Defaults = the live Arc-testnet YPN yield stack.
const PARK_VAULT = () => process.env.MINTWARE_PARK_VAULT ?? '0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421';
const PARK_USDC = () => process.env.MINTWARE_PARK_USDC ?? '0x3600000000000000000000000000000000000000';
const PARK_RPC = () => process.env.MINTWARE_PARK_RPC ?? 'https://rpc.testnet.arc.io';
const APPROVE_SEL = '0x095ea7b3'; //  approve(address,uint256)
const DEPOSIT_SEL = '0x6e553f65'; //  deposit(uint256,address)  (ERC-4626)
const REDEEM_SEL = '0xdb006a75'; //  redeem(uint256)  (burns caller's shares → USDC to caller)
const PREVIEW_WITHDRAW_SEL = '0x0a28a477'; //  previewWithdraw(uint256)  → shares needed
const SHARES_SEL = '0xce7c2ac2'; //  shares(address)
async function arcEthCall(to, data) {
    const res = await fetch(PARK_RPC(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    const j = (await res.json());
    return j.result && j.result !== '0x' ? BigInt(j.result) : 0n;
}
const mintwareParkAction = {
    name: 'MINTWARE_PARK',
    description: 'Park USDC into the Mintware yield vault so it earns while staying spendable in place (it never locks). ' +
        'Deposits `amountUsd` USDC from the agent wallet: approves the vault, then deposits. On-chain — the ' +
        'agent pays gas. After parking, spend it per call with MINTWARE_X402_PAY and check it with MINTWARE_TREASURY.',
    schema: z.object({
        amountUsd: z.number().positive().describe('Amount of USDC to park (e.g. 25 = $25).'),
    }),
    invoke: async (wallet, args) => {
        if (!wallet.sendTransaction) {
            throw new Error('This wallet provider cannot sendTransaction — required to park capital into the vault.');
        }
        const vault = PARK_VAULT();
        const usdc = PARK_USDC();
        const agent = wallet.getAddress();
        const amount = BigInt(Math.round(args.amountUsd * 1000000)); // USDC 6dp
        if (amount <= 0n)
            return 'Nothing to park (amount rounds to zero).';
        // 1) approve the vault to pull `amount` USDC.
        const approveTx = await wallet.sendTransaction({ to: usdc, data: APPROVE_SEL + pad32(vault) + padUint(amount) });
        // 2) deposit(assets, receiver=agent) → mints vault shares to the agent.
        const depositTx = await wallet.sendTransaction({ to: vault, data: DEPOSIT_SEL + padUint(amount) + pad32(agent) });
        return [
            `Parked $${args.amountUsd} USDC into the Mintware yield vault.`,
            `  approve: ${approveTx}`,
            `  deposit: ${depositTx}`,
            `It's now earning yield and stays fully spendable in place — spend per call with MINTWARE_X402_PAY.`,
        ].join('\n');
    },
};
const mintwareUnparkAction = {
    name: 'MINTWARE_UNPARK',
    description: 'Un-park USDC from the Mintware yield vault back to the agent wallet by redeeming vault shares. Omit ' +
        'amountUsd to un-park everything. Capital is always yours — parking never locks. On-chain (agent pays gas).',
    schema: z.object({
        amountUsd: z.number().positive().optional().describe('USDC to un-park (e.g. 10 = $10). Omit to un-park all.'),
    }),
    invoke: async (wallet, args) => {
        if (!wallet.sendTransaction) {
            throw new Error('This wallet provider cannot sendTransaction — required to un-park from the vault.');
        }
        const vault = PARK_VAULT();
        const agent = wallet.getAddress();
        const balShares = await arcEthCall(vault, SHARES_SEL + pad32(agent));
        if (balShares === 0n)
            return 'Nothing parked to un-park.';
        let sharesToBurn = balShares; // default: un-park all
        if (args.amountUsd != null) {
            const amount = BigInt(Math.round(args.amountUsd * 1000000));
            const need = await arcEthCall(vault, PREVIEW_WITHDRAW_SEL + padUint(amount)); // shares to net `amount`
            sharesToBurn = need < balShares ? need : balShares;
        }
        if (sharesToBurn === 0n)
            return 'Nothing to un-park (amount rounds to zero).';
        const tx = await wallet.sendTransaction({ to: vault, data: REDEEM_SEL + padUint(sharesToBurn) });
        const which = args.amountUsd != null ? `$${args.amountUsd}` : 'all parked USDC';
        return `Un-parked ${which} — redeemed ${sharesToBurn} shares. redeem tx: ${tx}. USDC is back in the agent wallet.`;
    },
};
const mintwareTreasuryAction = {
    name: 'MINTWARE_TREASURY',
    description: "Show the agent's Mintware capital-parking account: how much USDC is parked (and earning yield) and " +
        'how much is spendable in place right now. Parking does not lock — the full parked balance stays ' +
        'spendable per call via x402. Omit address to use the agent\'s own wallet.',
    schema: z.object({
        address: z.string().optional().describe("Address to inspect. Omit for the agent's own wallet."),
    }),
    invoke: async (wallet, args) => {
        const address = (args.address ?? wallet.getAddress()).toLowerCase();
        const res = await fetch(`${API_BASE}/api/x402/account?address=${address}`);
        if (!res.ok)
            throw new Error(`Mintware account API returned ${res.status}: ${res.statusText}`);
        const t = (await res.json());
        const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
        return [
            `Mintware parking account for ${short} (${t.network ?? 'arc'})`,
            `  Parked (earning): $${t.parkedUsdcFormatted ?? '0'} USDC`,
            `  Spendable now:    $${t.spendableUsdcFormatted ?? '0'} USDC`,
            t.earning
                ? `  Status: earning yield, fully spendable in place — spend per call via MINTWARE_X402_PAY.`
                : `  Status: empty — deposit USDC into the vault to start earning while staying spendable.`,
        ].join('\n');
    },
};
// =============================================================================
// Read tools — verified against the live route handlers (GET/POST, no-auth)
// =============================================================================
const mintwareVaultListAction = {
    name: 'MINTWARE_VAULT_LIST',
    description: 'Lists Mintware liquidity vaults (dual-sided reputation-adjacent DeFi on Uniswap V4) with each vault\'s ' +
        'current epoch. Optional status filter. NOTE: vaults are in testing on Base Sepolia — read-only, not for real deposits yet.',
    schema: z.object({ status: z.string().optional().describe("Optional filter, e.g. 'active'.") }),
    invoke: async (_wallet, args) => {
        const url = args.status ? `${API_BASE}/api/vaults?status=${encodeURIComponent(args.status)}` : `${API_BASE}/api/vaults`;
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Mintware API returned ${res.status}: ${res.statusText}`);
        return JSON.stringify(await res.json(), null, 2);
    },
};
const mintwareYieldsAction = {
    name: 'MINTWARE_YIELDS',
    description: 'Live yield benchmarks — a curated set of real DeFi pools (base APY, from DefiLlama) Mintware references. ' +
        'Use when comparing where idle capital could earn.',
    schema: z.object({}),
    invoke: async () => {
        const res = await fetch(`${API_BASE}/api/benchmarks/yields`);
        if (!res.ok)
            throw new Error(`Mintware API returned ${res.status}: ${res.statusText}`);
        return JSON.stringify(await res.json(), null, 2);
    },
};
const mintwarePoolsAction = {
    name: 'MINTWARE_POOLS',
    description: "Mintware's liquidity manifest for solver/aggregator networks (UniswapX, CoW, 1inch).",
    schema: z.object({}),
    invoke: async () => {
        const res = await fetch(`${API_BASE}/api/pools`);
        if (!res.ok)
            throw new Error(`Mintware API returned ${res.status}: ${res.statusText}`);
        return JSON.stringify(await res.json(), null, 2);
    },
};
const mintwareSwapQuoteAction = {
    name: 'MINTWARE_SWAP_QUOTE',
    description: 'Get an executable swap quote via Mintware\'s LI.FI proxy. Returns the raw quote INCLUDING the ' +
        'transactionRequest (to, data, value) — the AGENT signs + broadcasts it with its own key. This action ' +
        'does NOT sign or move funds. Amounts are raw token units; taker is the agent\'s own address.',
    schema: z.object({
        chainId: z.number().describe('EVM chain id (e.g. 8453 for Base).'),
        sellToken: z.string().describe('Token address being sold (0x…).'),
        buyToken: z.string().describe('Token address being bought (0x…).'),
        sellAmount: z.string().describe('Amount to sell, in raw token units (atomic/wei).'),
        taker: z.string().describe("The agent's own wallet address."),
    }),
    invoke: async (_wallet, args) => {
        const res = await fetch(`${API_BASE}/api/swap/quote`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => res.statusText);
            return `Quote failed (${res.status}): ${t.slice(0, 300)}`;
        }
        return 'Executable swap quote — sign + broadcast the transactionRequest with your own key:\n\n' + JSON.stringify(await res.json(), null, 2);
    },
};
// =============================================================================
// Exports
// =============================================================================
export const mintwareActions = [
    mintwareGetScoreAction,
    mintwareRegisterAction,
    mintwareClaimPendingAction,
    mintwareParkAction,
    mintwareUnparkAction,
    mintwareTreasuryAction,
    mintwareX402QuoteAction,
    mintwareX402PayAction,
    mintwareVaultListAction,
    mintwareYieldsAction,
    mintwarePoolsAction,
    mintwareSwapQuoteAction,
];
export { mintwareGetScoreAction, mintwareRegisterAction, mintwareClaimPendingAction, mintwareParkAction, mintwareUnparkAction, mintwareTreasuryAction, mintwareX402QuoteAction, mintwareX402PayAction, mintwareVaultListAction, mintwareYieldsAction, mintwarePoolsAction, mintwareSwapQuoteAction, BASE_MAINNET_CONTRACT, API_BASE, };
