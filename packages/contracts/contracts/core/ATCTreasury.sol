// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title ATCTreasury
/// @notice Holds protocol revenue. Every withdrawal carries a public memo.
///         Voting-agnostic: today the owner is a team multisig; in Phase 5 ownership
///         moves to whatever governor the community chooses (token or membership based).
contract ATCTreasury is Ownable2Step {
    using SafeERC20 for IERC20;

    event Received(address indexed from, uint256 amount);
    event Spent(address indexed token, address indexed to, uint256 amount, string memo);

    constructor(address owner_) Ownable(owner_) {}

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function spendNative(address payable to, uint256 amount, string calldata memo) external onlyOwner {
        Address.sendValue(to, amount);
        emit Spent(address(0), to, amount, memo);
    }

    function spendToken(address token, address to, uint256 amount, string calldata memo) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit Spent(token, to, amount, memo);
    }
}
