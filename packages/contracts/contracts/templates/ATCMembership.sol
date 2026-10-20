// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ATCTemplateBase} from "./ATCTemplateBase.sol";

/// @title ATCMembership
/// @notice Membership passes (ERC-721) with optional price and expiry. Use for token-gated access.
contract ATCMembership is ERC2771ContextUpgradeable, ERC721Upgradeable, ATCTemplateBase {
    bytes32 public constant KIND = keccak256("MEMBERSHIP");

    string private _base;
    uint256 public price;        // in wei; 0 = free (gasless friendly)
    uint64 public duration;      // seconds; 0 = never expires
    uint256 public maxSupply;    // 0 = unlimited
    uint256 public totalMinted;
    mapping(uint256 => uint64) public expiresAt;

    event PassMinted(address indexed to, uint256 indexed tokenId, uint64 expiresAt);
    event PassRenewed(uint256 indexed tokenId, uint64 expiresAt);
    event TermsUpdated(uint256 price, uint64 duration);

    error SoldOut();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address forwarder) ERC2771ContextUpgradeable(forwarder) {
        _disableInitializers();
    }

    /// @param config abi.encode(string name, string symbol, string baseURI, uint256 price, uint64 duration, uint256 maxSupply)
    function initialize(address owner_, address factory_, bytes calldata config) external initializer {
        (string memory n, string memory s, string memory b, uint256 p, uint64 d, uint256 m) =
            abi.decode(config, (string, string, string, uint256, uint64, uint256));
        __ERC721_init(n, s);
        __ATCTemplateBase_init(owner_, factory_);
        _base = b;
        price = p;
        duration = d;
        maxSupply = m;
    }

    function templateKind() external pure returns (bytes32) { return KIND; }

    /// @notice Buy (or claim, if free) a pass for the caller.
    function mint() external payable nonReentrant returns (uint256 id) {
        if (msg.value != price) revert WrongPayment(price, msg.value);
        _takeNativeFee(msg.value);
        id = _issue(_msgSender());
    }

    /// @notice Owner issues a pass to anyone, e.g. after an off-chain payment.
    function adminMint(address to) external onlyOwner returns (uint256) {
        return _issue(to);
    }

    function renew(uint256 tokenId) external payable nonReentrant {
        _requireOwned(tokenId);
        if (msg.value != price) revert WrongPayment(price, msg.value);
        _takeNativeFee(msg.value);
        uint64 start = expiresAt[tokenId] > block.timestamp ? expiresAt[tokenId] : uint64(block.timestamp);
        uint64 next = duration == 0 ? 0 : start + duration;
        expiresAt[tokenId] = next;
        emit PassRenewed(tokenId, next);
    }

    function setTerms(uint256 price_, uint64 duration_) external onlyOwner {
        price = price_;
        duration = duration_;
        emit TermsUpdated(price_, duration_);
    }

    function setBaseURI(string calldata b) external onlyOwner { _base = b; }

    function isValid(uint256 tokenId) public view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        uint64 e = expiresAt[tokenId];
        return e == 0 || e > block.timestamp;
    }

    /// @notice True if `user` holds at least one pass. Expiry is checked per token with isValid().
    function hasPass(address user) external view returns (bool) {
        return balanceOf(user) > 0;
    }

    function _issue(address to) internal returns (uint256 id) {
        if (maxSupply != 0 && totalMinted >= maxSupply) revert SoldOut();
        id = ++totalMinted;
        uint64 e = duration == 0 ? 0 : uint64(block.timestamp) + duration;
        expiresAt[id] = e;
        _safeMint(to, id);
        emit PassMinted(to, id, e);
    }

    function _baseURI() internal view override returns (string memory) { return _base; }

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
