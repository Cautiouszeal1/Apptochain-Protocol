// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ATCTemplateBase} from "./ATCTemplateBase.sol";

/// @title ATCRewards
/// @notice Loyalty points users keep. Awarded by the app, redeemed by burning.
///         Non-transferable by default so points cannot be farmed and dumped.
contract ATCRewards is ERC2771ContextUpgradeable, ERC20Upgradeable, ATCTemplateBase {
    bytes32 public constant KIND = keccak256("REWARDS");

    bool public transferable;
    mapping(address => bool) public isAwarder;

    event AwarderSet(address indexed who, bool allowed);
    event Awarded(address indexed to, uint256 amount, bytes32 indexed reason);
    event Redeemed(address indexed by, uint256 amount, bytes32 indexed rewardId);

    error NotAwarder();
    error NonTransferable();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address forwarder) ERC2771ContextUpgradeable(forwarder) {
        _disableInitializers();
    }

    /// @param config abi.encode(string name, string symbol, bool transferable)
    function initialize(address owner_, address factory_, bytes calldata config) external initializer {
        (string memory n, string memory s, bool t) = abi.decode(config, (string, string, bool));
        __ERC20_init(n, s);
        __ATCTemplateBase_init(owner_, factory_);
        transferable = t;
        isAwarder[owner_] = true;
        emit AwarderSet(owner_, true);
    }

    function templateKind() external pure returns (bytes32) { return KIND; }

    function setAwarder(address who, bool allowed) external onlyOwner {
        isAwarder[who] = allowed;
        emit AwarderSet(who, allowed);
    }

    function award(address to, uint256 amount, bytes32 reason) external {
        if (!isAwarder[_msgSender()]) revert NotAwarder();
        _mint(to, amount);
        emit Awarded(to, amount, reason);
    }

    /// @notice Burn points to claim a reward. The app watches Redeemed events to fulfil.
    function redeem(uint256 amount, bytes32 rewardId) external {
        _burn(_msgSender(), amount);
        emit Redeemed(_msgSender(), amount, rewardId);
    }

    function decimals() public pure override returns (uint8) { return 0; }

    function _update(address from, address to, uint256 value) internal override {
        if (!transferable && from != address(0) && to != address(0)) revert NonTransferable();
        super._update(from, to, value);
    }

    // --- ERC-2771 context resolution ---
    function _msgSender() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address) {
        return ERC2771ContextUpgradeable._msgSender();
    }
    function _msgData() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return ERC2771ContextUpgradeable._msgData();
    }
    function _contextSuffixLength() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (uint256) {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }
}
