// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IATCFactory} from "../interfaces/IATCFactory.sol";
import {ATCTemplateBase} from "./ATCTemplateBase.sol";

/// @title ATCPayments
/// @notice In-app checkout settled on-chain. Each order id can be paid once.
///         The protocol fee goes to the treasury, the rest straight to the merchant payee.
///         ERC-20 payments (e.g. USDC) work gasless: the buyer approves once, then signs.
contract ATCPayments is ERC2771ContextUpgradeable, ATCTemplateBase {
    using SafeERC20 for IERC20;

    bytes32 public constant KIND = keccak256("PAYMENTS");

    address payable public payee;
    mapping(address => bool) public acceptedToken;
    mapping(bytes32 => bool) public paid;

    event Paid(bytes32 indexed orderId, address indexed payer, address indexed token, uint256 amount, uint256 fee);
    event PayeeSet(address payee);
    event TokenAccepted(address token, bool accepted);

    error AlreadyPaid(bytes32 orderId);
    error TokenNotAccepted(address token);
    error ZeroAmount();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address forwarder) ERC2771ContextUpgradeable(forwarder) {
        _disableInitializers();
    }

    /// @param config abi.encode(address payee, address[] acceptedTokens)
    function initialize(address owner_, address factory_, bytes calldata config) external initializer {
        (address p, address[] memory tokens) = abi.decode(config, (address, address[]));
        __ATCTemplateBase_init(owner_, factory_);
        if (p == address(0)) revert ZeroAddress();
        payee = payable(p);
        for (uint256 i; i < tokens.length; ++i) {
            acceptedToken[tokens[i]] = true;
            emit TokenAccepted(tokens[i], true);
        }
    }

    function templateKind() external pure returns (bytes32) { return KIND; }

    /// @notice Pay an order in the native coin (ETH on Base).
    function pay(bytes32 orderId) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        _markPaid(orderId);
        uint256 rest = _takeNativeFee(msg.value);
        Address.sendValue(payee, rest);
        emit Paid(orderId, _msgSender(), address(0), msg.value, msg.value - rest);
    }

    /// @notice Pay an order in an accepted ERC-20. Caller must approve this contract first.
    function payToken(address token, uint256 amount, bytes32 orderId) external nonReentrant {
        if (!acceptedToken[token]) revert TokenNotAccepted(token);
        if (amount == 0) revert ZeroAmount();
        _markPaid(orderId);
        address payer = _msgSender();
        (address treasury, uint16 bps) = IATCFactory(factory).feeConfig();
        uint256 fee = (amount * bps) / 10_000;
        if (fee > 0) IERC20(token).safeTransferFrom(payer, treasury, fee);
        IERC20(token).safeTransferFrom(payer, payee, amount - fee);
        emit Paid(orderId, payer, token, amount, fee);
    }

    function setPayee(address payable p) external onlyOwner {
        if (p == address(0)) revert ZeroAddress();
        payee = p;
        emit PayeeSet(p);
    }

    function setAcceptedToken(address token, bool ok) external onlyOwner {
        acceptedToken[token] = ok;
        emit TokenAccepted(token, ok);
    }

    function _markPaid(bytes32 orderId) internal {
        if (paid[orderId]) revert AlreadyPaid(orderId);
        paid[orderId] = true;
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
