// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DemoToken.sol";

/// @notice Experiment 5B: direct vault-share staking, separate from LP farming.
contract SimpleStaking {
    DemoToken public immutable stakingToken;
    DemoToken public immutable rewardToken;
    address public immutable owner;
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalStaked;
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public accruedRewards;
    uint256 private constant PRECISION = 1e18;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardsFunded(uint256 amount, uint256 duration, uint256 rewardRate);

    constructor(address vaultShares, address rewards) {
        require(vaultShares != address(0) && rewards != address(0), "invalid token");
        stakingToken = DemoToken(vaultShares);
        rewardToken = DemoToken(rewards);
        owner = msg.sender;
    }

    modifier update(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = _lastTime();
        if (account != address(0)) {
            accruedRewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }
    function _lastTime() internal view returns (uint256) { return block.timestamp < periodFinish ? block.timestamp : periodFinish; }
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (_lastTime() - lastUpdateTime) * rewardRate * PRECISION / totalStaked;
    }
    function earned(address account) public view returns (uint256) {
        return stakedBalance[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / PRECISION + accruedRewards[account];
    }

    function fundRewards(uint256 amount, uint256 duration) external update(address(0)) {
        require(msg.sender == owner, "not owner");
        require(amount > 0 && duration > 0, "invalid reward period");
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "reward transfer failed");
        uint256 leftover = block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate : 0;
        rewardRate = (amount + leftover) / duration;
        require(rewardRate > 0, "reward rate too small");
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardsFunded(amount, duration, rewardRate);
    }

    function stake(uint256 amount) external update(msg.sender) {
        require(amount > 0, "cannot stake zero");
        totalStaked += amount;
        stakedBalance[msg.sender] += amount;
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "stake transfer failed");
        emit Staked(msg.sender, amount);
    }
    function unstake(uint256 amount) public update(msg.sender) {
        require(amount > 0 && stakedBalance[msg.sender] >= amount, "invalid unstake");
        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;
        require(stakingToken.transfer(msg.sender, amount), "stake transfer failed");
        emit Unstaked(msg.sender, amount);
    }
    function claimReward() public update(msg.sender) {
        uint256 reward = accruedRewards[msg.sender];
        if (reward > 0) {
            accruedRewards[msg.sender] = 0;
            require(rewardToken.transfer(msg.sender, reward), "reward transfer failed");
            emit RewardClaimed(msg.sender, reward);
        }
    }
    function exit() external { if (stakedBalance[msg.sender] > 0) unstake(stakedBalance[msg.sender]); claimReward(); }
}
