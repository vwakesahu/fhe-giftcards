// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./ConfidentialERC20.sol";
import {Observer} from "./Observer.sol";

/// @title Sigill
/// @notice Confidential checkout: buyer pays in cUSDC (encrypted), observer
///         decrypts the product request off-chain, buys the gift card, and
///         delivers the code via hybrid encryption (AES-on-IPFS + FHE-wrapped
///         AES key). Two-step flow:
///           1. quoteOrder: buyer picks productId + observer + amount.
///              Contract computes (amount + observerFee + platformFee) in
///              the encrypted domain, stores it, emits OrderQuoted with
///              the encrypted total handle.
///           2. confirmOrder: buyer has approved cUSDC for exactly that
///              total. Contract pulls the allowance, FHE.eq-verifies it
///              against the stored total, refunds in-place on mismatch.
contract Sigill is Observer {
    mapping(address => uint256[]) private myOrder;

    uint256 public constant MIN_BOND = 0.01 ether;

    constructor(ConfidentialERC20 _cUSDC) {
        cUSDC = _cUSDC;
        admin = msg.sender;
    }

    /// @notice Step 1: get a quote. Buyer specifies the gift-card amount in
    ///         cUSDC base units (6 decimals). Emits OrderQuoted with the
    ///         encrypted total (amount + observerFee + platformFee) the buyer
    ///         must approve on cUSDC before confirming.
    function quoteOrder(uint256 productId, address observerAddress, uint64 amountUsdc) external returns (uint256 pendingId) {
        return _quoteOrder(productId, observerAddress, amountUsdc);
    }

    /// @notice Step 2: confirm after approving cUSDC for the quoted total.
    function confirmOrder(uint256 pendingId) external {
        myOrder[msg.sender].push(_confirmOrder(pendingId));
    }

    /// @notice Observer delivers the gift-card code and claims the escrowed cUSDC.
    function fulfillOrder(uint256 orderId, InEuint128 calldata encAesKey, string calldata ipfsCid) external {
        _fulfillOrder(orderId, encAesKey, ipfsCid);
    }

    /// @notice Observer honestly declines the order (e.g. payment undercut the
    ///         product price). Refunds buyer and preserves observer bond.
    function rejectOrder(uint256 orderId, string calldata reason) external {
        _rejectOrder(orderId, reason);
    }

    /// @notice Buyer reclaims after deadline. Slashes 50% of observer bond as
    ///         the penalty for ghosting.
    function refund(uint256 orderId) external {
        _refund(orderId);
    }

    function pickNextOrder()
        external
        returns (
            address buyer,
            address observer,
            euint64 encProductId,
            euint64 encPaid,
            euint128 encAesKey,
            string memory ipfsCid,
            uint256 deadline,
            Status status
        )
    {
        return _pickNextOrder();
    }

    function observersQueue(address observer) external view returns (uint256) {
        return _observerQueue(observer);
    }
}
