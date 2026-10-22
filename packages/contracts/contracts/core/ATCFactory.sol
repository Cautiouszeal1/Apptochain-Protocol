// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IATCFactory, IATCTemplate} from "../interfaces/IATCFactory.sol";

/// @title ATCFactory
/// @notice Deploys an app's on-chain modules as cheap minimal clones of audited templates,
///         collects the deployment fee (revenue stream A), and publishes the protocol fee
///         (revenue stream C) that templates read. Also the registry the relayer trusts.
contract ATCFactory is IATCFactory, Ownable2Step {
    uint16 public constant MAX_FEE_BPS = 500; // hard cap: 5%

    address public treasury;
    uint16 public protocolFeeBps;
    uint256 public deploymentFee;

    mapping(bytes32 => address) public implementationOf; // kind => template
    mapping(address => bytes32) public kindOf;           // app module => kind (0 = not ours)
    mapping(address => address[]) private _appsOf;       // owner => modules

    event ImplementationSet(bytes32 indexed kind, address impl);
    event AppDeployed(address indexed owner, bytes32 indexed kind, address app, string appId);
    event FeesUpdated(uint256 deploymentFee, uint16 protocolFeeBps);
    event TreasurySet(address indexed treasury);

    error UnknownKind(bytes32 kind);
    error FeeTooHigh();
    error WrongFee(uint256 expected, uint256 sent);
    error ZeroAddress();

    constructor(address owner_, address treasury_, uint256 deploymentFee_, uint16 feeBps_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        treasury = treasury_;
        deploymentFee = deploymentFee_;
        protocolFeeBps = feeBps_;
        emit TreasurySet(treasury_);
        emit FeesUpdated(deploymentFee_, feeBps_);
    }

    /// @notice Deploy one module (membership, assets, rewards or payments) for the caller.
    /// @param appId free-form label, e.g. "my-game" — groups modules for the SDK and dashboards
    function deploy(bytes32 kind, bytes calldata config, string calldata appId) external payable returns (address app) {
        if (msg.value != deploymentFee) revert WrongFee(deploymentFee, msg.value);
        address impl = implementationOf[kind];
        if (impl == address(0)) revert UnknownKind(kind);

        app = Clones.clone(impl);
        kindOf[app] = kind;
        _appsOf[msg.sender].push(app);
        IATCTemplate(app).initialize(msg.sender, address(this), config);

        if (msg.value > 0) Address.sendValue(payable(treasury), msg.value);
        emit AppDeployed(msg.sender, kind, app, appId);
    }

    function appsOf(address owner_) external view returns (address[] memory) {
        return _appsOf[owner_];
    }

    function isApp(address a) external view returns (bool) {
        return kindOf[a] != bytes32(0);
    }

    function feeConfig() external view returns (address, uint16) {
        return (treasury, protocolFeeBps);
    }

    // --- admin (moves to governance in Phase 5) ---
    function setImplementation(bytes32 kind, address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();
        if (IATCTemplate(impl).templateKind() != kind) revert UnknownKind(kind);
        implementationOf[kind] = impl;
        emit ImplementationSet(kind, impl);
    }

    function setFees(uint256 deploymentFee_, uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        deploymentFee = deploymentFee_;
        protocolFeeBps = feeBps_;
        emit FeesUpdated(deploymentFee_, feeBps_);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }
}
