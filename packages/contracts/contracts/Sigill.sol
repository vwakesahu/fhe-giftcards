// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./ConfidentialERC20.sol";
import {Observer} from "./Observer.sol";

/// @title Sigill
/// @notice Confidential checkout: buyer pays in cUSDC (encrypted), observer
///         decrypts the product request off-chain, buys the gift card, and
///         delivers the code via hybrid encryption (AES-on-IPFS + FHE-wrapped
///         AES key). Escrow holds the cUSDC until fulfilment, refund, or
///         observer-initiated rejection.
contract Sigill is Observer {
    // enum Status {
    //     Pending,
    //     Fulfilled,
    //     Refunded,
    //     Rejected
    // }

    // struct Order {
    //     address buyer;
    //     address observer;
    //     euint64 encProductId;
    //     euint64 encPaid; // cUSDC escrowed for this order
    //     euint128 encAesKey; // filled on fulfillment
    //     string ipfsCid; // filled on fulfillment
    //     uint256 deadline;
    //     Status status;
    // }

    // ConfidentialERC20 public immutable cUSDC;

    // uint256 public nextOrderId;
    // mapping(uint256 => Order) public orders;
    // mapping(address => uint256) public observerBond;

    uint256 public constant MIN_BOND = 0.01 ether;
    // uint256 public constant ORDER_TIMEOUT = 10 minutes;

    // event ObserverRegistered(address indexed observer, uint256 bond);
    // event OrderPlaced(
    //     uint256 indexed orderId,
    //     address indexed buyer,
    //     uint256 productIdHandle,
    //     uint256 paidHandle,
    //     address observer,
    //     uint256 deadline
    // );
    // event OrderFulfilled(uint256 indexed orderId, string ipfsCid);

    constructor(ConfidentialERC20 _cUSDC) {
        cUSDC = _cUSDC;
    }

    // function registerObserver() external payable {

    // require(msg.value >= MIN_BOND, "Bond too low");
    //  [msg.sender] += msg.value;
    // emit ObserverRegistered(msg.sender, observerBond[msg.sender]);
    // }

    /// @notice Place a confidential order. Buyer must have `approve`d cUSDC to
    ///         this contract for the exact payment amount beforehand. The
    ///         contract consumes that allowance as the escrow. No encrypted
    ///         amount needs to flow through this call — that avoids the zkv
    ///         signature-binding issue where a fresh InEuint64 signed for the
    ///         buyer would be re-verified under Sigill's msg.sender inside
    ///         cUSDC's transferFrom.
    function placeOrder(InEuint64 calldata encProductId, address observerAddress) external {
        _placeOrder(encProductId, observerAddress);
        // require(observerBond[observerAddress] >= MIN_BOND, "Observer not bonded");

        // euint64 productId = FHE.asEuint64(encProductId);
        // FHE.allowThis(productId);
        // FHE.allow(productId, observerAddress);

        // // Pull the full allowance — its value was set when the buyer called
        // // approve, bound to them. transferFromAllowance returns the amount
        // // actually moved (clamped by balance) and zeroes the allowance.
        // euint64 paid = cUSDC.transferFromAllowance(msg.sender, address(this));
        // FHE.allowThis(paid);
        // FHE.allow(paid, observerAddress);

        // uint256 orderId = nextOrderId++;
        // uint256 deadline = block.timestamp + ORDER_TIMEOUT;

        // Order storage order = orders[orderId];
        // order.buyer = msg.sender;
        // order.observer = observerAddress;
        // order.encProductId = productId;
        // order.encPaid = paid;
        // order.deadline = deadline;
        // // status defaults to Pending

        // emit OrderPlaced(
        //     orderId, msg.sender, euint64.unwrap(productId), euint64.unwrap(paid), observerAddress, deadline
        // );
    }

    /// @notice Observer delivers the gift-card code and claims the escrowed cUSDC.
    function fulfillOrder(uint256 orderId, InEuint128 calldata encAesKey, string calldata ipfsCid) external {
        _fulfillOrder(orderId, encAesKey, ipfsCid);
        // Order storage order = orders[orderId];
        // require(msg.sender == order.observer, "Not observer");
        // require(order.status == Status.Pending, "Not pending");
        // require(block.timestamp <= order.deadline, "Deadline passed");

        // euint128 aesKey = FHE.asEuint128(encAesKey);
        // FHE.allowThis(aesKey);
        // FHE.allow(aesKey, order.buyer);

        // order.encAesKey = aesKey;
        // order.ipfsCid = ipfsCid;
        // order.status = Status.Fulfilled;

        // // Pay the observer in cUSDC. Transient ACL so cUSDC can read the handle
        // // for this call only.
        // FHE.allowTransient(order.encPaid, address(cUSDC));
        // cUSDC.transferEncrypted(order.observer, order.encPaid);

        // emit OrderFulfilled(orderId, ipfsCid);
    }

    /// @notice Observer honestly declines the order (e.g. payment undercut the
    ///         product price). Refunds buyer and preserves observer bond.
    function rejectOrder(uint256 orderId, string calldata reason) external {
        _rejectOrder(orderId, reason);
        // Order storage order = orders[orderId];
        // require(msg.sender == order.observer, "Not observer");
        // require(order.status == Status.Pending, "Not pending");

        // order.status = Status.Rejected;

        // FHE.allowTransient(order.encPaid, address(cUSDC));
        // cUSDC.transferEncrypted(order.buyer, order.encPaid);

        // emit OrderRejected(orderId, reason);
    }

    /// @notice Buyer reclaims after deadline. Slashes 50% of observer bond as
    ///         the penalty for ghosting.
    function refund(uint256 orderId) external {
        _refund(orderId);
        // Order storage order = orders[orderId];
        // require(msg.sender == order.buyer, "Not buyer");
        // require(block.timestamp > order.deadline, "Deadline not passed");
        // require(order.status == Status.Pending, "Not pending");

        // order.status = Status.Refunded;

        // uint256 slash = this.getObserverBondAmount(order.observer) / 2;
        // _setObserverBondAmount(order.observer, slash);

        // FHE.allowTransient(order.encPaid, address(cUSDC));
        // cUSDC.transferEncrypted(order.buyer, order.encPaid);

        // emit OrderRefunded(orderId);
    }

    function pickNextOrder()
        external
        view
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
}
