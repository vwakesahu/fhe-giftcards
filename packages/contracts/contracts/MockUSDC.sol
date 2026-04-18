// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only USDC stand-in. 6 decimals, open `mint` so anyone on
///         Base Sepolia can self-faucet. On the frontend this is displayed
///         as "USDC" to keep the UX clean.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {
        // Seed the deployer with 1,000,000 USDC for testing.
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can mint test USDC to any address. Capped at 1000 per
    ///         call so nobody can blow up the supply for no reason.
    function mint(address to, uint256 amount) external {
        require(amount <= 1000 * 10 ** 6, "max 1000 USDC per mint");
        _mint(to, amount);
    }
}
