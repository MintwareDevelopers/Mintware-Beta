import { type Action, type Plugin } from '@elizaos/core';
declare const getAttributionScoreAction: Action;
declare const registerMintwareAction: Action;
declare const claimPendingActionsAction: Action;
declare const mintwarePlugin: Plugin;
export default mintwarePlugin;
export { mintwarePlugin, getAttributionScoreAction, registerMintwareAction, claimPendingActionsAction };
