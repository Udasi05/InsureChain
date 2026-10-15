// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DemoToken.sol";
import "./InsureDexFactory.sol";
import "./InsureDexPair.sol";

/// @notice Educational router: fixed 0.30% pool fee, deadline and min-output guards.
contract InsureDexRouter {
    InsureDexFactory public immutable factory;
    address public immutable wrappedNative;
    uint256 private constant FEE_NUMERATOR = 997;
    uint256 private constant FEE_DENOMINATOR = 1000;

    constructor(address factoryAddress, address wrappedNativeAddress) {
        require(factoryAddress != address(0), "invalid factory");
        factory = InsureDexFactory(factoryAddress);
        wrappedNative = wrappedNativeAddress;
    }

    modifier ensure(uint256 deadline) { require(deadline >= block.timestamp, "transaction expired"); _; }

    function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired,
        uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)
        external ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        address pair = _pair(tokenA, tokenB, true);
        (uint256 reserveA, uint256 reserveB) = _reserves(pair, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = _quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "B amount below minimum");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = _quote(amountBDesired, reserveB, reserveA);
                require(amountAOptimal <= amountADesired && amountAOptimal >= amountAMin, "A amount outside bounds");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
        require(amountA >= amountAMin && amountB >= amountBMin, "minimum liquidity amount not met");
        require(DemoToken(tokenA).transferFrom(msg.sender, pair, amountA), "token A transfer failed");
        require(DemoToken(tokenB).transferFrom(msg.sender, pair, amountB), "token B transfer failed");
        liquidity = InsureDexPair(pair).mint(to);
    }

    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin,
        uint256 amountBMin, address to, uint256 deadline)
        external ensure(deadline) returns (uint256 amountA, uint256 amountB)
    {
        address pair = _pair(tokenA, tokenB, false);
        require(InsureDexPair(pair).transferFrom(msg.sender, pair, liquidity), "LP transfer failed");
        (uint256 amount0, uint256 amount1) = InsureDexPair(pair).burn(to);
        (address token0,) = _sort(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin && amountB >= amountBMin, "minimum output not met");
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path,
        address to, uint256 deadline) external ensure(deadline) returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "invalid path");
        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "slippage exceeded");
        address firstPair = _pair(path[0], path[1], false);
        require(DemoToken(path[0]).transferFrom(msg.sender, firstPair, amounts[0]), "input transfer failed");
        for (uint256 i; i < path.length - 1; ++i) {
            (address token0,) = _sort(path[i], path[i + 1]);
            uint256 output = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = path[i] == token0 ? (uint256(0), output) : (output, uint256(0));
            address recipient = i < path.length - 2 ? _pair(path[i + 1], path[i + 2], false) : to;
            InsureDexPair(_pair(path[i], path[i + 1], false)).swap(amount0Out, amount1Out, recipient);
        }
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory amounts) {
        require(path.length >= 2, "invalid path");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; ++i) {
            address pair = _pairView(path[i], path[i + 1]);
            (uint256 reserveIn, uint256 reserveOut) = _reserves(pair, path[i], path[i + 1]);
            uint256 amountInWithFee = amounts[i] * FEE_NUMERATOR;
            amounts[i + 1] = amountInWithFee * reserveOut / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
        }
    }

    function _pair(address tokenA, address tokenB, bool create) internal returns (address pair) {
        pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0) && create) pair = factory.createPair(tokenA, tokenB);
        require(pair != address(0), "pair not found");
    }

    function _pairView(address tokenA, address tokenB) internal view returns (address pair) {
        pair = factory.getPair(tokenA, tokenB);
        require(pair != address(0), "pair not found");
    }

    function _reserves(address pair, address tokenA, address tokenB) internal view returns (uint256 reserveA, uint256 reserveB) {
        InsureDexPair pool = InsureDexPair(pair);
        (uint256 reserve0, uint256 reserve1) = (pool.reserve0(), pool.reserve1());
        (address token0,) = _sort(tokenA, tokenB);
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _sort(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, "identical tokens");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256) {
        require(amountA > 0 && reserveA > 0 && reserveB > 0, "insufficient liquidity");
        return amountA * reserveB / reserveA;
    }
}
