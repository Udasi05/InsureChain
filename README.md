# InsureChain — Life Insurance and DeFi DApp

InsureChain is a student DApp that demonstrates a connected, on-chain life-insurance lifecycle alongside DeFi tools that use the same demo assets and ERC-4626 vault.

## The end-to-end insurance flow

1. An applicant enters sample underwriting values. Circom/snarkjs generates a Groth16 proof in the browser; the raw values stay in that browser.
2. The applicant creates a policy application with public cover amount, premium, beneficiary, and eligibility thresholds. The policy contract verifies the proof and marks the application eligible.
3. The applicant approves the demo USDC premium and activates the policy. The policy contract deposits the premium into the ERC-4626 reserve vault and holds the resulting vINS shares.
4. The active one-year policy can submit a demo benefit request. Only a hash of a demo reference is stored on-chain.
5. A separate deployment account reviews pending requests. Approval withdraws the requested amount from policy-owned reserve shares and pays the recorded beneficiary; a declined claim returns the policy to active status.
6. The dashboard and wallet history show the policy, premium contribution, reserve backing, and claim events.

The deployment seeds the reserve with demo USDC so the claims path can be shown before premiums accumulate. DeFi liquidity, farming, staking, and exchange actions use users' personal test tokens and shares. They do not control policy-owned reserve shares or create real coverage.

## Stack

- React and Vite frontend; Ethers v6 wallet and contract access
- Solidity 0.8.20 contracts compiled and deployed with Hardhat
- Circom and snarkjs browser-side Groth16 proof generation
- Node.js history API that verifies wallet signatures and indexes recognized public contract events
- Demo USDC and RWD, an ERC-4626-style reserve vault, AMM, staking/farm contracts, and DEX router

## Run locally

See [RUN_APPLICATION.md](RUN_APPLICATION.md) and [FEATURE_FLOWS.md](FEATURE_FLOWS.md) for the Windows setup and manual walkthrough. From the repository root:

```powershell
npm.cmd install
npm.cmd run contracts:compile
npx.cmd hardhat node
```

In separate terminals, deploy and start the services:

```powershell
npm.cmd run deploy:local
npm.cmd run dev:backend
npm.cmd run dev
```

The deploy script writes `public/deployments/<chainId>.json`. Because the policy contract now depends on the USDC asset and reserve vault, restart the local chain and redeploy after pulling this version. The deployment account is also the claims administrator. For a full role-separated claim demo, connect a second Hardhat account as the applicant, then switch back to the deployment account to review the request.

Set `VITE_WALLETCONNECT_PROJECT_ID` in `.env.local` to enable WalletConnect. The optional history backend binds to `127.0.0.1:3001` and stores a rebuildable event index under `backend/data/`.

## Contract groups

| Area | Contracts | Role in the DApp |
|---|---|---|
| Insurance | `LifeInsurancePolicy`, `Groth16Verifier` | Eligibility, premium-funded activation, policy term, claim request and admin payout |
| Reserve | `DemoToken`, `InsureReserveVault` | Demo USDC premiums become vINS shares held by the policy contract; personal deposits mint wallet-owned shares |
| Liquidity | `SimpleAMM`, `InsureDexPair`, `InsureDexFactory`, `InsureDexRouter` | Personal demo token liquidity and swaps |
| Rewards | `SimpleYieldFarm`, `SimpleStaking` | Funded RWD reward demonstrations for LP tokens and personal vINS |

## Important limits

This is an educational simulation, not real insurance or an audited financial system. The proof establishes only that user-supplied demo values satisfy the circuit predicate; it does not authenticate identity or data. Claims are admin-reviewed demo requests without real evidence verification. Reserve funding, premiums, and benefits use test tokens with no real-world value. Never enter real medical, identity, or financial data.

The proving WASM, final zkey, circuit, and generated Solidity verifier must remain a matching set. A circuit change requires regenerating and replacing all artifacts before redeployment.
