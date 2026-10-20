// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC1155Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ATCTemplateBase} from "./ATCTemplateBase.sol";

/// @title ATCAssets
/// @notice Digital items users truly own (ERC-1155): game items, tickets, collectibles.
contract ATCAssets is ERC2771ContextUpgradeable, ERC1155Upgradeable, ATCTemplateBase {
    bytes32 public constant KIND = keccak256("ASSETS");

    struct Item {
        bool exists;
        uint256 price;      // wei per unit; 0 = free claim
        uint256 maxSupply;  // 0 = unlimited
        uint256 minted;
    }

    string public name;
    uint256 public itemCount;
    mapping(uint256 => Item) public items;

    event ItemCreated(uint256 indexed id, uint256 price, uint256 maxSupply);
    event ItemPriceSet(uint256 indexed id, uint256 price);

    error UnknownItem(uint256 id);
    error ExceedsSupply(uint256 id);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address forwarder) ERC2771ContextUpgradeable(forwarder) {
        _disableInitializers();
    }

    /// @param config abi.encode(string name, string uri)  — uri may contain {id}
    function initialize(address owner_, address factory_, bytes calldata config) external initializer {
        (string memory n, string memory u) = abi.decode(config, (string, string));
        __ERC1155_init(u);
        __ATCTemplateBase_init(owner_, factory_);
        name = n;
    }

    function templateKind() external pure returns (bytes32) { return KIND; }

    function createItem(uint256 price_, uint256 maxSupply_) external onlyOwner returns (uint256 id) {
        id = ++itemCount;
        items[id] = Item(true, price_, maxSupply_, 0);
        emit ItemCreated(id, price_, maxSupply_);
    }

    function setItemPrice(uint256 id, uint256 price_) external onlyOwner {
        if (!items[id].exists) revert UnknownItem(id);
        items[id].price = price_;
        emit ItemPriceSet(id, price_);
    }

    /// @notice Buy or claim `amount` units of item `id` for the caller.
    function mint(uint256 id, uint256 amount) external payable nonReentrant {
        Item storage it = items[id];
        if (!it.exists) revert UnknownItem(id);
        uint256 due = it.price * amount;
        if (msg.value != due) revert WrongPayment(due, msg.value);
        _takeNativeFee(msg.value);
        _issue(_msgSender(), id, amount);
    }

    function adminMint(address to, uint256 id, uint256 amount) external onlyOwner {
        if (!items[id].exists) revert UnknownItem(id);
        _issue(to, id, amount);
    }

    function setURI(string calldata u) external onlyOwner { _setURI(u); }

    function _issue(address to, uint256 id, uint256 amount) internal {
        Item storage it = items[id];
        if (it.maxSupply != 0 && it.minted + amount > it.maxSupply) revert ExceedsSupply(id);
        it.minted += amount;
        _mint(to, id, amount, "");
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
