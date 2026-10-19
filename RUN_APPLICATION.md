# Run InsureChain locally (Windows)

## Prerequisites

- Node.js LTS and npm
- MetaMask (or another EIP-1193 injected EVM wallet)
- WalletConnect Cloud project ID (only if demonstrating QR/mobile wallet connection)
- PowerShell

The contracts remain the source of truth for policy status and asset balances. A small optional Node backend provides wallet-authenticated dashboard history by indexing public events from the deployed DApp contracts. It does not store private eligibility inputs, and users authenticate to it with a message signature rather than an on-chain transaction.

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

## Deploy the application contracts

In a third terminal:

```powershell
npm.cmd run deploy:local
```

The script deploys the proof verifier, demo tokens, reserve vault, insurance policy, AMM, factory/router, and reward contracts. It seeds 100,000 demo USDC into the reserve as vINS shares owned by the policy contract, funds the reward schedules, and writes contract addresses, deployment account, and deployment block to `public/deployments/31337.json`.

For a complete claims demo, use Hardhat account 1 as the applicant and account 0 as the claims administrator. The administrator cannot approve a claim on its own policy. Both accounts need local test ETH; the applicant can mint demo USDC through the faucet.

The local node is in-memory. If it stops, restart it and redeploy; the new node has no previous contract state.

### Optional Sepolia deployment

Set `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` in the shell environment, then run `npm.cmd run deploy:sepolia`. Keep the key private and fund that account with Sepolia test ETH. Configure Vite with `VITE_CHAIN_ID=11155111`, a public `VITE_RPC_URL`, and the WalletConnect project ID before starting the frontend.

## Start the history backend

In another terminal from the repository root:

```powershell
npm.cmd run dev:backend
```

It listens on `http://127.0.0.1:3001`. Check `http://127.0.0.1:3001/api/health` for RPC status. It scans confirmed contract logs and stores its index under `backend/data/`. History is chain-specific and local by default. A dashboard user presses **Enable private history**, signs a readable message, and the backend returns only events associated with that wallet. The token is held in the browser session memory; after a reload the user signs again.

## Start the frontend

```powershell
npm.cmd run dev
```

Open the Vite URL and connect MetaMask or WalletConnect. The demo USDC faucet can mint up to 1,000 tokens per call to any connected wallet.

### Insurance proof flow

The default values satisfy the example thresholds. The browser generates a Groth16 proof from `public/zkp/LifeInsuranceEligibility.wasm` and `public/zkp/LifeInsuranceEligibility_final.zkey`, creates an application, and submits the proof. After eligibility is verified, approve the quoted demo USDC premium to activate one-year cover. Premiums are deposited into the reserve vault; the policy contract holds the resulting vINS shares. The policyholder can submit a demo benefit request with a reference hashed in the browser. Switch to the deployment account to approve or decline claims. Only public thresholds, cover terms, proof, and claim reference hash are on-chain; never enter real medical or identity data.

See [FEATURE_FLOWS.md](FEATURE_FLOWS.md) for test-style steps, expected results, and the purpose of every feature, including the reserve vault and both direct and multi-hop DEX swaps.

## ZKP setup (only after circuit changes)

Install the native Circom CLI, then run:

```powershell
npm.cmd run zkp:setup
npm.cmd run zkp:prove
npm.cmd run zkp:verify
```

Copy the generated matching WASM and final zkey into `public/zkp/`, then recompile and redeploy. A local setup is for teaching and development, not production use.
