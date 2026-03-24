// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  AIAttribution
/// @notice Mintware trust + attribution layer for AI agents.
///         ERC-8004 native — permissionless at launch, registry-enforced when ecosystem matures.
///         Primary key: agent wallet address. ERC-8004 tokenId is an optional linked field.
///
/// Three-groupings placement: Web3 (on-chain scoring) + Rewards (campaign participation)
///
/// @dev    AgentScore packs into 3 storage slots:
///           slot 0: behavior(128) + contribution(128)
///           slot 1: risk(64) + interpretability(64) + mwpSubmissions(32) + lastUpdated(32) + isTransparent(8) [+padding]
///           slot 2: lastMwpHash(256)

// ── ERC-8004: AI Agent Identity & Reputation Registry ────────────────────────
// https://eips.ethereum.org/EIPS/eip-8004
interface IERC8004Registry {
    function ownerOf(uint256 tokenId)     external view returns (address);
    function isRegistered(uint256 tokenId) external view returns (bool);
    function getAgentMetadata(uint256 tokenId) external view returns (
        string memory name,
        string memory model,
        address       controller,
        bool          active
    );
}

contract AIAttribution is Ownable2Step, ReentrancyGuard {

    // ── ERC-8004 integration ──────────────────────────────────────────────────

    IERC8004Registry public erc8004Registry;
    bool             public requireErc8004;  // false at launch, owner can flip on

    mapping(address => uint256) public agentTokenId;    // 0 = not linked
    mapping(uint256 => address) public tokenIdToAgent;  // reverse lookup

    // ── Agent scoring ─────────────────────────────────────────────────────────

    struct AgentScore {
        uint128 behavior;          // verified swap volume, scaled ÷ 1e18
        uint128 contribution;      // referral / campaign quality points
        uint64  risk;              // penalty accumulator (subtracted from total)
        uint64  interpretability;  // MWP transparency bonus — hard cap 500
        uint32  mwpSubmissions;    // unique MWP hashes submitted
        uint32  lastUpdated;       // unix timestamp (uint32 safe until 2106)
        bool    isTransparent;     // true once any MWP hash submitted
        bytes32 lastMwpHash;
    }

    mapping(address => AgentScore) public agentScores;
    mapping(address => bool)       public registered;

    // ── Oracle ────────────────────────────────────────────────────────────────

    address public oracle;

    modifier onlyOracle() {
        require(msg.sender == oracle, "AIAttribution: not oracle");
        _;
    }

    // ── Campaigns ─────────────────────────────────────────────────────────────

    struct VolumeCampaign {
        address protocol;
        string  name;
        uint256 targetVolume;
        uint256 startTime;
        uint256 endTime;
        bool    active;
    }

    mapping(uint256 => VolumeCampaign)                    public campaigns;
    mapping(uint256 => mapping(address => uint256))       public campaignVolume;
    uint256 public campaignCount;

    // ── Events ────────────────────────────────────────────────────────────────

    event AgentRegistered  (address indexed agent, uint256 indexed erc8004TokenId);
    event Erc8004Linked    (address indexed agent, uint256 indexed tokenId);
    event ActionRecorded   (
        address indexed agent,
        uint256 indexed campaignId,
        uint256 volumeContributed,
        bytes32 mwpHash,
        uint256 newScore
    );
    event MwpHashSubmitted (address indexed agent, bytes32 indexed mwpHash, uint256 submissionCount);
    event RiskPenaltyApplied(address indexed agent, uint64 penalty, string reason);
    event CampaignCreated  (uint256 indexed campaignId, address indexed protocol, string name);
    event OracleUpdated    (address indexed previous, address indexed next);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _oracle) Ownable(msg.sender) {
        require(_oracle != address(0), "AIAttribution: zero oracle");
        oracle = _oracle;
        emit OracleUpdated(address(0), _oracle);
    }

    // ── ERC-8004 management ───────────────────────────────────────────────────

    /// @notice Owner sets the ERC-8004 registry. Leave zero address to remain permissionless.
    function setErc8004Registry(address registry, bool _require) external onlyOwner {
        erc8004Registry = IERC8004Registry(registry);
        requireErc8004  = _require;
    }

    /// @notice Agent links their wallet address to their ERC-8004 tokenId.
    ///         Registry ownership check ensures only the token owner can link.
    function linkErc8004(uint256 tokenId) external {
        require(address(erc8004Registry) != address(0), "AIAttribution: no registry");
        require(erc8004Registry.ownerOf(tokenId) == msg.sender, "AIAttribution: not token owner");
        require(tokenIdToAgent[tokenId] == address(0), "AIAttribution: tokenId already linked");

        agentTokenId[msg.sender]  = tokenId;
        tokenIdToAgent[tokenId]   = msg.sender;
        emit Erc8004Linked(msg.sender, tokenId);
    }

    // ── Registration ──────────────────────────────────────────────────────────

    function registerAgent() external {
        if (requireErc8004) {
            require(agentTokenId[msg.sender] != 0, "AIAttribution: link ERC-8004 first");
            require(
                erc8004Registry.isRegistered(agentTokenId[msg.sender]),
                "AIAttribution: not in ERC-8004 registry"
            );
        }
        registered[msg.sender] = true;
        emit AgentRegistered(msg.sender, agentTokenId[msg.sender]);
    }

    // ── Oracle-gated action recording ─────────────────────────────────────────

    /// @notice Oracle records a verified on-chain action for an agent.
    ///         Only oracle can call — prevents self-awarding.
    function recordVerifiedAction(
        address agent,
        uint256 volumeContributed,
        bytes32 mwpContextHash,
        uint256 campaignId
    ) external onlyOracle nonReentrant {
        require(registered[agent], "AIAttribution: agent not registered");

        AgentScore storage s = agentScores[agent];
        s.behavior    += uint128(volumeContributed / 1e18);
        s.lastUpdated  = uint32(block.timestamp);

        if (campaignId != 0) {
            require(campaigns[campaignId].active, "AIAttribution: campaign not active");
            require(block.timestamp <= campaigns[campaignId].endTime, "AIAttribution: campaign ended");
            campaignVolume[campaignId][agent] += volumeContributed;
        }

        if (mwpContextHash != bytes32(0) && mwpContextHash != s.lastMwpHash) {
            uint64 remaining = 500 - (s.interpretability > 500 ? 500 : s.interpretability);
            uint64 bonus     = remaining >= 50 ? 50 : remaining;
            s.interpretability += bonus;
            s.mwpSubmissions   += 1;
            s.isTransparent     = true;
            s.lastMwpHash       = mwpContextHash;
            emit MwpHashSubmitted(agent, mwpContextHash, s.mwpSubmissions);
        }

        uint256 total = _calculateTotal(s);
        emit ActionRecorded(agent, campaignId, volumeContributed, mwpContextHash, total);
    }

    /// @notice Oracle applies a risk penalty to an agent's score.
    function applyRiskPenalty(
        address agent,
        uint64  penalty,
        string calldata reason
    ) external onlyOracle {
        require(registered[agent], "AIAttribution: agent not registered");
        agentScores[agent].risk += penalty;
        emit RiskPenaltyApplied(agent, penalty, reason);
    }

    // ── Permissionless MWP hash submission ───────────────────────────────────

    /// @notice Any registered agent can submit a MWP folder snapshot hash.
    ///         Earns the Transparent Agent badge. Bonus capped at 500 total.
    function submitMwpHash(bytes32 mwpHash) external nonReentrant {
        require(registered[msg.sender], "AIAttribution: not registered");
        require(mwpHash != bytes32(0),  "AIAttribution: empty hash");

        AgentScore storage s = agentScores[msg.sender];
        require(mwpHash != s.lastMwpHash, "AIAttribution: hash already submitted");

        uint64 remaining = 500 - (s.interpretability > 500 ? 500 : s.interpretability);
        uint64 bonus     = remaining >= 50 ? 50 : remaining;
        s.interpretability += bonus;
        s.mwpSubmissions   += 1;
        s.isTransparent     = true;
        s.lastMwpHash       = mwpHash;

        emit MwpHashSubmitted(msg.sender, mwpHash, s.mwpSubmissions);
    }

    // ── Volume campaigns ──────────────────────────────────────────────────────

    /// @notice Any address can create an Agent Volume Campaign.
    function createVolumeCampaign(
        string calldata name,
        uint256         targetVolume,
        uint256         duration
    ) external returns (uint256 campaignId) {
        require(bytes(name).length > 0,  "AIAttribution: empty name");
        require(targetVolume > 0,        "AIAttribution: zero target");
        require(duration > 0,            "AIAttribution: zero duration");

        campaignId = ++campaignCount;
        campaigns[campaignId] = VolumeCampaign({
            protocol:     msg.sender,
            name:         name,
            targetVolume: targetVolume,
            startTime:    block.timestamp,
            endTime:      block.timestamp + duration,
            active:       true
        });
        emit CampaignCreated(campaignId, msg.sender, name);
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// @notice Full score breakdown for the leaderboard and profile UI.
    function getScore(address agent) external view returns (
        uint256 total,
        uint128 behavior,
        uint128 contribution,
        uint64  risk,
        uint64  interpretability,
        bool    isTransparent,
        bytes32 lastMwpHash,
        uint256 erc8004TokenId
    ) {
        AgentScore storage s = agentScores[agent];
        return (
            _calculateTotal(s),
            s.behavior,
            s.contribution,
            s.risk,
            s.interpretability,
            s.isTransparent,
            s.lastMwpHash,
            agentTokenId[agent]
        );
    }

    function getAgentCampaignVolume(uint256 campaignId, address agent)
        external view returns (uint256)
    {
        return campaignVolume[campaignId][agent];
    }

    /// @notice Fetch ERC-8004 metadata for a linked agent (requires registry set).
    function getErc8004Metadata(address agent) external view returns (
        string memory name,
        string memory model,
        address       controller,
        bool          active
    ) {
        require(address(erc8004Registry) != address(0), "AIAttribution: no registry");
        uint256 tokenId = agentTokenId[agent];
        require(tokenId != 0, "AIAttribution: not ERC-8004 linked");
        return erc8004Registry.getAgentMetadata(tokenId);
    }

    function isAgentTransparent(address agent) external view returns (bool) {
        return agentScores[agent].isTransparent;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "AIAttribution: zero oracle");
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _calculateTotal(AgentScore storage s) internal view returns (uint256) {
        uint256 positive = uint256(s.behavior) + uint256(s.contribution) + uint256(s.interpretability);
        uint256 penalty  = uint256(s.risk);
        return positive > penalty ? positive - penalty : 0;
    }
}
