// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title ATCForwarder
/// @notice Trusted forwarder for gasless actions. Users sign an EIP-712 ForwardRequest,
///         the apptochain relayer submits it and pays gas. Templates read the real user
///         from the appended calldata (ERC-2771), so ownership always stays with the signer.
contract ATCForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("apptochain") {}
}
