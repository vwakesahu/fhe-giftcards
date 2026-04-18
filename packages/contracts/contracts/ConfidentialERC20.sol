// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ConfidentialERC20
/// @notice Minimal confidential wrapper over a plaintext ERC20. Balances and
///         allowances are FHE-encrypted `euint64` handles. Insufficient-fund
///         operations fail silently (transfer 0) to avoid leaking balances
///         through reverts — the same semantics as OpenZeppelin/Zama's
///         ConfidentialFungibleToken (ERC-7984).
contract ConfidentialERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    mapping(address => euint64) private _balances;
    mapping(address => mapping(address => euint64)) private _allowances;

    struct PendingUnwrap {
        address recipient;
        euint64 encAmount;
        bool claimed;
    }
    mapping(uint256 => PendingUnwrap) public pendingUnwraps;
    uint256 public nextUnwrapId;

    event Wrap(address indexed from, uint256 amount);
    event UnwrapRequested(uint256 indexed unwrapId, address indexed from);
    event UnwrapClaimed(uint256 indexed unwrapId, address indexed to, uint256 amount);
    event Transfer(address indexed from, address indexed to);
    event Approval(address indexed owner, address indexed spender);

    constructor(IERC20 _underlying, string memory _name, string memory _symbol) {
        underlying = _underlying;
        name = _name;
        symbol = _symbol;
        // Mirror the underlying token's decimals so 1:1 wrapping is intuitive.
        try IERC20Metadata(address(_underlying)).decimals() returns (uint8 d) {
            decimals = d;
        } catch {
            decimals = 18;
        }
    }

    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (euint64) {
        return _allowances[owner][spender];
    }

    /// @notice Lock `amount` of underlying and mint the same encrypted balance.
    ///         The wrap amount is plaintext (it came from a public ERC20), so
    ///         wrapping itself is observable. Privacy kicks in once you transfer.
    function wrap(uint64 amount) external {
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        euint64 delta = FHE.asEuint64(amount);
        _credit(msg.sender, delta);
        emit Wrap(msg.sender, amount);
    }

    /// @notice Request an unwrap. Debits the encrypted balance immediately
    ///         (clamped to balance) and fires an async decrypt. Caller must
    ///         follow up with `claimUnwrap(unwrapId)` once the FHE network
    ///         has produced the plaintext.
    function requestUnwrap(InEuint64 calldata encAmount) external returns (uint256 unwrapId) {
        euint64 amount = FHE.asEuint64(encAmount);
        euint64 debit = _clampToBalance(msg.sender, amount);

        _debit(msg.sender, debit);

        // Give ourselves + caller visibility on the debit handle before decrypt.
        FHE.allowThis(debit);
        FHE.allow(debit, msg.sender);

        FHE.decrypt(debit);

        unwrapId = nextUnwrapId++;
        pendingUnwraps[unwrapId] = PendingUnwrap({
            recipient: msg.sender,
            encAmount: debit,
            claimed: false
        });
        emit UnwrapRequested(unwrapId, msg.sender);
    }

    /// @notice Finalise an unwrap once the decrypt task has resolved.
    function claimUnwrap(uint256 unwrapId) external {
        PendingUnwrap storage p = pendingUnwraps[unwrapId];
        require(p.recipient != address(0), "unknown unwrap");
        require(!p.claimed, "already claimed");

        (uint64 plain, bool decrypted) = FHE.getDecryptResultSafe(p.encAmount);
        require(decrypted, "decrypt pending");

        p.claimed = true;
        if (plain > 0) {
            underlying.safeTransfer(p.recipient, plain);
        }
        emit UnwrapClaimed(unwrapId, p.recipient, plain);
    }

    /// @notice Transfer an encrypted amount. Silently clamps to sender balance.
    function transfer(address to, InEuint64 calldata encAmount) external returns (euint64 transferred) {
        euint64 amount = FHE.asEuint64(encAmount);
        transferred = _move(msg.sender, to, amount);
        // Caller wants to know the outcome.
        FHE.allow(transferred, msg.sender);
        FHE.allow(transferred, to);
    }

    /// @notice Contract-to-contract variant: transfer an existing encrypted handle.
    ///         Caller must hold the handle and have granted this contract transient ACL.
    ///         Clamps to sender's confidential balance like `transfer`.
    function transferEncrypted(address to, euint64 amount) external returns (euint64 transferred) {
        transferred = _move(msg.sender, to, amount);
        FHE.allow(transferred, msg.sender);
        FHE.allow(transferred, to);
    }

    /// @notice Pull the spender's entire allowance from `from` to `to`. No fresh
    ///         `InEuint64` is required — the allowance handle (set by `from` in
    ///         a prior `approve` call) is consumed directly. This is the right
    ///         primitive when an escrow contract (caller) needs to pull funds
    ///         without re-encrypting: the buyer's `approve` already binds the
    ///         amount to them, and this call leaves the allowance at zero to
    ///         prevent replay.
    function transferFromAllowance(address from, address to) external returns (euint64 transferred) {
        euint64 allowed = _allowances[from][msg.sender];
        transferred = _move(from, to, allowed);

        // Allowance := allowance - transferred (goes to 0 on a full pull,
        // stays positive only if balance was insufficient).
        euint64 newAllowance = FHE.sub(allowed, transferred);
        _allowances[from][msg.sender] = newAllowance;
        FHE.allowThis(newAllowance);
        FHE.allow(newAllowance, from);
        FHE.allow(newAllowance, msg.sender);

        FHE.allow(transferred, from);
        FHE.allow(transferred, to);
        FHE.allow(transferred, msg.sender);
    }

    /// @notice Set an encrypted allowance. Overwrites any previous allowance.
    function approve(address spender, InEuint64 calldata encAmount) external returns (euint64) {
        euint64 amount = FHE.asEuint64(encAmount);
        _allowances[msg.sender][spender] = amount;
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);
        FHE.allow(amount, spender);
        emit Approval(msg.sender, spender);
        return amount;
    }

    /// @notice Spender pulls from `from`. Silently clamps to min(amount, allowance, balance).
    function transferFrom(
        address from,
        address to,
        InEuint64 calldata encAmount
    ) external returns (euint64 transferred) {
        euint64 amount = FHE.asEuint64(encAmount);
        euint64 allowed = _allowances[from][msg.sender];

        // Clamp by allowance first.
        ebool allowOk = FHE.gte(allowed, amount);
        euint64 maxByAllow = FHE.select(allowOk, amount, FHE.asEuint64(0));

        transferred = _move(from, to, maxByAllow);

        // Decrement allowance by what actually moved.
        euint64 newAllowance = FHE.sub(allowed, transferred);
        _allowances[from][msg.sender] = newAllowance;
        FHE.allowThis(newAllowance);
        FHE.allow(newAllowance, from);
        FHE.allow(newAllowance, msg.sender);

        FHE.allow(transferred, from);
        FHE.allow(transferred, to);
        FHE.allow(transferred, msg.sender);
    }

    // ───── internals ─────────────────────────────────────────────────────

    function _move(address from, address to, euint64 amount) internal returns (euint64 transferred) {
        require(to != address(0), "to=0");
        transferred = _clampToBalance(from, amount);
        _debit(from, transferred);
        _credit(to, transferred);
        FHE.allowThis(transferred);
        emit Transfer(from, to);
    }

    function _clampToBalance(address owner, euint64 amount) internal returns (euint64) {
        euint64 bal = _balances[owner];
        ebool ok = FHE.gte(bal, amount);
        return FHE.select(ok, amount, FHE.asEuint64(0));
    }

    function _debit(address owner, euint64 amount) internal {
        euint64 next = FHE.sub(_balances[owner], amount);
        _balances[owner] = next;
        FHE.allowThis(next);
        FHE.allow(next, owner);
    }

    function _credit(address owner, euint64 amount) internal {
        euint64 next = FHE.add(_balances[owner], amount);
        _balances[owner] = next;
        FHE.allowThis(next);
        FHE.allow(next, owner);
    }
}

interface IERC20Metadata is IERC20 {
    function decimals() external view returns (uint8);
}
