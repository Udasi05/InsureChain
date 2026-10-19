// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IZKPVerifier.sol";
import "./DemoToken.sol";
import "./InsureReserveVault.sol";

/// @notice Educational life-insurance lifecycle connected to a demo reserve.
/// @dev User supplied demo inputs are not trusted underwriting evidence. This
///      contract and its test assets are not suitable for real insurance.
contract LifeInsurancePolicy {
    enum Status { None, Pending, Verified, Active, ClaimPending, ClaimPaid, Expired, Rejected }

    struct Policy {
        address holder;
        uint256 createdAt;
        uint256 activatedAt;
        uint256 expiresAt;
        uint256 minIncome;
        uint256 minCreditScore;
        uint256 maxMedicalRisk;
        uint256 coverageAmount;
        uint256 premiumAmount;
        address beneficiary;
        Status status;
    }

    struct Claim {
        uint256 amount;
        uint256 requestedAt;
        bytes32 evidenceHash;
        bool resolved;
        bool approved;
    }

    uint256 public constant POLICY_TERM = 365 days;
    IZKPVerifier public immutable verifier;
    DemoToken public immutable premiumToken;
    InsureReserveVault public immutable reserveVault;
    address public immutable claimsAdmin;
    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => Claim) public claims;
    mapping(address => uint256[]) private policyIdsByHolder;

    event PolicyCreated(
        uint256 indexed policyId,
        address indexed holder,
        uint256 minIncome,
        uint256 minCreditScore,
        uint256 maxMedicalRisk,
        uint256 coverageAmount,
        uint256 premiumAmount,
        address beneficiary
    );
    event EligibilityVerified(uint256 indexed policyId, address indexed holder);
    event PolicyActivated(uint256 indexed policyId, address indexed holder);
    event PremiumPaid(uint256 indexed policyId, address indexed holder, uint256 premium, uint256 reserveShares);
    event ClaimSubmitted(uint256 indexed policyId, address indexed holder, address indexed beneficiary, uint256 amount, bytes32 evidenceHash);
    event ClaimPaid(uint256 indexed policyId, address indexed holder, address indexed beneficiary, uint256 amount);
    event ClaimRejected(uint256 indexed policyId, address indexed holder, address indexed beneficiary, uint256 amount);

    constructor(address verifierAddress, address assetAddress, address vaultAddress) {
        require(verifierAddress != address(0) && assetAddress != address(0) && vaultAddress != address(0), "invalid address");
        verifier = IZKPVerifier(verifierAddress);
        premiumToken = DemoToken(assetAddress);
        reserveVault = InsureReserveVault(vaultAddress);
        require(address(reserveVault.asset()) == assetAddress, "vault asset mismatch");
        claimsAdmin = msg.sender;
    }

    function createPolicy(
        uint256 minIncome,
        uint256 minCreditScore,
        uint256 maxMedicalRisk,
        uint256 coverageAmount,
        uint256 premiumAmount,
        address beneficiary
    ) external returns (uint256 policyId) {
        require(coverageAmount > 0 && premiumAmount > 0, "invalid policy amounts");
        require(beneficiary != address(0), "invalid beneficiary");
        policyId = ++nextPolicyId;
        policies[policyId] = Policy({
            holder: msg.sender,
            createdAt: block.timestamp,
            activatedAt: 0,
            expiresAt: 0,
            minIncome: minIncome,
            minCreditScore: minCreditScore,
            maxMedicalRisk: maxMedicalRisk,
            coverageAmount: coverageAmount,
            premiumAmount: premiumAmount,
            beneficiary: beneficiary,
            status: Status.Pending
        });
        policyIdsByHolder[msg.sender].push(policyId);
        emit PolicyCreated(policyId, msg.sender, minIncome, minCreditScore, maxMedicalRisk, coverageAmount, premiumAmount, beneficiary);
    }

    function submitEligibilityProof(
        uint256 policyId,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[4] calldata publicSignals
    ) external {
        Policy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "not policy holder");
        require(policy.status == Status.Pending, "policy not pending");
        require(publicSignals[0] == 1, "applicant is not eligible");
        require(publicSignals[1] == policy.minIncome, "income threshold mismatch");
        require(publicSignals[2] == policy.minCreditScore, "credit threshold mismatch");
        require(publicSignals[3] == policy.maxMedicalRisk, "medical threshold mismatch");
        require(verifier.verifyProof(a, b, c, publicSignals), "invalid ZK proof");
        policy.status = Status.Verified;
        emit EligibilityVerified(policyId, msg.sender);
    }

    /// @notice Collect the demo premium and deposit it into the linked reserve vault.
    function purchasePolicy(uint256 policyId) external returns (uint256 reserveShares) {
        Policy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "not policy holder");
        require(policy.status == Status.Verified, "eligibility not verified");
        require(premiumToken.transferFrom(msg.sender, address(this), policy.premiumAmount), "premium transfer failed");
        require(premiumToken.approve(address(reserveVault), policy.premiumAmount), "vault approval failed");
        reserveShares = reserveVault.deposit(policy.premiumAmount, address(this));
        policy.activatedAt = block.timestamp;
        policy.expiresAt = block.timestamp + POLICY_TERM;
        policy.status = Status.Active;
        emit PremiumPaid(policyId, msg.sender, policy.premiumAmount, reserveShares);
        emit PolicyActivated(policyId, msg.sender);
    }

    /// @notice Submit a demo claim. Only the evidence hash is stored on-chain.
    function submitClaim(uint256 policyId, uint256 amount, bytes32 evidenceHash) external {
        Policy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "not policy holder");
        require(policy.status == Status.Active, "policy not active");
        require(block.timestamp <= policy.expiresAt, "policy expired");
        require(amount > 0 && amount <= policy.coverageAmount, "claim exceeds coverage");
        require(evidenceHash != bytes32(0), "missing claim reference");
        claims[policyId] = Claim({ amount: amount, requestedAt: block.timestamp, evidenceHash: evidenceHash, resolved: false, approved: false });
        policy.status = Status.ClaimPending;
        emit ClaimSubmitted(policyId, msg.sender, policy.beneficiary, amount, evidenceHash);
    }

    /// @notice Demo claims administrator pays an approved benefit from policy-owned reserve shares.
    function approveClaim(uint256 policyId) external {
        require(msg.sender == claimsAdmin, "not claims administrator");
        Policy storage policy = policies[policyId];
        Claim storage claim = claims[policyId];
        require(msg.sender != policy.holder, "cannot review own policy");
        require(policy.status == Status.ClaimPending && !claim.resolved, "claim not pending");
        uint256 sharesNeeded = reserveVault.previewWithdraw(claim.amount);
        require(reserveVault.balanceOf(address(this)) >= sharesNeeded, "insurance reserve underfunded");
        reserveVault.withdraw(claim.amount, policy.beneficiary, address(this));
        claim.resolved = true;
        claim.approved = true;
        policy.status = Status.ClaimPaid;
        emit ClaimPaid(policyId, policy.holder, policy.beneficiary, claim.amount);
    }

    /// @notice Reject a demo claim and keep the policy active until its term ends.
    function rejectClaim(uint256 policyId) external {
        require(msg.sender == claimsAdmin, "not claims administrator");
        Policy storage policy = policies[policyId];
        Claim storage claim = claims[policyId];
        require(msg.sender != policy.holder, "cannot review own policy");
        require(policy.status == Status.ClaimPending && !claim.resolved, "claim not pending");
        claim.resolved = true;
        claim.approved = false;
        policy.status = block.timestamp <= policy.expiresAt ? Status.Active : Status.Expired;
        emit ClaimRejected(policyId, policy.holder, policy.beneficiary, claim.amount);
    }

    function reserveBalance() external view returns (uint256) {
        return reserveVault.convertToAssets(reserveVault.balanceOf(address(this)));
    }

    function getPolicyIds(address holder) external view returns (uint256[] memory) {
        return policyIdsByHolder[holder];
    }

    function policyStatus(uint256 policyId) external view returns (Status) {
        Policy storage policy = policies[policyId];
        if (policy.status == Status.Active && block.timestamp > policy.expiresAt) return Status.Expired;
        return policy.status;
    }
}
