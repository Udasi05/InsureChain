export async function generateEligibilityProof(input) {
  const snarkjs = await import("snarkjs");
  return snarkjs.groth16.fullProve(
    input,
    "/zkp/LifeInsuranceEligibility.wasm",
    "/zkp/LifeInsuranceEligibility_final.zkey",
  );
}
