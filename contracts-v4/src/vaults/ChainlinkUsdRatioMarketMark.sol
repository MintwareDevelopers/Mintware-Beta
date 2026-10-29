// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMarketAssetMark} from "./IMarketAssetMark.sol";

/// @notice Minimal AggregatorV3-compatible read surface used by the market mark adapter.
interface IAggregatorV3MarketFeed {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Derives a quote-token/asset mark from approved asset/USD and quote/USD feeds.
/// @dev This adapter normalizes feed units; it does not prove feed identity, USD denomination,
///      market-hours suitability, provider quality, or RWA redemption value. Those are admission
///      and operating-policy checks. `IMarketAssetMark`'s consumer applies the configured age bound.
contract ChainlinkUsdRatioMarketMark is IMarketAssetMark {
    uint256 private constant WAD = 1e18;
    uint8 private constant MAX_FEED_DECIMALS = 18;

    address public immutable override asset;
    address public immutable override quoteAsset;
    IAggregatorV3MarketFeed public immutable assetUsdFeed;
    IAggregatorV3MarketFeed public immutable quoteUsdFeed;
    IAggregatorV3MarketFeed public immutable sequencerUptimeFeed;
    uint8 public immutable assetFeedDecimals;
    uint8 public immutable quoteFeedDecimals;
    uint64 public immutable sequencerGracePeriod;

    error InvalidAssetPair();
    error InvalidFeed(address feed);
    error UnsupportedFeedDecimals(address feed, uint8 decimals);
    error InvalidFeedRound(address feed);
    error InvalidFeedAnswer(address feed);
    error InvalidFeedTimestamp(address feed);
    error FutureFeedTimestamp(address feed);
    error InvalidSequencerConfiguration();
    error InvalidSequencerRound();
    error SequencerDown();
    error InvalidSequencerTimestamp();
    error FutureSequencerTimestamp();
    error SequencerGracePeriodNotOver();
    error MarkOutOfRange();

    constructor(
        address asset_,
        address quoteAsset_,
        address assetUsdFeed_,
        address quoteUsdFeed_,
        address sequencerUptimeFeed_,
        uint64 sequencerGracePeriod_
    ) {
        if (asset_ == address(0) || quoteAsset_ == address(0) || asset_ == quoteAsset_) {
            revert InvalidAssetPair();
        }
        if (
            (sequencerUptimeFeed_ == address(0) && sequencerGracePeriod_ != 0)
                || (sequencerUptimeFeed_ != address(0)
                    && (sequencerUptimeFeed_.code.length == 0 || sequencerGracePeriod_ == 0))
        ) revert InvalidSequencerConfiguration();
        uint8 assetDecimals = _feedDecimals(assetUsdFeed_);
        uint8 quoteDecimals = _feedDecimals(quoteUsdFeed_);

        asset = asset_;
        quoteAsset = quoteAsset_;
        assetUsdFeed = IAggregatorV3MarketFeed(assetUsdFeed_);
        quoteUsdFeed = IAggregatorV3MarketFeed(quoteUsdFeed_);
        sequencerUptimeFeed = IAggregatorV3MarketFeed(sequencerUptimeFeed_);
        assetFeedDecimals = assetDecimals;
        quoteFeedDecimals = quoteDecimals;
        sequencerGracePeriod = sequencerGracePeriod_;
    }

    /// @inheritdoc IMarketAssetMark
    /// @dev Feed answers are USD per whole token. Dividing the normalized asset/USD answer by
    ///      quote/USD yields quote tokens per whole asset token. The oldest source timestamp keeps
    ///      a fresh feed from concealing the staleness of the other feed. When configured, the
    ///      sequencer feed is checked before either price feed is read.
    function latestMark() external view override returns (uint256 priceWad, uint64 updatedAt) {
        _requireSequencerAvailable();
        (uint256 assetAnswer, uint256 assetUpdatedAt) = _latestPositiveAnswer(assetUsdFeed);
        (uint256 quoteAnswer, uint256 quoteUpdatedAt) = _latestPositiveAnswer(quoteUsdFeed);

        uint256 assetUsdWad = Math.mulDiv(assetAnswer, WAD, 10 ** assetFeedDecimals);
        uint256 quoteUsdWad = Math.mulDiv(quoteAnswer, WAD, 10 ** quoteFeedDecimals);
        if (quoteUsdWad == 0) revert InvalidFeedAnswer(address(quoteUsdFeed));

        priceWad = Math.mulDiv(assetUsdWad, WAD, quoteUsdWad);
        if (priceWad == 0) revert InvalidFeedAnswer(address(assetUsdFeed));

        uint256 oldestUpdatedAt = assetUpdatedAt < quoteUpdatedAt ? assetUpdatedAt : quoteUpdatedAt;
        if (oldestUpdatedAt > type(uint64).max) revert MarkOutOfRange();
        updatedAt = uint64(oldestUpdatedAt);
    }

    function _requireSequencerAvailable() private view {
        if (address(sequencerUptimeFeed) == address(0)) return;

        (uint80 roundId, int256 answer, uint256 startedAt,,) = sequencerUptimeFeed.latestRoundData();
        if (roundId == 0) revert InvalidSequencerRound();
        // Chainlink uptime feeds report 0 when up and 1 when down.
        if (answer != 0) revert SequencerDown();
        if (startedAt == 0) revert InvalidSequencerTimestamp();
        if (startedAt > block.timestamp) revert FutureSequencerTimestamp();
        if (block.timestamp - startedAt <= sequencerGracePeriod) revert SequencerGracePeriodNotOver();
    }

    function _feedDecimals(address feed) private view returns (uint8 decimals_) {
        if (feed == address(0) || feed.code.length == 0) revert InvalidFeed(feed);
        decimals_ = IAggregatorV3MarketFeed(feed).decimals();
        if (decimals_ > MAX_FEED_DECIMALS) revert UnsupportedFeedDecimals(feed, decimals_);
    }

    function _latestPositiveAnswer(IAggregatorV3MarketFeed feed)
        private
        view
        returns (uint256 answer, uint256 updatedAt)
    {
        (uint80 roundId, int256 signedAnswer,, uint256 sourceUpdatedAt,) = feed.latestRoundData();
        if (roundId == 0) revert InvalidFeedRound(address(feed));
        if (signedAnswer <= 0) revert InvalidFeedAnswer(address(feed));
        if (sourceUpdatedAt == 0) revert InvalidFeedTimestamp(address(feed));
        if (sourceUpdatedAt > block.timestamp) revert FutureFeedTimestamp(address(feed));
        return (uint256(signedAnswer), sourceUpdatedAt);
    }
}
