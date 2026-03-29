// =============================================================================
// @mintware/eliza-plugin
//
// Mintware AI Attribution plugin for ElizaOS.
// Exposes three actions:
//   GET_ATTRIBUTION_SCORE    — look up any agent's on-chain reputation
//   REGISTER_MINTWARE        — register the agent wallet with Attribution
//   CLAIM_PENDING_ACTIONS    — submit pre-signed oracle attestations to the contract
//
// Contract (Base mainnet): 0xb9FB965Caa7197932b52631e0121Ea54586e2B88
// API base:                https://mintware.finance
// =============================================================================
import { elizaLogger, } from '@elizaos/core';
import { registerWithMintwareOracle, claimPendingActions, } from '@mintware/ai-attribution-sdk';
// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = 'https://mintware.finance';
const BASE_MAINNET_CONTRACT = '0xb9FB965Caa7197932b52631e0121Ea54586e2B88';
// ── Helper: extract Ethereum address from a message string ────────────────────
function extractAddress(text) {
    const match = text.match(/0x[0-9a-fA-F]{40}/);
    return match ? match[0].toLowerCase() : null;
}
// ── Helper: format a score response into a readable string ────────────────────
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
// Action 1 — GET_ATTRIBUTION_SCORE
// =============================================================================
const getAttributionScoreAction = {
    name: 'GET_ATTRIBUTION_SCORE',
    similes: [
        'check attribution score',
        'what\'s my score',
        'what is my score',
        'get reputation score for',
        'mintware score',
        'attribution score',
        'check my attribution',
        'look up score',
        'show reputation',
        'agent score',
        'get score',
        'my attribution',
        'score for',
    ],
    description: 'Fetches the Mintware AI Attribution score for an agent address. ' +
        'Pass an Ethereum address in the message, or omit it to look up the agent\'s own address. ' +
        'Returns total score, rank, behavior, contribution, interpretability, risk, transparent status, and PnL if available.',
    validate: async (_runtime, _message) => {
        // Read-only — no private key required
        return true;
    },
    handler: async (runtime, message, _state, _options, callback) => {
        elizaLogger.info('[mintware] GET_ATTRIBUTION_SCORE triggered');
        const text = message.content?.text ?? '';
        // Try to find an address in the message; fall back to the agent's own address
        let address = extractAddress(text);
        if (!address) {
            // Use the agent's configured wallet address if available
            const agentKey = runtime.getSetting('AGENT_PRIVATE_KEY');
            if (agentKey) {
                try {
                    // Derive address from private key using a lightweight approach
                    const { privateKeyToAccount } = await import('viem/accounts');
                    const account = privateKeyToAccount(agentKey);
                    address = account.address.toLowerCase();
                }
                catch (err) {
                    elizaLogger.warn('[mintware] Could not derive address from AGENT_PRIVATE_KEY:', err);
                }
            }
        }
        if (!address) {
            await callback({
                text: 'Please provide an Ethereum address to look up, e.g. "check attribution score for 0xabc..."',
            });
            return false;
        }
        elizaLogger.info(`[mintware] Fetching score for ${address}`);
        try {
            const res = await fetch(`${API_BASE}/api/agents/${address}`);
            if (res.status === 404) {
                await callback({
                    text: `No Attribution record found for ${address}. The agent may not be registered yet. Use REGISTER_MINTWARE to sign up.`,
                });
                return true;
            }
            if (!res.ok) {
                throw new Error(`API returned ${res.status}: ${res.statusText}`);
            }
            const data = (await res.json());
            const formatted = formatScoreResponse(data);
            elizaLogger.info(`[mintware] Score fetched — total: ${data.total_score}, rank: #${data.rank}`);
            await callback({ text: formatted });
            return true;
        }
        catch (err) {
            elizaLogger.error('[mintware] GET_ATTRIBUTION_SCORE error:', err);
            await callback({
                text: `Failed to fetch Attribution score: ${err instanceof Error ? err.message : String(err)}`,
            });
            return false;
        }
    },
    examples: [
        [
            {
                user: '{{user1}}',
                content: { text: 'Check my attribution score' },
            },
            {
                user: '{{agentName}}',
                content: {
                    text: 'Attribution Score for 0xabc1…ef12\n─────────────────────────────\nTotal Score: 320\nRank: #14\n\nScore Breakdown:\n  Behavior: 110\n  Contribution: 95\n  Interpretability: 80\n  Risk Penalty: 0\n\nTransparent Agent: Yes (MWP hash on-chain)',
                    action: 'GET_ATTRIBUTION_SCORE',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: { text: 'Get reputation score for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
            },
            {
                user: '{{agentName}}',
                content: {
                    text: 'Attribution Score for 0xd8dA…6045\n─────────────────────────────\nTotal Score: 0\nRank: unranked\n\nScore Breakdown:\n  Behavior: 0\n  Contribution: 0\n  Interpretability: 0\n  Risk Penalty: 0\n\nTransparent Agent: No',
                    action: 'GET_ATTRIBUTION_SCORE',
                },
            },
        ],
    ],
};
// =============================================================================
// Action 2 — REGISTER_MINTWARE
// =============================================================================
const registerMintwareAction = {
    name: 'REGISTER_MINTWARE',
    similes: [
        'register with mintware',
        'join mintware attribution',
        'sign up for attribution',
        'register on mintware',
        'enroll in mintware',
        'set up attribution',
        'start mintware attribution',
        'mintware registration',
        'register for reputation scoring',
        'get on mintware leaderboard',
    ],
    description: 'Registers the agent wallet with the Mintware AI Attribution contract on Base mainnet. ' +
        'Requires AGENT_PRIVATE_KEY to be set in the agent runtime settings. ' +
        'This is a one-time on-chain transaction — the agent pays gas. ' +
        'After registration the oracle watcher will begin tracking on-chain activity automatically.',
    validate: async (runtime, _message) => {
        const key = runtime.getSetting('AGENT_PRIVATE_KEY');
        if (!key) {
            elizaLogger.warn('[mintware] REGISTER_MINTWARE: AGENT_PRIVATE_KEY not set');
            return false;
        }
        return true;
    },
    handler: async (runtime, _message, _state, _options, callback) => {
        elizaLogger.info('[mintware] REGISTER_MINTWARE triggered');
        const privateKey = runtime.getSetting('AGENT_PRIVATE_KEY');
        if (!privateKey) {
            await callback({
                text: 'AGENT_PRIVATE_KEY is not configured. Please set it in your agent environment to enable on-chain registration.',
            });
            return false;
        }
        await callback({
            text: 'Registering with Mintware AI Attribution on Base mainnet. Submitting transaction — this may take 10–30 seconds…',
        });
        try {
            const { address, txHash } = await registerWithMintwareOracle({
                privateKey: privateKey,
                contractAddress: BASE_MAINNET_CONTRACT,
                apiBase: API_BASE,
            });
            const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;
            const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
            elizaLogger.info(`[mintware] Registration complete — address: ${address}, tx: ${txHash}`);
            await callback({
                text: [
                    `Registration successful.`,
                    ``,
                    `Address:  ${shortAddr}`,
                    `Tx Hash:  ${shortTx}`,
                    `Network:  Base mainnet`,
                    ``,
                    `The Mintware oracle watcher will start tracking your on-chain activity within ~60 seconds. Use "claim pending actions" periodically to submit oracle-signed attestations and keep your score up to date.`,
                ].join('\n'),
            });
            return true;
        }
        catch (err) {
            elizaLogger.error('[mintware] REGISTER_MINTWARE error:', err);
            const msg = err instanceof Error ? err.message : String(err);
            // Surface friendly message for already-registered agents
            if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
                await callback({
                    text: 'This agent address is already registered with Mintware Attribution. Use "claim pending actions" to submit any queued oracle attestations.',
                });
                return true;
            }
            await callback({
                text: `Registration failed: ${msg}`,
            });
            return false;
        }
    },
    examples: [
        [
            {
                user: '{{user1}}',
                content: { text: 'Register with Mintware' },
            },
            {
                user: '{{agentName}}',
                content: {
                    text: 'Registration successful.\n\nAddress:  0xabc1…ef12\nTx Hash:  0x1a2b3c4d5e…f6a7b8\nNetwork:  Base mainnet\n\nThe Mintware oracle watcher will start tracking your on-chain activity within ~60 seconds.',
                    action: 'REGISTER_MINTWARE',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: { text: 'Join Mintware attribution' },
            },
            {
                user: '{{agentName}}',
                content: {
                    text: 'Registering with Mintware AI Attribution on Base mainnet. Submitting transaction — this may take 10–30 seconds…',
                    action: 'REGISTER_MINTWARE',
                },
            },
        ],
    ],
};
// =============================================================================
// Action 3 — CLAIM_PENDING_ACTIONS
// =============================================================================
const claimPendingActionsAction = {
    name: 'CLAIM_PENDING_ACTIONS',
    similes: [
        'claim attribution rewards',
        'claim pending actions',
        'update my attribution score',
        'submit pending attestations',
        'claim my score',
        'update attribution',
        'flush pending actions',
        'claim oracle signatures',
        'record pending actions',
        'sync attribution score',
    ],
    description: 'Fetches pending oracle-signed action attestations from the Mintware API and submits each to the ' +
        'AIAttribution contract on Base mainnet. The agent pays gas; the oracle pays nothing. ' +
        'Requires AGENT_PRIVATE_KEY to be set. Run this periodically to keep the Attribution score current.',
    validate: async (runtime, _message) => {
        const key = runtime.getSetting('AGENT_PRIVATE_KEY');
        if (!key) {
            elizaLogger.warn('[mintware] CLAIM_PENDING_ACTIONS: AGENT_PRIVATE_KEY not set');
            return false;
        }
        return true;
    },
    handler: async (runtime, _message, _state, _options, callback) => {
        elizaLogger.info('[mintware] CLAIM_PENDING_ACTIONS triggered');
        const privateKey = runtime.getSetting('AGENT_PRIVATE_KEY');
        if (!privateKey) {
            await callback({
                text: 'AGENT_PRIVATE_KEY is not configured. Please set it in your agent environment to enable on-chain transactions.',
            });
            return false;
        }
        // Derive the agent address from the private key
        let agentAddress;
        try {
            const { privateKeyToAccount } = await import('viem/accounts');
            const account = privateKeyToAccount(privateKey);
            agentAddress = account.address;
        }
        catch (err) {
            elizaLogger.error('[mintware] Could not derive address from AGENT_PRIVATE_KEY:', err);
            await callback({
                text: 'Failed to derive wallet address from AGENT_PRIVATE_KEY. Please check the key is a valid 0x-prefixed hex private key.',
            });
            return false;
        }
        elizaLogger.info(`[mintware] Claiming pending actions for ${agentAddress}`);
        await callback({
            text: 'Checking for pending oracle attestations…',
        });
        try {
            const result = await claimPendingActions({
                agent: agentAddress,
                privateKey: privateKey,
                contractAddress: BASE_MAINNET_CONTRACT,
                apiBase: API_BASE,
            });
            if (result.submitted === 0) {
                elizaLogger.info('[mintware] No pending actions to claim');
                await callback({
                    text: 'No pending actions found. Your Attribution score is already up to date.',
                });
                return true;
            }
            elizaLogger.info(`[mintware] Submitted ${result.submitted} actions — hashes: ${result.hashes.join(', ')}`);
            const hashLines = result.hashes
                .map((h, i) => `  ${i + 1}. ${h.slice(0, 10)}…${h.slice(-6)}`)
                .join('\n');
            await callback({
                text: [
                    `Successfully submitted ${result.submitted} attribution action${result.submitted === 1 ? '' : 's'} on-chain.`,
                    ``,
                    `Transactions:`,
                    hashLines,
                    ``,
                    `Your Attribution score will update on the next oracle sync (~60 seconds).`,
                ].join('\n'),
            });
            return true;
        }
        catch (err) {
            elizaLogger.error('[mintware] CLAIM_PENDING_ACTIONS error:', err);
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.toLowerCase().includes('not registered') || msg.toLowerCase().includes('not found')) {
                await callback({
                    text: 'This agent is not yet registered with Mintware Attribution. Use "register with Mintware" first.',
                });
                return false;
            }
            await callback({
                text: `Failed to claim pending actions: ${msg}`,
            });
            return false;
        }
    },
    examples: [
        [
            {
                user: '{{user1}}',
                content: { text: 'Claim pending actions' },
            },
            {
                user: '{{agentName}}',
                content: {
                    text: 'Successfully submitted 3 attribution actions on-chain.\n\nTransactions:\n  1. 0x1a2b3c4d5e…f6a7b8\n  2. 0x9b8c7d6e5f…a1b2c3\n  3. 0x3d4e5f6a7b…c8d9e0\n\nYour Attribution score will update on the next oracle sync (~60 seconds).',
                    action: 'CLAIM_PENDING_ACTIONS',
                },
            },
        ],
        [
            {
                user: '{{user1}}',
                content: { text: 'Update my attribution score' },
            },
            {
                user: '{{agentName}}',
                content: {
                    text: 'No pending actions found. Your Attribution score is already up to date.',
                    action: 'CLAIM_PENDING_ACTIONS',
                },
            },
        ],
    ],
};
// =============================================================================
// Plugin export
// =============================================================================
const mintwarePlugin = {
    name: 'mintware-attribution',
    description: 'Mintware AI Attribution — on-chain reputation scoring for AI agents on Base',
    actions: [getAttributionScoreAction, registerMintwareAction, claimPendingActionsAction],
    evaluators: [],
    providers: [],
};
export default mintwarePlugin;
export { mintwarePlugin, getAttributionScoreAction, registerMintwareAction, claimPendingActionsAction };
