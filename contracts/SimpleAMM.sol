// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DemoToken.sol";

/// @notice Experiment 4 constant-product pool with an educational LP ledger.
contract SimpleAMM {
    DemoToken public immutable tokenA;
    DemoToken public immutable tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event Swap(address indexed trader, address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut);

    constructor(address tokenAAddress, address tokenBAddress) {
        require(tokenAAddress != tokenBAddress && tokenAAddress != address(0) && tokenBAddress != address(0), "invalid pair");
        tokenA = DemoToken(tokenAAddress);
        tokenB = DemoToken(tokenBAddress);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transferShares(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) {
            require(approved >= amount, "insufficient allowance");
            allowance[from][msg.sender] = approved - amount;
        }
        _transferShares(from, to, amount);
        return true;
    }

    function addLiquidity(uint256 amountA, uint256 amountB, uint256 minShares) external returns (uint256 shares) {
        require(amountA > 0 && amountB > 0, "zero amount");
        uint256 supply = totalSupply;
        if (supply == 0) {
            uint256 root = _sqrt(amountA * amountB);
            require(root > MINIMUM_LIQUIDITY, "liquidity too small");
            shares = root - MINIMUM_LIQUIDITY;
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            uint256 shareA = amountA * supply / reserveA;
            uint256 shareB = amountB * supply / reserveB;
            shares = shareA < shareB ? shareA : shareB;
        }
        require(shares >= minShares && shares > 0, "insufficient LP shares");
        require(tokenA.transferFrom(msg.sender, address(this), amountA), "token A transfer failed");
        require(tokenB.transferFrom(msg.sender, address(this), amountB), "token B transfer failed");
        _mint(msg.sender, shares);
        _updateReserves();
        emit LiquidityAdded(msg.sender, amountA, amountB, shares);
    }

    function removeLiquidity(uint256 shares, uint256 minA, uint256 minB) external returns (uint256 amountA, uint256 amountB) {
        require(shares > 0 && balanceOf[msg.sender] >= shares, "insufficient LP shares");
        amountA = shares * reserveA / totalSupply;
        amountB = shares * reserveB / totalSupply;
        require(amountA >= minA && amountB >= minB, "minimum output not met");
        balanceOf[msg.sender] -= shares;
        totalSupply -= shares;
        emit Transfer(msg.sender, address(0), shares);
        require(tokenA.transfer(msg.sender, amountA), "token A transfer failed");
        require(tokenB.transfer(msg.sender, amountB), "token B transfer failed");
        _updateReserves();
        emit LiquidityRemoved(msg.sender, amountA, amountB, shares);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "insufficient amount or liquidity");
        uint256 amountInWithFee = amountIn * 997;
        return amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee);
    }

    function swapExactAForB(uint256 amountIn, uint256 minOut) external returns (uint256 amountOut) {
        amountOut = getAmountOut(amountIn, reserveA, reserveB);
        require(amountOut >= minOut, "slippage exceeded");
        require(tokenA.transferFrom(msg.sender, address(this), amountIn), "token A transfer failed");
        require(tokenB.transfer(msg.sender, amountOut), "token B transfer failed");
        _updateReserves();
        emit Swap(msg.sender, address(tokenA), amountIn, address(tokenB), amountOut);
    }

    function swapExactBForA(uint256 amountIn, uint256 minOut) external returns (uint256 amountOut) {
        amountOut = getAmountOut(amountIn, reserveB, reserveA);
        require(amountOut >= minOut, "slippage exceeded");
        require(tokenB.transferFrom(msg.sender, address(this), amountIn), "token B transfer failed");
        require(tokenA.transfer(msg.sender, amountOut), "token A transfer failed");
        _updateReserves();
        emit Swap(msg.sender, address(tokenB), amountIn, address(tokenA), amountOut);
    }

    function _updateReserves() internal {
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transferShares(address from, address to, uint256 amount) internal {
        require(to != address(0) && balanceOf[from] >= amount, "invalid LP transfer");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) z = 1;
    }
}
