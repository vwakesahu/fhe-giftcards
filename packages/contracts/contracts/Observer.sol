// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./ConfidentialERC20.sol";

contract Observer {
    event ObserverRegistered(address, uint256);
    event OrderInProccessed(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 productIdHandle,
        uint256 paidHandle,
        address observer,
        uint256 deadline
    );
    event OrderInQueued(
        uint256 indexed orderId, address indexed buyer, uint256 productIdHandle, uint256 paidHandle, address observer
    );
    event OrderFulfilled(uint256 indexed orderId, string ipfsCid);
    event OrderRejected(uint256 indexed orderId, string reason);
    event OrderRefunded(uint256 indexed orderId);
    // Buyer-side listens for this to learn the encrypted total handle, unseals
    // it via cofhejs, then approves cUSDC for exactly that plaintext amount.
    event OrderQuoted(
        uint256 indexed pendingId,
        address indexed buyer,
        address indexed observer,
        uint256 productId,
        uint256 expectedTotalHandle,
        uint256 expiresAt
    );

    enum Status {
        Pending,
        Processing,
        Fulfilled,
        Refunded,
        Rejected,
        Queued
    }

    struct Order {
        address buyer;
        address observer;
        euint64 encProductId;
        // Total escrowed at confirm: price + observerFee + platformFee.
        // 0 if the buyer's approved amount didn't equal the quoted total —
        // FHE.select zeroes it silently, observer sees 0 and rejects.
        euint64 encPaid;
        // Split off at fulfillment and sent to PROTOCOL_VALUT.
        euint64 platformFee;
        euint128 encAesKey;
        string ipfsCid;
        uint256 deadline;
        Status status;
    }

    struct ObserverDetails {
        address observerAddress;
        uint256 sucessRate;
        uint256 slotLeft;
        uint256 soltSize;
        euint64 observerFees;
    }

    // Stash of contract-computed totals between quoteOrder and confirmOrder.
    // confirmOrder reads `expectedTotal` and FHE.eq's it against what the
    // buyer actually approved — that's the tamper-resistance guarantee.
    struct PendingOrder {
        address buyer;
        address observer;
        uint256 productId;
        euint64 expectedTotal;
        euint64 platformFee;
        uint256 expiresAt;
    }

    uint256 private constant MIN_BOND_AMOUNT = 0.01 ether;
    uint256 public constant ORDER_TIMEOUT = 10 minutes;
    uint256 public constant QUOTE_TTL = 5 minutes;
    uint32 public constant PRICISION = 1000000;
    // Platform fee in per-mille — 25 / 1000 = 2.5%.
    uint256 private constant PLATFORM_FEE = 25;
    address private constant PROTOCOL_VALUT = 0x37DFfFfB73b4A7eE6584F1ea56bac618c29c6882;
    ConfidentialERC20 public immutable cUSDC;

    address public admin;
    uint256 public nextOrderId;
    uint256 public nextPendingId;

    address[] public observers;
    mapping(address => bool) private isObserver;
    mapping(address => uint256) private observerTocompeleteness;
    mapping(uint256 => address[]) private compeltenessToobserver;
    mapping(address => uint256) private orderCompeleted;
    mapping(address => ObserverDetails) private observerDetails;
    mapping(address => uint256[]) private orderQueue;
    mapping(address => uint256) private orderIndex;
    mapping(address => uint256) private observerBondAmount;
    mapping(uint256 => Order) private orders;
    mapping(address => uint256) private orderReject;

    mapping(uint256 => PendingOrder) private pending;
    mapping(uint256 => uint64) public productPriceUsdc;
    mapping(uint256 => bool) public productActive;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    function registerObserver(uint64 fees) external payable {
        require(msg.value >= MIN_BOND_AMOUNT, "Bond too low");
        observerBondAmount[msg.sender] += msg.value;
        observers.push(msg.sender);
        isObserver[msg.sender] = true;
        euint64 encFees = FHE.asEuint64(fees);
        FHE.allowThis(encFees);
        FHE.allow(encFees, msg.sender);
        observerDetails[msg.sender] = ObserverDetails(msg.sender, 0, 4, 4, encFees);
        emit ObserverRegistered(msg.sender, observerBondAmount[msg.sender]);
    }

    function _pickNextOrder()
        internal
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
        require(orderIndex[msg.sender] < orderQueue[msg.sender].length, "No Orders are Pending");
        uint256 idx = orderIndex[msg.sender];
        for (; idx < orderQueue[msg.sender].length; idx++) {
            if (orders[orderQueue[msg.sender][idx]].status != Status.Refunded) {
                break;
            }
        }
        orderIndex[msg.sender] = idx;
        Order storage o = orders[orderQueue[msg.sender][idx]];
        o.status = Status.Processing;
        return (o.buyer, o.observer, o.encProductId, o.encPaid, o.encAesKey, o.ipfsCid, o.deadline, o.status);
    }

    function _nextOrderStatusUpdate(uint256 orderId) internal {
        Order storage order = orders[orderId];
        order.deadline = block.timestamp + ORDER_TIMEOUT;
        order.status = Status.Pending;
    }

    /// @notice Step 1 — compute the encrypted total (price + observerFee +
    ///         platformFee) and stash it. Emits OrderQuoted with the handle
    ///         so the buyer's frontend can unseal it and prepare the approve.
    function _quoteOrder(uint256 productId, address observerAddress) internal returns (uint256 pendingId) {
        require(productActive[productId], "unknown product");
        require(observerBondAmount[observerAddress] >= MIN_BOND_AMOUNT, "Observer not bonded");
        require(observerDetails[observerAddress].slotLeft > 0, "Observers queue is full");

        euint64 price = FHE.asEuint64(productPriceUsdc[productId]);
        euint64 observerFee = observerDetails[observerAddress].observerFees;
        euint64 platformFee = FHE.div(
            FHE.mul(price, FHE.asEuint64(uint64(PLATFORM_FEE))),
            FHE.asEuint64(uint64(1000))
        );
        euint64 total = FHE.add(FHE.add(price, observerFee), platformFee);

        FHE.allowThis(total);
        FHE.allow(total, msg.sender);
        FHE.allowThis(platformFee);

        pendingId = nextPendingId++;
        uint256 exp = block.timestamp + QUOTE_TTL;
        pending[pendingId] = PendingOrder({
            buyer: msg.sender,
            observer: observerAddress,
            productId: productId,
            expectedTotal: total,
            platformFee: platformFee,
            expiresAt: exp
        });

        emit OrderQuoted(pendingId, msg.sender, observerAddress, productId, euint64.unwrap(total), exp);
    }

    /// @notice Step 2 — pull the buyer's pre-approved allowance, verify it
    ///         equals the quoted total via FHE.eq, refund in-place if not.
    ///         No amount parameter — the buyer can't tamper because the
    ///         comparison value is the stored expectedTotal.
    function _confirmOrder(uint256 pendingId) internal returns (uint256 orderId) {
        PendingOrder storage p = pending[pendingId];
        require(p.buyer != address(0), "Unknown quote");
        require(p.buyer == msg.sender, "Not buyer");
        require(block.timestamp <= p.expiresAt, "Quote expired");

        address observerAddr = p.observer;

        // Mint a fresh encProductId from the stashed plaintext — observer
        // gets ACL so they can decrypt during fulfilment. Buyer never
        // supplies an InEuint64 here, so there's nothing to forge.
        euint64 productIdHandle = FHE.asEuint64(p.productId);
        FHE.allowThis(productIdHandle);
        FHE.allow(productIdHandle, observerAddr);

        euint64 paid = cUSDC.transferFromAllowance(msg.sender, address(this));

        // Encrypted-domain enforcement of "paid == quoted".
        ebool ok = FHE.eq(paid, p.expectedTotal);
        euint64 escrowed = FHE.select(ok, paid, FHE.asEuint64(uint64(0)));
        euint64 refundIfBad = FHE.select(ok, FHE.asEuint64(uint64(0)), paid);
        euint64 platformFee = FHE.select(ok, p.platformFee, FHE.asEuint64(uint64(0)));

        // Same-tx refund of the bad amount. Indistinguishable from a 0
        // transfer on the outside — no leak about whether the check passed.
        FHE.allowThis(refundIfBad);
        FHE.allowTransient(refundIfBad, address(cUSDC));
        cUSDC.transferEncrypted(msg.sender, refundIfBad);

        FHE.allowThis(escrowed);
        FHE.allow(escrowed, observerAddr);
        FHE.allowThis(platformFee);

        observerDetails[observerAddr].slotLeft--;

        orderId = nextOrderId++;
        _writeOrderAndQueue(orderId, observerAddr, productIdHandle, escrowed, platformFee);

        delete pending[pendingId];
    }

    // Split out from _confirmOrder to keep the locals count under the
    // stack-depth threshold even with viaIR optimisations.
    function _writeOrderAndQueue(
        uint256 orderId,
        address observerAddr,
        euint64 productIdHandle,
        euint64 escrowed,
        euint64 platformFee
    ) internal {
        Order storage order = orders[orderId];
        order.buyer = msg.sender;
        order.observer = observerAddr;
        order.encProductId = productIdHandle;
        order.encPaid = escrowed;
        order.platformFee = platformFee;
        order.deadline = block.timestamp;
        orderQueue[observerAddr].push(orderId);

        if (orderQueue[observerAddr].length - orderIndex[observerAddr] == 1) {
            uint256 deadline = block.timestamp + ORDER_TIMEOUT;
            order.deadline = deadline;
            order.status = Status.Pending;
            emit OrderInProccessed(
                orderId, msg.sender, euint64.unwrap(productIdHandle), euint64.unwrap(escrowed), observerAddr, deadline
            );
        } else {
            order.status = Status.Queued;
            emit OrderInQueued(
                orderId, msg.sender, euint64.unwrap(productIdHandle), euint64.unwrap(escrowed), observerAddr
            );
        }
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
        // Split escrow: observer gets (encPaid - platformFee), platform vault gets platformFee.
        // If the buyer's payment was mismatched at confirm time, encPaid and
        // platformFee are both 0 — so both transfers are no-ops.
        euint64 observerCut = FHE.sub(order.encPaid, order.platformFee);
        FHE.allowThis(observerCut);
        FHE.allowTransient(observerCut, address(cUSDC));
        cUSDC.transferEncrypted(order.observer, observerCut);

        FHE.allowTransient(order.platformFee, address(cUSDC));
        cUSDC.transferEncrypted(PROTOCOL_VALUT, order.platformFee);

        emit OrderFulfilled(orderId, ipfsCid);
        if (orderIndex[msg.sender] < orderQueue[msg.sender].length) {
            _nextOrderStatusUpdate(orderQueue[msg.sender][orderIndex[msg.sender]]);
        }
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
        if (orderIndex[msg.sender] < orderQueue[msg.sender].length) {
            _nextOrderStatusUpdate(orderQueue[msg.sender][orderIndex[msg.sender]]);
        }
    }

    function _refund(uint256 orderId) internal {
        Order storage order = orders[orderId];
        require(msg.sender == order.buyer, "Not buyer");
        require(block.timestamp > order.deadline, "Deadline not passed");
        require(order.status == Status.Pending || order.status == Status.Queued, "Not pending");

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

    /// @notice Admin seeds the catalog. priceUsdc is plaintext (base units,
    ///         matches cUSDC's 6 decimals). Set price=0 to deactivate a product.
    function setProductPrice(uint256 productId, uint64 priceUsdc) external onlyAdmin {
        productPriceUsdc[productId] = priceUsdc;
        productActive[productId] = priceUsdc > 0;
    }

    /*//////////////////////////////////////////////////////////////
                            GETTER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getBondAmount() external pure returns (uint256) {
        return MIN_BOND_AMOUNT;
    }

    function getObservers() external view returns (address[] memory) {
        return observers;
    }

    function getObserversCount() external view returns (uint256) {
        return observers.length;
    }

    function getObserverAt(uint256 index) external view returns (address) {
        require(index < observers.length, "Index out of bounds");
        return observers[index];
    }

    function getCompleteness(address observer) external view returns (uint256) {
        return observerTocompeleteness[observer];
    }

    function getOrderCompleted(address observer) external view returns (uint256) {
        return orderCompeleted[observer];
    }

    function getOrderFailed(address observer) external view returns (uint256) {
        uint256 orderProcessed = orderReject[observer] + orderCompeleted[observer];
        return orderQueue[observer].length - orderProcessed;
    }

    function getOrderQueue(address observer) external view returns (uint256[] memory) {
        return orderQueue[observer];
    }

    function getQueueLength(address observer) external view returns (uint256) {
        return orderQueue[observer].length;
    }

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
            euint64 platformFee,
            euint128 encAesKey,
            string memory ipfsCid,
            uint256 deadline,
            Status status
        )
    {
        Order storage o = orders[orderId];
        return (o.buyer, o.observer, o.encProductId, o.encPaid, o.platformFee, o.encAesKey, o.ipfsCid, o.deadline, o.status);
    }

    function getPendingOrder(uint256 pendingId)
        external
        view
        returns (
            address buyer,
            address observer,
            uint256 productId,
            euint64 expectedTotal,
            euint64 platformFee,
            uint256 expiresAt
        )
    {
        PendingOrder storage p = pending[pendingId];
        return (p.buyer, p.observer, p.productId, p.expectedTotal, p.platformFee, p.expiresAt);
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
