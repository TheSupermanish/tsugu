// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IYieldStrategy} from "./IYieldStrategy.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  DemoYieldStrategy — testnet yield stand-in for Tsugu
/// @notice Somnia Shannon has no production lending/staking market and STT is a
///         faucet token, so there is no *real* yield to earn on testnet. This is an
///         HONEST stand-in: a single-client share vault whose yield comes from an
///         operator-funded reserve ({fund}). Topping up the reserve raises the share
///         price for every holder — exactly how a real venue's accrual would look to
///         the Vault — so the end-to-end "principal + yield to the beneficiary" flow
///         is demonstrable without faking a return inside the contract. On mainnet,
///         replace this with an adapter over a liquid lending/staking venue behind the
///         same {IYieldStrategy} interface.
/// @dev    Hardened against the ERC-4626 first-depositor / donation inflation attack
///         (the security review's critical finding):
///           1. The only ways value enters are {deposit} (onlyVault, mints shares) and
///              {fund} (onlyOperator). There is NO open `receive()`, so an attacker
///              cannot donate stray STT to move the share price — the donation lever is
///              gone.
///           2. A virtual-share offset (OZ ERC-4626 mitigation) makes share-price
///              manipulation by a dust first deposit economically infeasible.
///           3. {deposit} reverts if a contribution would mint zero shares, so a
///              contributor can never be credited 0 shares for real principal.
contract DemoYieldStrategy is IYieldStrategy, ReentrancyGuard {
    /// @notice The Tsugu Vault — the sole depositor/redeemer. It does per-pact share
    ///         accounting; this contract only tracks the aggregate share supply.
    address public immutable vault;
    /// @notice Who may top up the yield reserve (the deployer/operator).
    address public immutable operator;

    uint256 public totalShares;

    /// @dev Virtual shares offset (ERC-4626 inflation mitigation). Manipulating the
    ///      share price now costs ~VIRTUAL_SHARES× more, which is infeasible. Tiny
    ///      relative to real deposits, so it doesn't distort honest yield.
    uint256 private constant VIRTUAL_SHARES = 1e6;

    event Deposited(uint256 value, uint256 shares);
    event Redeemed(uint256 shares, uint256 amount, address indexed to);
    event Funded(address indexed from, uint256 amount);

    error NotVault();
    error NotOperator();
    error ZeroShares();
    error RedeemTransferFailed();

    constructor(address vault_) {
        vault = vault_;
        operator = msg.sender;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    /// @inheritdoc IYieldStrategy
    function deposit() external payable onlyVault returns (uint256 shares) {
        uint256 assetsBefore = address(this).balance - msg.value;
        shares = (msg.value * (totalShares + VIRTUAL_SHARES)) / (assetsBefore + 1);
        if (shares == 0) revert ZeroShares(); // never accept value-bearing deposits that mint nothing
        totalShares += shares;
        emit Deposited(msg.value, shares);
    }

    /// @inheritdoc IYieldStrategy
    /// @dev nonReentrant; effects (burn) precede the transfer.
    function redeem(uint256 shares, address to) external onlyVault nonReentrant returns (uint256 amount) {
        amount = (shares * (address(this).balance + 1)) / (totalShares + VIRTUAL_SHARES);
        totalShares -= shares;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert RedeemTransferFailed();
        emit Redeemed(shares, amount, to);
    }

    /// @inheritdoc IYieldStrategy
    function valueOf(uint256 shares) external view returns (uint256) {
        return (shares * (address(this).balance + 1)) / (totalShares + VIRTUAL_SHARES);
    }

    /// @notice Current share price scaled by 1e18 (1e18 = par; > par means yield accrued).
    function sharePrice() external view returns (uint256) {
        return ((address(this).balance + 1) * 1e18) / (totalShares + VIRTUAL_SHARES);
    }

    /// @notice Fund the yield reserve. OPERATOR-ONLY: an outsider must not be able to
    ///         move the share price (that was the donation lever in the inflation
    ///         attack). On testnet the operator calls this to simulate accrual.
    function fund() external payable {
        if (msg.sender != operator) revert NotOperator();
        emit Funded(msg.sender, msg.value);
    }

    // Deliberately NO open receive()/fallback: the contract accepts value only via
    // deposit() (onlyVault) and fund() (onlyOperator). Stray transfers revert, so the
    // share price cannot be inflated by an unsolicited donation.
}
