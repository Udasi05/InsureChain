// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DemoToken.sol";

/// @notice Minimal ERC-4626-style teaching vault. One share represents one
///         unit of the demo underlying while the vault is empty or fully backed.
/// @dev No fees, strategy, yield guarantee, or real insurance funds are used.
contract InsureReserveVault is DemoToken {
    DemoToken public immutable asset;

    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    constructor(address assetAddress)
        DemoToken("Insure Reserve Vault Share", "vINS", 0, false)
    {
        require(assetAddress != address(0), "invalid asset");
        asset = DemoToken(assetAddress);
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 managed = totalAssets();
        return supply == 0 || managed == 0 ? assets : assets * supply / managed;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? shares : shares * totalAssets() / supply;
    }

    function previewDeposit(uint256 assets) external view returns (uint256) { return convertToShares(assets); }
    function previewMint(uint256 shares) external view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 managed = totalAssets();
        return supply == 0 || managed == 0 ? shares : (shares * managed + supply - 1) / supply;
    }
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 managed = totalAssets();
        return supply == 0 || managed == 0 ? assets : (assets * supply + managed - 1) / managed;
    }
    function previewRedeem(uint256 shares) external view returns (uint256) { return convertToAssets(shares); }
    function maxDeposit(address) external pure returns (uint256) { return type(uint256).max; }
    function maxMint(address) external pure returns (uint256) { return type(uint256).max; }
    function maxWithdraw(address account) external view returns (uint256) { return convertToAssets(balanceOf[account]); }
    function maxRedeem(address account) external view returns (uint256) { return balanceOf[account]; }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(assets > 0 && receiver != address(0), "invalid deposit");
        shares = convertToShares(assets);
        require(shares > 0, "zero shares");
        require(asset.transferFrom(msg.sender, address(this), assets), "asset transfer failed");
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        require(shares > 0 && receiver != address(0), "invalid mint");
        uint256 supply = totalSupply;
        uint256 managed = totalAssets();
        assets = supply == 0 || managed == 0 ? shares : (shares * managed + supply - 1) / supply;
        require(asset.transferFrom(msg.sender, address(this), assets), "asset transfer failed");
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address account) external returns (uint256 shares) {
        require(assets > 0 && receiver != address(0), "invalid withdrawal");
        uint256 supply = totalSupply;
        uint256 managed = totalAssets();
        shares = (assets * supply + managed - 1) / managed;
        _spendShareAllowance(account, shares);
        _burn(account, shares);
        require(asset.transfer(receiver, assets), "asset transfer failed");
        emit Withdraw(msg.sender, receiver, account, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets) {
        require(shares > 0 && receiver != address(0), "invalid redemption");
        assets = convertToAssets(shares);
        _spendShareAllowance(account, shares);
        _burn(account, shares);
        require(asset.transfer(receiver, assets), "asset transfer failed");
        emit Withdraw(msg.sender, receiver, account, assets, shares);
    }

    function _spendShareAllowance(address account, uint256 shares) internal {
        if (msg.sender == account) return;
        uint256 approved = allowance[account][msg.sender];
        if (approved != type(uint256).max) {
            require(approved >= shares, "insufficient share allowance");
            allowance[account][msg.sender] = approved - shares;
        }
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient shares");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
