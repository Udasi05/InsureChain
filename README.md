# InsureChain — Life Insurance Eligibility and DeFi Experiments

InsureChain is a student demonstration DApp with two connected learning tracks:

1. **Insurance eligibility:** a browser-generated Circom/Groth16 proof demonstrates that private example values meet public policy thresholds. The Solidity policy contract verifies the proof and records the result.
2. **DeFi experiments:** faucet-style demo tokens flow through an ERC-4626-style vault, a simple constant-product AMM, LP-token yield farming, direct vault-share staking, and a Pair/Factory/Router DEX.

The insurance and DeFi demonstrations are separate contract systems. Vault shares are not insurance coverage, and the demo tokens and rewards have no real-world value. Do not use real medical, financial, or identity information.

## Stack

- React and Vite for the interface
- Ethers v6 and an EIP-1193 wallet provider for chain interaction
- Solidity 0.8.20 and Hardhat for contracts and local EVM
- Circom and snarkjs for browser-side Groth16 proving
- The generated `Groth16Verifier.sol` corresponding to the checked-in circuit artifacts

## Run locally

See [RUN_APPLICATION.md](RUN_APPLICATION.md) for the step-by-step Windows setup. In brief:

```powershell
npm.cmd install
npm.cmd run contracts:compile
npx.cmd hardhat node
```

In another terminal deploy to the local node and start Vite:

```powershell
npm.cmd run deploy:local
npm.cmd run dev
```

The deploy script writes `public/deployments/<chainId>.json`, which the frontend reads. The app supports MetaMask/injected wallets and WalletConnect QR/mobile sessions. Set `VITE_WALLETCONNECT_PROJECT_ID` in `.env.local` to use WalletConnect. A phone cannot normally reach a desktop's `127.0.0.1` RPC; for local QR use a reachable LAN RPC, or use Sepolia.

## Contract groups

| Experiment | Contracts | Demonstration |
|---|---|---|
| Insurance core | `LifeInsurancePolicy`, `Groth16Verifier` | Private eligibility proof and on-chain activation |
| 3 | `DemoToken`, `InsureReserveVault` | Demo asset deposit, share issue, redeem |
| 4 | `SimpleAMM` | Constant-product pool, swaps, LP shares |
| 5A | `SimpleYieldFarm` | Stake SimpleAMM LP shares for funded RWD rewards |
| 5B | `SimpleStaking` | Stake vault shares in a separate reward flow |
| 6 | `InsureDexPair`, `InsureDexFactory`, `InsureDexRouter` | Pair-based liquidity and routed swaps |

## Proof artifact consistency

The browser WASM and final zkey in `public/zkp/` must match the circuit and Solidity verifier. If the circuit changes, regenerate the setup and replace the browser artifacts and verifier together before redeploying. Local development setup is not a production trusted ceremony.

## Scope note

Policy activation is an eligibility demonstration only. The contracts do not collect insurance premiums, issue a regulated policy, authenticate external medical/financial records, adjudicate death claims, or make insurance payouts. DeFi rewards are funded demonstration schedules, not investment promises.
