// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract PrivateCheckout {
    struct Order {
        address buyer;
        address observer;
        euint64 encProductId;
        euint64 encAmount;
        euint256 encCode;
        uint256 lockedEth;
        uint256 deadline;
        bool fulfilled;
        bool refunded;
    }

    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256) public observerBond;

    uint256 public constant MIN_BOND = 0.01 ether;
    uint256 public constant ORDER_TIMEOUT = 10 minutes;

    event ObserverRegistered(address indexed observer, uint256 bond);
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 productIdHandle,
        uint256 amountHandle,
        address observer,
        uint256 deadline
    );
    event OrderFulfilled(uint256 indexed orderId);
    event OrderRefunded(uint256 indexed orderId);

    function registerObserver() external payable {
        require(msg.value >= MIN_BOND, "Bond too low");
        observerBond[msg.sender] += msg.value;
        emit ObserverRegistered(msg.sender, observerBond[msg.sender]);
    }

    function placeOrder(
        InEuint64 memory encProductId,
        InEuint64 memory encAmount,
        address observerAddress
    ) external payable {
        require(observerBond[observerAddress] >= MIN_BOND, "Observer not bonded");
        require(msg.value > 0, "Must lock ETH");

        euint64 productId = FHE.asEuint64(encProductId);
        euint64 amount = FHE.asEuint64(encAmount);

        // Contract can store these handles
        FHE.allowThis(productId);
        FHE.allowThis(amount);

        // Observer can decrypt these to know what to buy
        FHE.allow(productId, observerAddress);
        FHE.allow(amount, observerAddress);

        uint256 orderId = nextOrderId++;
        uint256 deadline = block.timestamp + ORDER_TIMEOUT;

        Order storage order = orders[orderId];
        order.buyer = msg.sender;
        order.observer = observerAddress;
        order.encProductId = productId;
        order.encAmount = amount;
        order.lockedEth = msg.value;
        order.deadline = deadline;

        emit OrderPlaced(
            orderId,
            msg.sender,
            euint64.unwrap(productId),
            euint64.unwrap(amount),
            observerAddress,
            deadline
        );
    }

    function fulfillOrder(uint256 orderId, InEuint256 memory encCode) external {
        Order storage order = orders[orderId];
        require(msg.sender == order.observer, "Not observer");
        require(!order.fulfilled, "Already fulfilled");
        require(block.timestamp <= order.deadline, "Deadline passed");

        euint256 code = FHE.asEuint256(encCode);

        // Contract stores the code handle
        FHE.allowThis(code);

        // ONLY the buyer can decrypt the gift card code
        FHE.allow(code, order.buyer);

        order.encCode = code;
        order.fulfilled = true;

        // Pay the observer
        (bool sent, ) = payable(order.observer).call{value: order.lockedEth}("");
        require(sent, "ETH transfer failed");

        emit OrderFulfilled(orderId);
    }

    function refund(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(msg.sender == order.buyer, "Not buyer");
        require(block.timestamp > order.deadline, "Deadline not passed");
        require(!order.fulfilled, "Already fulfilled");
        require(!order.refunded, "Already refunded");

        order.refunded = true;

        // Slash 50% of observer bond as penalty
        uint256 slash = observerBond[order.observer] / 2;
        observerBond[order.observer] -= slash;

        // Return locked ETH to buyer
        (bool sent, ) = payable(order.buyer).call{value: order.lockedEth}("");
        require(sent, "ETH transfer failed");

        emit OrderRefunded(orderId);
    }

    function getOrder(uint256 orderId) external view returns (
        address buyer,
        address observer,
        euint64 encProductId,
        euint64 encAmount,
        euint256 encCode,
        uint256 lockedEth,
        uint256 deadline,
        bool fulfilled,
        bool refunded
    ) {
        Order storage o = orders[orderId];
        return (
            o.buyer,
            o.observer,
            o.encProductId,
            o.encAmount,
            o.encCode,
            o.lockedEth,
            o.deadline,
            o.fulfilled,
            o.refunded
        );
    }
}
