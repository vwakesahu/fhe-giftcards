// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Observer {
    event ObserverRegistered(address, uint256);

    address[] private observers;
    mapping(address => uint8) private compeleteness;
    mapping(address => uint256) private orderCompeleted;
    mapping(address => uint256) private orderFailed;
    mapping(address => uint256[]) private orderQueue;
    mapping(address => uint256) private observerBondAmount;
    uint256 private constant BOND_AMOUNT = 0.01 ether;

    function registerObserver() external payable {
        require(msg.value >= BOND_AMOUNT, "Bond too low");
        observerBondAmount[msg.sender] += msg.value;
        emit ObserverRegistered(msg.sender, observerBondAmount[msg.sender]);
    }

    /// @notice Minimum bond required to register as an observer.
    /// @return Bond amount in wei.
    function getBondAmount() external pure returns (uint256) {
        return BOND_AMOUNT;
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
    function getCompleteness(address observer) external view returns (uint8) {
        return compeleteness[observer];
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
        return orderFailed[observer];
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
}
