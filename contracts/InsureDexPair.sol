// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DemoToken.sol";

/// @notice Minimal constant-product pair used by Experiment 6.
contract InsureDexPair {
    string public constant name = "InsureChain DEX LP";
    string public constant symbol = "iLP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public immutable factory;
    address public token0;
    address public token1;
    uint256 public reserve0;
    uint256 public reserve1;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 private unlocked = 1;
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to);
    event Sync(uint256 reserve0, uint256 reserve1);

    modifier lock() { require(unlocked == 1, "pair locked"); unlocked = 0; _; unlocked = 1; }

    constructor() { factory = msg.sender; }

    function initialize(address first, address second) external {
        require(msg.sender == factory && token0 == address(0), "already initialized");
        require(first < second, "tokens not sorted");
        token0 = first;
        token1 = second;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }
    function transfer(address to, uint256 value) external returns (bool) { _transfer(msg.sender, to, value); return true; }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) {
            require(approved >= value, "insufficient allowance");
            allowance[from][msg.sender] = approved - value;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, value);
        return true;
    }

    function mint(address to) external lock returns (uint256 liquidity) {
        uint256 balance0 = DemoToken(token0).balanceOf(address(this));
        uint256 balance1 = DemoToken(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        if (totalSupply == 0) {
            uint256 root = _sqrt(amount0 * amount1);
            require(root > MINIMUM_LIQUIDITY, "liquidity too small");
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
            liquidity = root - MINIMUM_LIQUIDITY;
        } else {
            uint256 liquidity0 = amount0 * totalSupply / reserve0;
            uint256 liquidity1 = amount1 * totalSupply / reserve1;
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        }
        require(liquidity > 0, "zero liquidity");
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1, to);
    }

    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        uint256 liquidity = balanceOf[address(this)];
        uint256 supply = totalSupply;
        amount0 = liquidity * DemoToken(token0).balanceOf(address(this)) / supply;
        amount1 = liquidity * DemoToken(token1).balanceOf(address(this)) / supply;
        require(amount0 > 0 && amount1 > 0, "insufficient burn output");
        _burn(address(this), liquidity);
        require(DemoToken(token0).transfer(to, amount0), "token0 transfer failed");
        require(DemoToken(token1).transfer(to, amount1), "token1 transfer failed");
        _update(DemoToken(token0).balanceOf(address(this)), DemoToken(token1).balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external lock {
        require(amount0Out > 0 || amount1Out > 0, "zero output");
        require(amount0Out < reserve0 && amount1Out < reserve1, "insufficient reserves");
        require(to != token0 && to != token1 && to != address(this), "invalid recipient");
        if (amount0Out > 0) require(DemoToken(token0).transfer(to, amount0Out), "token0 transfer failed");
        if (amount1Out > 0) require(DemoToken(token1).transfer(to, amount1Out), "token1 transfer failed");
        uint256 balance0 = DemoToken(token0).balanceOf(address(this));
        uint256 balance1 = DemoToken(token1).balanceOf(address(this));
        uint256 amount0In = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "no input");
        uint256 adjusted0 = balance0 * 1000 - amount0In * 3;
        uint256 adjusted1 = balance1 * 1000 - amount1In * 3;
        require(adjusted0 * adjusted1 >= reserve0 * reserve1 * 1_000_000, "constant product invariant");
        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function _update(uint256 balance0, uint256 balance1) private {
        reserve0 = balance0;
        reserve1 = balance1;
        emit Sync(balance0, balance1);
    }
    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0) && balanceOf[from] >= value, "invalid LP transfer");
        balanceOf[from] -= value; balanceOf[to] += value; emit Transfer(from, to, value);
    }
    function _mint(address to, uint256 value) private { totalSupply += value; balanceOf[to] += value; emit Transfer(address(0), to, value); }
    function _burn(address from, uint256 value) private { balanceOf[from] -= value; totalSupply -= value; emit Transfer(from, address(0), value); }
    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) z = 1;
    }
}
