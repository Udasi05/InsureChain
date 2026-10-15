// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DemoToken.sol";

/// @notice Experiment 5A: stake Experiment 4 LP shares to earn a demo reward.
contract SimpleYieldFarm {
    DemoToken public immutable stakingToken;
    DemoToken public immutable rewardToken;
    address public immutable owner;
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    uint256 private constant PRECISION = 1e18;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardPeriodFunded(uint256 amount, uint256 duration, uint256 rewardRate);

    constructor(address lpToken, address rewardTokenAddress) {
        require(lpToken != address(0) && rewardTokenAddress != address(0), "invalid token");
        stakingToken = DemoToken(lpToken);
        rewardToken = DemoToken(rewardTokenAddress);
        owner = msg.sender;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = _lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function lastTimeRewardApplicable() external view returns (uint256) { return _lastTimeRewardApplicable(); }
    function _lastTimeRewardApplicable() internal view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (_lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * PRECISION / totalSupply;
    }

    function earned(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / PRECISION + rewards[account];
    }

    function fundRewards(uint256 amount, uint256 duration) external updateReward(address(0)) {
        require(msg.sender == owner, "not owner");
        require(amount > 0 && duration > 0, "invalid reward period");
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "reward transfer failed");
        uint256 remaining = block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate : 0;
        rewardRate = (amount + remaining) / duration;
        require(rewardRate > 0, "reward rate too small");
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardPeriodFunded(amount, duration, rewardRate);
    }

    function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "cannot stake zero");
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "stake transfer failed");
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public updateReward(msg.sender) {
        require(amount > 0 && balanceOf[msg.sender] >= amount, "invalid withdrawal");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        require(stakingToken.transfer(msg.sender, amount), "stake transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            require(rewardToken.transfer(msg.sender, reward), "reward transfer failed");
            emit RewardPaid(msg.sender, reward);
        }
    }

    function harvest() external { getReward(); }
    function exit() external { if (balanceOf[msg.sender] > 0) withdraw(balanceOf[msg.sender]); getReward(); }
}
