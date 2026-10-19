const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function deploy(name, ...args) {
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return contract;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chain = await hre.ethers.provider.getNetwork();
  const deploymentBlock = await hre.ethers.provider.getBlockNumber();
  const parse = hre.ethers.parseEther;
  console.log(`Deploying InsureChain insurance and DeFi contracts on chain ${chain.chainId} with ${deployer.address}`);

  const verifier = await deploy("Groth16Verifier");
  const mockUSDC = await deploy("DemoToken", "Demo USDC", "mUSDC", parse("10000000"), true);
  const rewardToken = await deploy("DemoToken", "Insure Reward", "RWD", parse("1000000"), false);
  const vaultShares = await deploy("InsureReserveVault", await mockUSDC.getAddress());
  const policy = await deploy("LifeInsurancePolicy", await verifier.getAddress(), await mockUSDC.getAddress(), await vaultShares.getAddress());

  // Seed the shared insurance reserve with demo capital so the claim-review
  // lifecycle can be demonstrated before a large premium pool has accumulated.
  const initialInsuranceReserve = parse("100000");
  await (await mockUSDC.approve(await vaultShares.getAddress(), initialInsuranceReserve)).wait();
  await (await vaultShares.deposit(initialInsuranceReserve, await policy.getAddress())).wait();

  const simpleAMM = await deploy("SimpleAMM", await mockUSDC.getAddress(), await vaultShares.getAddress());
  const dexFactory = await deploy("InsureDexFactory");
  const dexRouter = await deploy("InsureDexRouter", await dexFactory.getAddress(), hre.ethers.ZeroAddress);
  const yieldFarm = await deploy("SimpleYieldFarm", await simpleAMM.getAddress(), await rewardToken.getAddress());
  const staking = await deploy("SimpleStaking", await vaultShares.getAddress(), await rewardToken.getAddress());

  const rewardPerPool = parse("100000");
  const rewardPeriod = 365 * 24 * 60 * 60;
  await (await rewardToken.approve(await yieldFarm.getAddress(), rewardPerPool)).wait();
  await (await yieldFarm.fundRewards(rewardPerPool, rewardPeriod)).wait();
  await (await rewardToken.approve(await staking.getAddress(), rewardPerPool)).wait();
  await (await staking.fundRewards(rewardPerPool, rewardPeriod)).wait();

  const registry = {
    chainId: chain.chainId.toString(),
    deploymentBlock,
    deployer: deployer.address,
    verifier: await verifier.getAddress(),
    policy: await policy.getAddress(),
    mockUSDC: await mockUSDC.getAddress(),
    rewardToken: await rewardToken.getAddress(),
    vaultShares: await vaultShares.getAddress(),
    simpleAMM: await simpleAMM.getAddress(),
    dexFactory: await dexFactory.getAddress(),
    dexRouter: await dexRouter.getAddress(),
    yieldFarm: await yieldFarm.getAddress(),
    staking: await staking.getAddress(),
  };
  const registryDirectory = path.join(__dirname, "..", "public", "deployments");
  fs.mkdirSync(registryDirectory, { recursive: true });
  const registryPath = path.join(registryDirectory, `${chain.chainId}.json`);
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`Deployment registry written to ${registryPath}`);

  // Node 24 on Windows can assert in libuv if Hardhat exits immediately after
  // completing async RPC/file work. Let pending native handles settle first.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
