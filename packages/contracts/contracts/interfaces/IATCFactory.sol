// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IATCFactory {
    /// @return treasury address that receives protocol fees
    /// @return feeBps protocol fee in basis points (1 bp = 0.01%)
    function feeConfig() external view returns (address treasury, uint16 feeBps);
}

interface IATCTemplate {
    function initialize(address owner, address factory, bytes calldata config) external;
    function templateKind() external pure returns (bytes32);
}
