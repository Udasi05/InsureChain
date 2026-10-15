# InsureChain contracts

## Insurance eligibility

- `LifeInsurancePolicy.sol` owns the pending-to-active eligibility record flow.
- `IZKPVerifier.sol` is the generated verifier interface.
- `Groth16Verifier.sol` is generated from the circuit's matching proving setup. Keep it matched to the browser WASM and final zkey.

## Experiment contracts

- Experiment 3: `DemoToken.sol` and `InsureReserveVault.sol` provide the mock asset and ERC-4626-style share lifecycle.
- Experiment 4: `SimpleAMM.sol` shows constant-product swaps and a transferable LP-share ledger.
- Experiment 5: `SimpleYieldFarm.sol` stakes the Experiment 4 LP shares; `SimpleStaking.sol` directly stakes vINS. Both accrue a funded reward token over time.
- Experiment 6: `InsureDexFactory.sol` creates `InsureDexPair.sol` pools; `InsureDexRouter.sol` offers liquidity and token-path swaps with a 0.30% fee, deadline, and minimum output.

These contracts are classroom implementations. They have not been audited and must not be used with real assets.
