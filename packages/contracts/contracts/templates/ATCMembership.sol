// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ATCTemplateBase} from "./ATCTemplateBase.sol";

/// @title ATCMembership
/// @notice Membership passes (ERC-721) with optional price and expiry. Use for token-gated access.
/// @dev Gate access with `hasPass(user)` (checks expiry) or `isValid(tokenId)`.
contract ATCMembership is ERC2771ContextUpgradeable, ERC721EnumerableUpgradeable, ATCTemplateBase {
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
    event BaseURISet(string baseURI);
    /// @dev ERC-4906: tells marketplaces to refresh metadata.
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

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
        __ERC721Enumerable_init();
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
        _takeNativeFee(msg.value); // remainder stays here until the owner withdraws
        id = _issue(_msgSender());
    }

    /// @notice Owner issues a pass to anyone, e.g. after an off-chain payment.
    function adminMint(address to) external onlyOwner returns (uint256) {
        return _issue(to);
    }

    /// @notice Extend a pass. Anyone may pay to renew any pass (e.g. as a gift).
    function renew(uint256 tokenId) external payable nonReentrant {
        _requireOwned(tokenId); // reverts if the pass doesn't exist
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

    function setBaseURI(string calldata b) external onlyOwner {
        _base = b;
        emit BaseURISet(b);
        if (totalMinted > 0) emit BatchMetadataUpdate(1, totalMinted);
    }

    function isValid(uint256 tokenId) public view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        uint64 e = expiresAt[tokenId];
        return e == 0 || e > block.timestamp;
    }

    /// @notice True if `user` holds at least one pass that has not expired.
    function hasPass(address user) external view returns (bool) {
        uint256 n = balanceOf(user);
        for (uint256 i; i < n; ++i) {
            if (isValid(tokenOfOwnerByIndex(user, i))) return true;
        }
        return false;
    }

    /// @notice Latest expiry across all of `user`'s passes. 0 = none held; type(uint64).max = never expires.
    function validUntil(address user) external view returns (uint64 best) {
        uint256 n = balanceOf(user);
        for (uint256 i; i < n; ++i) {
            uint64 e = expiresAt[tokenOfOwnerByIndex(user, i)];
            if (e == 0) return type(uint64).max;
            if (e > best) best = e;
        }
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

    // --- ERC-4906 ---
    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721EnumerableUpgradeable) returns (bool)
    {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId); // ERC-4906
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
