# Run InsureChain locally (Windows)

## Prerequisites

- Node.js LTS and npm
- MetaMask (or another EIP-1193 injected EVM wallet)
- WalletConnect Cloud project ID (only if demonstrating QR/mobile wallet connection)
- PowerShell

MongoDB and the Express authentication server are no longer part of this project. The DApp uses the connected wallet as the actor identity.

## Install and compile

From the repository root:

```powershell
npm.cmd install
npm.cmd run contracts:compile
```

## Start the local chain

In a separate terminal, leave the local Hardhat node running:

```powershell
npx.cmd hardhat node
```

Add a custom network to MetaMask:

| Setting | Value |
|---|---|
| Network name | InsureChain Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency | ETH |

Import one of the accounts printed by Hardhat. These accounts are for the local chain only.

For WalletConnect, add `VITE_WALLETCONNECT_PROJECT_ID=your_project_id` to `.env.local` and restart Vite. Mobile wallets need to reach the configured RPC. A phone's `127.0.0.1` is the phone itself, so use a reachable development LAN RPC or configure Sepolia instead of the local RPC for QR demonstrations.

## Deploy the experiment contracts

In a third terminal:

```powershell
npm.cmd run deploy:local
```

The script deploys the proof verifier and policy contract, demo tokens, vault, Experiment 4 AMM, Experiment 6 factory/router, and both Experiment 5 reward contracts. It funds the reward schedules and writes their addresses to `public/deployments/31337.json`.

The local node is in-memory. If it stops, restart it and redeploy; the new node has no previous contract state.

### Optional Sepolia deployment

Set `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` in the shell environment, then run `npm.cmd run deploy:sepolia`. Keep the key private and fund that account with Sepolia test ETH. Configure Vite with `VITE_CHAIN_ID=11155111`, a public `VITE_RPC_URL`, and the WalletConnect project ID before starting the frontend.

## Start the frontend

```powershell
npm.cmd run dev
```

Open the Vite URL, connect MetaMask or WalletConnect, and use the experiment navigation. The demo USDC faucet can mint up to 1,000 tokens per call to any connected wallet.

### Insurance proof flow

The default values satisfy the example thresholds. The browser generates a Groth16 proof from `public/zkp/LifeInsuranceEligibility.wasm` and `public/zkp/LifeInsuranceEligibility_final.zkey`, creates a pending policy, then submits the proof. Only public thresholds and proof data go to the contract. The inputs in the form are demonstration data, not verified external records.

### DeFi flow

1. Mint demo USDC.
2. Deposit it into the vault to receive vINS shares.
3. Add demo USDC and vINS liquidity to the simple AMM or DEX pair.
4. Stake SimpleAMM LP shares in the yield farm, or stake vINS in the separate direct-staking contract.
5. Claim rewards or exit the position.

The DEX swap screen demonstrates the router's two-token path. The router contract accepts multi-hop token paths; a multi-hop UI selector is not yet exposed.

## ZKP setup (only after circuit changes)

Install the native Circom CLI, then run:

```powershell
npm.cmd run zkp:setup
npm.cmd run zkp:prove
npm.cmd run zkp:verify
```

Copy the generated matching WASM and final zkey into `public/zkp/`, then recompile and redeploy. A local setup is for teaching and development, not production use.
