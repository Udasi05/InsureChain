# InsureChain: complete DApp flow and walkthrough

InsureChain demonstrates one connected life-insurance lifecycle plus DeFi tools that use personal demo assets and the same vault share token. It is a classroom prototype: no real insurer, identity provider, underwriting data source, claims evidence service, or real money is involved.

## 1. Start the local system

From `D:\Projects\life-insurance-blockchain`, use four PowerShell terminals:

1. Install dependencies: `npm.cmd install`.
2. Start the chain: `npx.cmd hardhat node`.
3. Deploy: `npm.cmd run deploy:local`. This deploys the verifier, demo assets, reserve vault, policy contract, and DeFi contracts; seeds the insurance reserve with 100,000 demo USDC; funds reward schedules; and writes `public/deployments/31337.json`.
4. Start the history API: `npm.cmd run dev:backend`.
5. Start the website: `npm.cmd run dev`.
6. Add the Hardhat network in MetaMask (`http://127.0.0.1:8545`, chain ID `31337`, currency `ETH`). Use the private keys printed by the local node only on this disposable chain.

The deployment account is the claims administrator. Use Hardhat account 1 as the policyholder and account 0 as the administrator for the end-to-end claims walkthrough. A reviewer cannot approve a claim on their own policy. Fund the applicant with test ETH and mint demo USDC through the website's faucet before purchasing a policy.

If the local chain is restarted, redeploy because its contracts and state are in memory. Redeployments replace the contract addresses and reset the demo history source.

## 2. Full life-insurance journey

### Step A — apply and prove eligibility

1. Connect the applicant wallet and open **Life insurance policy**.
2. Use sample values (the defaults pass the demo circuit). Set a demo benefit, premium, and beneficiary address. The term is one year.
3. Select **Create application and verify eligibility**.
4. The browser generates the Groth16 proof locally. Confirm the wallet transaction that creates the policy application, then confirm the transaction that submits the proof.
5. The policy status becomes **Eligible · premium due**. Private example inputs are not written to the policy contract. Public thresholds, cover, premium, and beneficiary are recorded.

### Step B — pay premium and activate cover

1. If needed, open **Reserve Vault** and mint demo USDC using the faucet. A call mints up to 1,000 demo USDC.
2. Return to the policy page. On the eligible policy, select **Approve premium and activate**.
3. Approve demo USDC for the policy contract, then confirm the purchase transaction.
4. The policy contract deposits the premium into the ERC-4626 reserve vault and receives vINS shares. It holds those shares, so they are separate from the policyholder's personal vault shares.
5. The status becomes **Active** for one year. Home and Reserve Vault show total vault assets and the portion backing insurance benefits.

### Step C — submit a demo claim

1. While connected as the policyholder, select an active policy, enter a requested benefit no greater than its cover amount, and enter a short demo reference such as `demo-case-001`.
2. Select **Submit claim for review** and confirm the transaction.
3. The browser hashes the reference before sending it. The chain stores the hash, amount, policy, holder, and beneficiary—not the reference text or sensitive evidence.
4. The policy becomes **Claim under review**.

### Step D — review and pay or decline

1. Switch MetaMask to the deployment account (Hardhat account 0, the claims administrator).
2. Open **Life insurance policy**. The **Reserve administrator review** queue lists requests from other wallets and shows the requested amount, holder, beneficiary, and reference hash.
3. Choose **Approve and pay**. The policy contract checks that its vINS shares can cover the amount, withdraws the demo USDC from the reserve vault, and sends it to the policy's recorded beneficiary. The policy becomes **Benefit paid**.
4. Alternatively, choose **Decline claim**. The policy returns to active until expiry, and the policyholder can submit another demo request.
5. Switch back to the applicant wallet to see the updated policy and refresh signed history.

### Step E — inspect the audit trail

1. On Home, select **Enable private history** and sign the readable wallet challenge. This is an off-chain signature, not a transaction.
2. The backend verifies wallet ownership and indexes recognized events from this deployment. It never receives the raw eligibility values or claim reference text.
3. Home shows the overall activity. The Insurance panel filters application, proof, premium, activation, and claim events. Policy records show the current state.
4. Switch wallet accounts and connect again; the website clears the previous wallet's data.

## 3. Where the DeFi features fit

Insurance premiums are deposited into the ERC-4626 vault and the policy contract holds those reserve shares. The deployment also seeds policy-owned shares so a small demo premium can still demonstrate a benefit payment. Users' own deposits mint shares to their wallets. The AMM, yield farm, direct staking, and DEX operate on personal demo balances; none can spend or withdraw the insurance contract's reserve shares. This makes the reserve connection real and inspectable while keeping DeFi activities from silently changing policy backing.

### Personal reserve vault

1. Mint demo USDC if needed.
2. Deposit assets to receive personal vINS, mint an exact amount of shares, withdraw assets, or redeem shares.
3. Compare personal shares with the insurance-owned reserve backing in the same screen.

### Liquidity pool

1. Hold demo USDC and personal vINS.
2. Add both assets to the SimpleAMM, then inspect reserves and LP shares.
3. Swap a small amount or remove some LP shares. This uses personal wallet assets, not insurance-owned shares.

### Yield farming and direct staking

- **Yield Farming:** stake SimpleAMM LP shares and claim funded RWD rewards.
- **Staking:** stake personal vINS shares in a different contract and claim its separately funded RWD rewards.

These reward schedules are demo mechanisms, not policy returns or guaranteed yields.

### Token exchange

The DEX factory creates token pairs; its router adds/removes personal liquidity and performs direct or multi-hop swaps. Seed the needed pairs before trying a route. The DEX does not route premiums or claims.

## 4. What the proof and backend do

- The browser uses Circom/snarkjs and `public/zkp/` artifacts to create a Groth16 proof.
- The verifier checks the proof against public thresholds. This proves a circuit statement about values entered by the user, not the values' real-world source or accuracy.
- `LifeInsurancePolicy` records the application and policy lifecycle, collects the demo premium, holds reserve shares, and enforces the claims-admin role.
- `InsureReserveVault` tracks the underlying demo USDC and ERC-4626-style vINS shares.
- The backend is a signed-wallet history indexer. It does not execute transactions or store private application data.

## 5. Boundaries to state in a presentation

- No real policy is issued and no real insurance coverage is promised.
- The circuit has no trusted source for income, credit, or risk data. Do not enter real sensitive information.
- The claims administrator reviews a demo request; there is no real death verification, document adjudication, oracle, or external reviewer.
- The reserve has demo seed capital and demo premiums. It is not audited, risk-priced, or adequate for real claims.
- Demo tokens, vault shares, AMM positions, DEX trades, and rewards have no real-world value. DeFi features do not change policy reserve assets.
- Local history covers recognized events from this DApp deployment, not every transaction a wallet has made.
