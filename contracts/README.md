# InsureChain contract map

## Insurance lifecycle

- `LifeInsurancePolicy.sol` stores public policy terms and enforces the application → proof verified → premium paid → active → claim review → benefit paid/declined flow.
- `Groth16Verifier.sol` verifies the generated proof; `IZKPVerifier.sol` is the policy contract's interface.
- `LifeInsurancePolicy` takes demo USDC premiums and deposits them into `InsureReserveVault`, holding the minted vINS shares. The deployment seeds additional demo reserve shares so benefit payment can be demonstrated.
- The deployment account is the claims administrator. It can approve or decline requests from other policyholders, but it cannot review its own policy.

## DeFi tools

- `DemoToken.sol` provides demo USDC and RWD.
- `InsureReserveVault.sol` implements the ERC-4626-style deposit, mint, withdraw, redeem, and share conversion lifecycle.
- `SimpleAMM.sol` provides personal demo token swaps and transferable LP shares.
- `SimpleYieldFarm.sol` stakes AMM LP shares for funded RWD rewards; `SimpleStaking.sol` separately stakes personal vINS.
- `InsureDexPair.sol`, `InsureDexFactory.sol`, and `InsureDexRouter.sol` provide factory-created pairs, liquidity, and routed swaps.

## Deployment

`scripts/deploy.cjs` deploys the verifier, demo tokens, reserve vault, and insurance policy in dependency order. It funds the vault with 100,000 demo USDC in policy-owned shares, deploys the DeFi contracts, funds reward schedules, and writes a chain-specific registry to `public/deployments/`.

Changing the insurance contract constructor requires a fresh deployment. Local Hardhat networks are in-memory; restart the node and redeploy to get a clean state.

These contracts are classroom code, unaudited, and not suitable for real insurance or financial assets. The proof is only about user-entered demo values; claim review is an administrator-controlled simulation.
