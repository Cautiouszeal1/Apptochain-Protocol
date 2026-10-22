// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IATCFactory, IATCTemplate} from "../interfaces/IATCFactory.sol";

/// @notice Shared logic for every apptochain template: owner, factory link, protocol fee split.
/// @dev Context overrides (ERC-2771) are resolved in each concrete template.
///      Reentrancy guard uses transient storage (EIP-1153, live on Base): no init needed for clones.
abstract contract ATCTemplateBase is Initializable, OwnableUpgradeable, ReentrancyGuardTransient, IATCTemplate {
    using SafeERC20 for IERC20;

    /// @notice Template code version. Bumped whenever template behaviour changes.
    string public constant TEMPLATE_VERSION = "1.1.0";

    address public factory;

    event FeeTaken(address indexed treasury, uint256 fee);
    event Withdrawn(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error WrongPayment(uint256 expected, uint256 sent);

    // solhint-disable-next-line func-name-mixedcase
    function __ATCTemplateBase_init(address owner_, address factory_) internal onlyInitializing {
        if (owner_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        factory = factory_;
    }

    /// @dev Sends the protocol share of `amount` (native coin) to the treasury.
    ///      Returns what is left for the app. Callers that keep the remainder in the
    ///      contract (for a later `withdraw`) may ignore the return value.
    function _takeNativeFee(uint256 amount) internal returns (uint256 remainder) {
        if (amount == 0) return 0;
        (address treasury, uint16 bps) = IATCFactory(factory).feeConfig();
        uint256 fee = (amount * bps) / 10_000;
        if (fee > 0) {
            Address.sendValue(payable(treasury), fee);
            emit FeeTaken(treasury, fee);
        }
        return amount - fee;
    }

    /// @notice App owner withdraws accumulated sales (after protocol fee).
    function withdraw(address payable to) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        Address.sendValue(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Recover ERC-20 tokens sent to this module by mistake.
    function rescueToken(address token, address to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
