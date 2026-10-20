// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IATCFactory} from "../interfaces/IATCFactory.sol";

/// @notice Shared logic for every apptochain template: owner, factory link, protocol fee split.
/// @dev Context overrides (ERC-2771) are resolved in each concrete template.
///      Reentrancy guard uses transient storage (EIP-1153, live on Base): no init needed for clones.
abstract contract ATCTemplateBase is Initializable, OwnableUpgradeable, ReentrancyGuardTransient {
    address public factory;

    event FeeTaken(address indexed treasury, uint256 fee);

    error ZeroAddress();
    error WrongPayment(uint256 expected, uint256 sent);

    function __ATCTemplateBase_init(address owner_, address factory_) internal onlyInitializing {
        if (owner_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        factory = factory_;
    }

    /// @dev Sends the protocol share of `amount` (native coin) to the treasury.
    ///      Returns what is left for the app owner.
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
    function withdraw(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        Address.sendValue(to, address(this).balance);
    }
}
