// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  IYieldStrategy — pluggable yield venue for Tsugu escrow
/// @notice The Vault deposits a yield-pact's idle escrow here and redeems it on
///         settlement, so contributors' money works while it waits for proof. The
///         Vault is the strategy's ONLY client and does its own per-pact share
///         accounting — implementations therefore only track the Vault's aggregate
///         position and MUST gate {deposit}/{redeem} to the Vault.
/// @dev    Share-based (ERC-4626-flavoured, native STT): `deposit` mints shares for
///         the value sent; `redeem` burns shares and sends the underlying
///         (principal + accrued yield) to `to`. A real deployment wraps a liquid
///         lending/staking venue; {DemoYieldStrategy} is the testnet stand-in.
///         INVARIANT the Vault relies on: shares are monotonic in value (redeeming
///         the same shares never returns less than was deposited, barring a venue
///         loss — the disclosed, opt-in principal risk).
interface IYieldStrategy {
    /// @notice Deposit `msg.value` of native STT on the Vault's behalf.
    /// @return shares minted for this deposit.
    function deposit() external payable returns (uint256 shares);

    /// @notice Burn `shares` and send the underlying (principal + yield) to `to`.
    /// @return amount native STT sent.
    function redeem(uint256 shares, address to) external returns (uint256 amount);

    /// @notice Current native value of `shares` (principal + yield) — for views.
    function valueOf(uint256 shares) external view returns (uint256);
}
