// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./ConfidentialERC20.sol";

contract Observer {
    event ObserverRegistered(address, uint256);
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 productIdHandle,
        uint256 paidHandle,
        address observer,
        uint256 deadline
    );
    event OrderFulfilled(uint256 indexed orderId, string ipfsCid);
    event OrderRejected(uint256 indexed orderId, string reason);
    event OrderRefunded(uint256 indexed orderId);

    enum Status {
        Pending,
        Fulfilled,
        Refunded,
        Rejected
    }

    struct Order {
        address buyer;
        address observer;
        euint64 encProductId;
        euint64 encPaid; // cUSDC escrowed for this order
        euint128 encAesKey; // filled on fulfillment
        string ipfsCid; // filled on fulfillment
        uint256 deadline;
        Status status;
    }

    struct ObserverDetails {
        address observerAddress;
        uint256 sucessRate;
        uint256 slotLeft;
        uint256 soltSize;
    }

    uint256 private constant MIN_BOND_AMOUNT = 0.01 ether;
    uint256 public constant ORDER_TIMEOUT = 10 minutes;
    uint32 public constant PRICISION = 1000000;

    ConfidentialERC20 public immutable cUSDC;

    uint256 public nextOrderId;
    address[] public observers;
    mapping(address => bool) private isObserver;
    mapping(address => uint256) private observerTocompeleteness;
    mapping(uint256 => address[]) private compeltenessToobserver;
    mapping(address => uint256) private orderCompeleted;
    mapping(address => ObserverDetails) private observerDetails;
    mapping(address => uint256[]) private orderQueue; //putted orders in queue
    mapping(address => uint256) private orderIndex;
    mapping(address => uint256) private observerBondAmount; // done
    mapping(uint256 => Order) private orders; //done
    mapping(address => uint256) private orderReject;

    function registerObserver() external payable {
        require(msg.value >= MIN_BOND_AMOUNT, "Bond too low");
        observerBondAmount[msg.sender] += msg.value;
        observers.push(msg.sender);
        isObserver[msg.sender] = true;
        observerDetails[msg.sender] = ObserverDetails(msg.sender, 0, 4, 4);
        emit ObserverRegistered(msg.sender, observerBondAmount[msg.sender]);
    }

    function _pickNextOrder()
        internal
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
        require(isObserver[msg.sender], "Only Observer allowed to call this");
        require(orderIndex[msg.sender] == orderQueue[msg.sender].length, "No Orders are Pending");
        Order storage o = orders[orderIndex[msg.sender]];
        return (o.buyer, o.observer, o.encProductId, o.encPaid, o.encAesKey, o.ipfsCid, o.deadline, o.status);
    }

    function _placeOrder(InEuint64 calldata encProductId, address observerAddress) internal returns (uint256) {
        require(observerBondAmount[observerAddress] >= MIN_BOND_AMOUNT, "Observer not bonded");
        require(observerDetails[observerAddress].slotLeft > 0, "Observers queue is full");
        euint64 productId = FHE.asEuint64(encProductId);
        FHE.allowThis(productId);
        FHE.allow(productId, observerAddress);

        // Pull the full allowance — its value was set when the buyer called
        // approve, bound to them. transferFromAllowance returns the amount
        // actually moved (clamped by balance) and zeroes the allowance.
        observerDetails[observerAddress].slotLeft--;
        euint64 paid = cUSDC.transferFromAllowance(msg.sender, address(this));
        FHE.allowThis(paid);
        FHE.allow(paid, observerAddress);

        uint256 orderId = nextOrderId++;
        uint256 deadline = block.timestamp + ORDER_TIMEOUT;

        Order storage order = orders[orderId];
        order.buyer = msg.sender;
        order.observer = observerAddress;
        order.encProductId = productId;
        order.encPaid = paid;
        order.deadline = deadline;
        // status defaults to Pending
        // added order in the observer queue;
        orderQueue[observerAddress].push(orderId);

        emit OrderPlaced(
            orderId, msg.sender, euint64.unwrap(productId), euint64.unwrap(paid), observerAddress, deadline
        );

        return orderId;
    }

    function _fulfillOrder(uint256 orderId, InEuint128 calldata encAesKey, string calldata ipfsCid) internal {
        Order storage order = orders[orderId];
        require(msg.sender == order.observer, "Not observer");
        require(order.status == Status.Pending, "Not pending");
        require(block.timestamp <= order.deadline, "Deadline passed");

        euint128 aesKey = FHE.asEuint128(encAesKey);
        FHE.allowThis(aesKey);
        FHE.allow(aesKey, order.buyer);
        observerDetails[msg.sender].slotLeft++;
        order.encAesKey = aesKey;
        order.ipfsCid = ipfsCid;
        order.status = Status.Fulfilled;

        orderCompeleted[msg.sender]++;
        orderIndex[msg.sender]++;
        uint256 complete = orderCompeleted[msg.sender] * 1000000;
        uint256 totalOrder = orderIndex[msg.sender] * 1000000;
        uint256 completeness = complete / (totalOrder - orderReject[msg.sender]);
        observerDetails[msg.sender].sucessRate = completeness;
        uint256 previouscompleteness = observerTocompeleteness[msg.sender];
        observerTocompeleteness[msg.sender] = completeness;
        compeltenessToobserver[completeness].push(msg.sender);
        uint256 len = compeltenessToobserver[previouscompleteness].length;
        for (uint256 i = 0; i < len; i++) {
            if (msg.sender == compeltenessToobserver[previouscompleteness][i]) {
                (
                    compeltenessToobserver[previouscompleteness][i],
                    compeltenessToobserver[previouscompleteness][len - 1]
                ) =
                    (
                        compeltenessToobserver[previouscompleteness][len - 1],
                        compeltenessToobserver[previouscompleteness][i]
                    );
                compeltenessToobserver[previouscompleteness].pop();
                break;
            }
        }
        // Pay the observer in cUSDC. Transient ACL so cUSDC can read the handle
        // for this call only.
        FHE.allowTransient(order.encPaid, address(cUSDC));
        cUSDC.transferEncrypted(order.observer, order.encPaid);

        emit OrderFulfilled(orderId, ipfsCid);
    }

    function _rejectOrder(uint256 orderId, string calldata reason) internal {
        Order storage order = orders[orderId];
        require(msg.sender == order.observer, "Not observer");
        require(order.status == Status.Pending, "Not pending");

        observerDetails[msg.sender].slotLeft++;
        order.status = Status.Rejected;

        FHE.allowTransient(order.encPaid, address(cUSDC));
        cUSDC.transferEncrypted(order.buyer, order.encPaid);

        orderReject[msg.sender]++;
        orderIndex[msg.sender]++;
        emit OrderRejected(orderId, reason);
    }

    function _refund(uint256 orderId) internal {
        Order storage order = orders[orderId];
        require(msg.sender == order.buyer, "Not buyer");
        require(block.timestamp > order.deadline, "Deadline not passed");
        require(order.status == Status.Pending, "Not pending");

        order.status = Status.Refunded;

        uint256 slash = this.getObserverBondAmount(order.observer) / 2;
        _setObserverBondAmount(order.observer, slash);

        FHE.allowTransient(order.encPaid, address(cUSDC));
        cUSDC.transferEncrypted(order.buyer, order.encPaid);

        emit OrderRefunded(orderId);
    }

    function _observerQueue(address observer) internal view returns (uint256) {
        return orderQueue[observer].length - orderIndex[observer];
    }

    /*//////////////////////////////////////////////////////////////
                                SETTER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _setObserverBondAmount(address observer, uint256 slash) internal {
        observerBondAmount[observer] -= slash;
    }

    /*//////////////////////////////////////////////////////////////
                            GETTER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Minimum bond required to register as an observer.
    /// @return Bond amount in wei.
    function getBondAmount() external pure returns (uint256) {
        return MIN_BOND_AMOUNT;
    }

    /// @notice List of all registered observer addresses.
    /// @return Array of observer addresses.
    function getObservers() external view returns (address[] memory) {
        return observers;
    }

    /// @notice Total number of registered observers.
    /// @return Count of observers.
    function getObserversCount() external view returns (uint256) {
        return observers.length;
    }

    /// @notice Observer address at a given index in the registry.
    /// @param index Position in the observers array.
    /// @return Observer address at that index.
    function getObserverAt(uint256 index) external view returns (address) {
        require(index < observers.length, "Index out of bounds");
        return observers[index];
    }

    /// @notice Completeness score (0-100) for an observer.
    /// @param observer Address to look up.
    /// @return Completeness score as a percentage.
    function getCompleteness(address observer) external view returns (uint256) {
        return observerTocompeleteness[observer];
    }

    /// @notice Number of orders successfully completed by an observer.
    /// @param observer Address to look up.
    /// @return Count of completed orders.
    function getOrderCompleted(address observer) external view returns (uint256) {
        return orderCompeleted[observer];
    }

    /// @notice Number of orders failed by an observer.
    /// @param observer Address to look up.
    /// @return Count of failed orders.
    function getOrderFailed(address observer) external view returns (uint256) {
        uint256 orderProcessed = orderReject[observer] + orderCompeleted[observer];
        return orderQueue[observer].length - orderProcessed;
    }

    /// @notice Full pending order queue for an observer.
    /// @param observer Address to look up.
    /// @return Array of pending order IDs.
    function getOrderQueue(address observer) external view returns (uint256[] memory) {
        return orderQueue[observer];
    }

    /// @notice Number of pending orders in an observer's queue.
    /// @param observer Address to look up.
    /// @return Length of the queue.
    function getQueueLength(address observer) external view returns (uint256) {
        return orderQueue[observer].length;
    }

    /// @notice Order ID at a specific position in an observer's queue.
    /// @param observer Address to look up.
    /// @param index Position in the queue.
    /// @return Order ID at that position.
    function getQueueAt(address observer, uint256 index) external view returns (uint256) {
        require(index < orderQueue[observer].length, "Index out of bounds");
        return orderQueue[observer][index];
    }

    function getObserverBondAmount(address observer) external view returns (uint256) {
        return observerBondAmount[observer];
    }

    function getOrder(uint256 orderId)
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
        Order storage o = orders[orderId];
        return (o.buyer, o.observer, o.encProductId, o.encPaid, o.encAesKey, o.ipfsCid, o.deadline, o.status);
    }

    function getObserverDetail() external view returns (ObserverDetails[] memory) {
        uint256 len = observers.length;
        ObserverDetails[] memory observerList = new ObserverDetails[](len);
        for (uint256 i = 0; i < len; i++) {
            observerList[i] = observerDetails[observers[i]];
        }
        return observerList;
    }
}
