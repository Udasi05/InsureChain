import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { ShieldCheck, Wallet, RefreshCw, ArrowRightLeft, Coins, Layers3, CircleDollarSign, LockKeyhole, Landmark, TrendingUp, ArrowRight, BadgeCheck, Activity, Sparkles } from "lucide-react";
import { generateEligibilityProof } from "./services/zkp";

const TOKEN_ABI = [
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)", "function mint(address,uint256)",
];
const VAULT_ABI = [...TOKEN_ABI,
  "function asset() view returns (address)", "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)", "function convertToShares(uint256) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)", "function previewDeposit(uint256) view returns (uint256)",
  "function deposit(uint256,address) returns (uint256)", "function mint(uint256,address) returns (uint256)",
  "function withdraw(uint256,address,address) returns (uint256)", "function redeem(uint256,address,address) returns (uint256)",
];
const AMM_ABI = [
  "function reserveA() view returns (uint256)", "function reserveB() view returns (uint256)",
  "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)",
  "function addLiquidity(uint256,uint256,uint256) returns (uint256)", "function removeLiquidity(uint256,uint256,uint256) returns (uint256,uint256)",
  "function swapExactAForB(uint256,uint256) returns (uint256)", "function swapExactBForA(uint256,uint256) returns (uint256)",
  "function getAmountOut(uint256,uint256,uint256) view returns (uint256)",
];
const FARM_ABI = [
  "function balanceOf(address) view returns (uint256)", "function earned(address) view returns (uint256)",
  "function stakingToken() view returns (address)", "function rewardToken() view returns (address)",
  "function stake(uint256)", "function withdraw(uint256)", "function getReward()", "function harvest()", "function exit()",
];
const STAKING_ABI = [
  "function stakedBalance(address) view returns (uint256)", "function earned(address) view returns (uint256)",
  "function stakingToken() view returns (address)", "function rewardToken() view returns (address)",
  "function stake(uint256)", "function unstake(uint256)", "function claimReward()", "function exit()",
];
const FACTORY_ABI = ["function getPair(address,address) view returns (address)", "function createPair(address,address) returns (address)"];
const PAIR_ABI = ["function reserve0() view returns (uint256)", "function reserve1() view returns (uint256)", "function token0() view returns (address)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const ROUTER_ABI = [
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
  "function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256) returns (uint256,uint256)",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
];
const POLICY_ABI = [
  "function createPolicy(uint256,uint256,uint256) returns (uint256)",
  "function submitEligibilityProof(uint256,uint256[2],uint256[2][2],uint256[2],uint256[4])",
  "function nextPolicyId() view returns (uint256)",
  "function policies(uint256) view returns (address,uint256,uint256,uint256,uint256,uint256,uint8)",
  "function getPolicyIds(address) view returns (uint256[])",
  "event PolicyCreated(uint256 indexed policyId,address indexed holder,uint256 minIncome,uint256 minCreditScore,uint256 maxMedicalRisk)",
];

const SECTIONS = [
  { label: "Home", eyebrow: "OVERVIEW", title: "Your InsureChain dashboard", description: "A privacy-first insurance eligibility demo with a hands-on DeFi learning suite." },
  { label: "Insurance", eyebrow: "PRIVATE ELIGIBILITY", title: "Insurance eligibility", description: "Create a demo policy and prove eligibility with a browser-generated zero-knowledge proof." },
  { label: "Reserve Vault", eyebrow: "TOKENIZED RESERVE", title: "Reserve vault", description: "Deposit demo USDC and explore how an ERC-4626 vault issues and redeems shares." },
  { label: "Liquidity", eyebrow: "AUTOMATED MARKET MAKER", title: "Liquidity pool", description: "Add or remove liquidity and swap between demo USDC and vault shares." },
  { label: "Yield Farming", eyebrow: "LP REWARDS", title: "Yield farming", description: "Stake liquidity pool shares and inspect how a funded reward schedule works." },
  { label: "Staking", eyebrow: "DIRECT REWARDS", title: "Direct staking", description: "Stake vault shares directly and claim demo rewards from a separate staking contract." },
  { label: "Exchange", eyebrow: "DECENTRALIZED EXCHANGE", title: "Token exchange", description: "Create token pairs, provide liquidity, and trade through the DEX router." },
];
const DEFAULT_ELIGIBILITY = { income: "85000", creditScore: "750", medicalRisk: "25", minIncome: "50000", minCreditScore: "650", maxMedicalRisk: "40" };
const messageOf = (error) => error?.shortMessage || error?.reason || error?.message || "Transaction failed";
const short = (value) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not connected";

function Field({ label, value, onChange, placeholder = "0", type = "text" }) {
  return <label className="field"><span>{label}</span><input type={type} inputMode={type === "text" ? "decimal" : undefined} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [walletKind, setWalletKind] = useState("");
  const [deployments, setDeployments] = useState(null);
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [balances, setBalances] = useState({});
  const [policies, setPolicies] = useState([]);
  const [eligibility, setEligibility] = useState(DEFAULT_ELIGIBILITY);
  const [proofInfo, setProofInfo] = useState("");
  const [proofResult, setProofResult] = useState(null);
  const [pendingPolicyId, setPendingPolicyId] = useState("");
  const [vaultAmount, setVaultAmount] = useState("");
  const [vaultSharesAmount, setVaultSharesAmount] = useState("");
  const [ammA, setAmmA] = useState("");
  const [ammB, setAmmB] = useState("");
  const [ammLpAmount, setAmmLpAmount] = useState("");
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeDirection, setTradeDirection] = useState("asset-to-share");
  const [dexA, setDexA] = useState("");
  const [dexB, setDexB] = useState("");
  const [dexTradeAmount, setDexTradeAmount] = useState("");
  const [dexTokenA, setDexTokenA] = useState("mockUSDC");
  const [dexTokenB, setDexTokenB] = useState("vaultShares");
  const [dexRoute, setDexRoute] = useState("direct");
  const [dexLpAmount, setDexLpAmount] = useState("");
  const [lpAmount, setLpAmount] = useState("");
  const [stakeAmount, setStakeAmount] = useState("");

  const configuredChainId = import.meta.env.VITE_CHAIN_ID || "31337";
  const wrongNetwork = Boolean(chainId) && BigInt(chainId) !== BigInt(configuredChainId);
  const signerProvider = useMemo(() => wallet ? new BrowserProvider(wallet) : null, [wallet]);
  const connected = Boolean(account && signerProvider);

  const contract = useCallback(async (key, abi) => {
    if (!signerProvider || !deployments?.[key]) throw new Error(`${key} is not deployed/configured for chain ${configuredChainId}. Deploy the contracts and refresh.`);
    return new Contract(deployments[key], abi, await signerProvider.getSigner());
  }, [signerProvider, deployments, configuredChainId]);

  useEffect(() => {
    let disposed = false;
    fetch(`/deployments/${configuredChainId}.json`).then((response) => response.ok ? response.json() : null)
      .then((value) => { if (!disposed) setDeployments(value); })
      .catch(() => { if (!disposed) setDeployments(null); });
    return () => { disposed = true; };
  }, [configuredChainId]);

  const refresh = useCallback(async () => {
    if (!wallet || !account) return;
    try {
      const browser = new BrowserProvider(wallet);
      const network = await browser.getNetwork();
      setChainId(`0x${network.chainId.toString(16)}`);
      const entries = {};
      for (const [key, address] of Object.entries(deployments || {})) {
        if (!address || !["mockUSDC", "rewardToken", "vaultShares", "simpleAMM", "dexFactory"].includes(key)) continue;
        if (key === "dexFactory") { entries.dexPair = await new Contract(address, FACTORY_ABI, browser).getPair(deployments.mockUSDC, deployments.vaultShares); continue; }
        const abi = key === "vaultShares" ? VAULT_ABI : TOKEN_ABI;
        entries[key] = formatEther(await new Contract(address, abi, browser).balanceOf(account));
      }
      if (deployments?.simpleAMM) entries.lpFarm = formatEther(await new Contract(deployments.simpleAMM, AMM_ABI, browser).balanceOf(account));
      setBalances(entries);
    } catch (error) { setNotice(messageOf(error)); }
  }, [wallet, account, deployments]);

  useEffect(() => {
    if (!wallet) return undefined;
    const accountsChanged = (accounts) => setAccount(accounts?.[0] || "");
    const chainChanged = (next) => setChainId(typeof next === "number" ? `0x${next.toString(16)}` : next);
    wallet.request({ method: "eth_accounts" }).then(accountsChanged).catch(() => {});
    wallet.request({ method: "eth_chainId" }).then(chainChanged).catch(() => {});
    wallet.on?.("accountsChanged", accountsChanged);
    wallet.on?.("chainChanged", chainChanged);
    return () => { wallet.removeListener?.("accountsChanged", accountsChanged); wallet.off?.("accountsChanged", accountsChanged); wallet.removeListener?.("chainChanged", chainChanged); wallet.off?.("chainChanged", chainChanged); };
  }, [wallet]);

  useEffect(() => { if (wallet && deployments) refresh(); }, [wallet, deployments, refresh]);

  const connect = async () => {
    setNotice("");
    if (!window.ethereum) { setNotice("No injected EVM wallet was found. Open the DApp in a compatible wallet browser or install a wallet extension."); return; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setWallet(window.ethereum); setWalletKind("injected"); setAccount(accounts[0]);
      setChainId(await window.ethereum.request({ method: "eth_chainId" }));
      setNotice("Wallet connected. This connection uses the browser wallet provider.");
    } catch (error) { setNotice(messageOf(error)); }
  };

  const connectWalletConnect = async () => {
    const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    if (!projectId) { setNotice("Set VITE_WALLETCONNECT_PROJECT_ID in your local environment to enable WalletConnect QR and mobile links."); return; }
    try {
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      const numericChainId = Number(BigInt(configuredChainId));
      const rpcUrl = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
      const provider = await EthereumProvider.init({
        projectId,
        optionalChains: [numericChainId],
        rpcMap: { [numericChainId]: rpcUrl },
        showQrModal: true,
        methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
        events: ["chainChanged", "accountsChanged"],
        metadata: { name: "InsureChain", description: "Life insurance ZKP and DeFi experiment DApp", url: window.location.origin, icons: [] },
      });
      await provider.connect();
      const accounts = await provider.request({ method: "eth_accounts" });
      setWallet(provider); setWalletKind("walletconnect"); setAccount(accounts[0] || "");
      const activeChain = await provider.request({ method: "eth_chainId" });
      setChainId(typeof activeChain === "number" ? `0x${activeChain.toString(16)}` : activeChain);
      setNotice("WalletConnect session established.");
    } catch (error) { setNotice(messageOf(error)); }
  };

  const switchNetwork = async () => {
    if (!wallet) return;
    try {
      const hexChainId = `0x${BigInt(configuredChainId).toString(16)}`;
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
    } catch (error) { setNotice(messageOf(error)); }
  };

  const disconnectWallet = async () => {
    try { if (walletKind === "walletconnect") await wallet?.disconnect?.(); }
    finally { setWallet(null); setWalletKind(""); setAccount(""); setChainId(""); }
  };

  const run = async (action) => {
    if (!connected) { setNotice("Connect a wallet first."); return; }
    if (wrongNetwork) { setNotice(`Switch your wallet to chain ${configuredChainId}.`); return; }
    setBusy(true); setNotice("");
    try { await action(); await refresh(); }
    catch (error) { setNotice(messageOf(error)); }
    finally { setBusy(false); }
  };

  const approve = async (tokenKey, spender, amount) => {
    const token = await contract(tokenKey, TOKEN_ABI);
    const allowance = await token.allowance(account, spender);
    if (allowance < amount) { const tx = await token.approve(spender, amount); await tx.wait(); }
  };

  const loadPolicies = async () => {
    if (!deployments?.policy) return;
    const policy = new Contract(deployments.policy, POLICY_ABI, signerProvider);
    const ids = await policy.getPolicyIds(account);
    const records = await Promise.all(ids.map(async (id) => {
      const record = await policy.policies(id);
      return { id: id.toString(), createdAt: Number(record[1]), minIncome: record[3].toString(), minCreditScore: record[4].toString(), maxMedicalRisk: record[5].toString(), status: Number(record[6]) };
    }));
    setPolicies(records.reverse());
  };

  useEffect(() => { if (connected && deployments?.policy && active === 1) loadPolicies().catch(() => {}); }, [connected, deployments, active]);

  async function submitEligibility() {
    const data = Object.fromEntries(Object.entries(eligibility).map(([key, value]) => [key, String(value)]));
    const rangeBits = { income: 64, minIncome: 64, creditScore: 16, minCreditScore: 16, medicalRisk: 16, maxMedicalRisk: 16 };
    for (const [key, value] of Object.entries(data)) {
      if (!/^\d+$/.test(value) || BigInt(value) >= 2n ** BigInt(rangeBits[key])) throw new Error(`${key} must be a valid integer in the circuit range.`);
    }
    if (BigInt(data.income) < BigInt(data.minIncome) || BigInt(data.creditScore) < BigInt(data.minCreditScore) || BigInt(data.medicalRisk) > BigInt(data.maxMedicalRisk)) throw new Error("The demonstration inputs do not satisfy the eligibility thresholds.");
    let generated = proofResult;
    if (!generated) {
      generated = await generateEligibilityProof(data);
      setProofResult(generated);
      setProofInfo("Groth16 proof generated in this browser. Raw demonstration inputs were not sent to the chain.");
    }
    const policy = await contract("policy", POLICY_ABI);
    let id = pendingPolicyId ? BigInt(pendingPolicyId) : null;
    if (id === null) {
      const createTx = await policy.createPolicy(data.minIncome, data.minCreditScore, data.maxMedicalRisk);
      const receipt = await createTx.wait();
      for (const log of receipt.logs) { try { const parsed = policy.interface.parseLog(log); if (parsed?.name === "PolicyCreated") id = parsed.args.policyId; } catch {} }
      if (id === null) throw new Error("Policy was created but its PolicyCreated event could not be read.");
      setPendingPolicyId(id.toString());
    }
    const p = generated.proof;
    const a = [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])];
    const b = [[BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])], [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])]];
    const c = [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])];
    const proofTx = await policy.submitEligibilityProof(id, a, b, c, generated.publicSignals.map(BigInt));
    await proofTx.wait();
    setProofInfo(`Eligibility proof verified. Active policy record #${id.toString()}.`);
    setProofResult(null);
    setPendingPolicyId("");
    await loadPolicies();
  }

  const mintDemoTokens = () => run(async () => {
    const token = await contract("mockUSDC", TOKEN_ABI);
    const tx = await token.mint(account, parseEther("1000")); await tx.wait();
    setNotice("Minted 1,000 demo USDC to this wallet.");
  });

  const doVault = () => run(async () => {
    const amount = parseEther(vaultAmount || "0");
    if (amount <= 0n) throw new Error("Enter a positive asset amount.");
    const vault = await contract("vaultShares", VAULT_ABI);
    await approve("mockUSDC", deployments.vaultShares, amount);
    const tx = await vault.deposit(amount, account); await tx.wait();
    setNotice("Assets deposited into the demo ERC-4626 vault; vault shares were minted.");
  });

  const doVaultMint = () => run(async () => {
    const shares = parseEther(vaultSharesAmount || "0");
    if (shares <= 0n) throw new Error("Enter a positive share amount.");
    const vault = await contract("vaultShares", VAULT_ABI);
    const assets = await vault.previewMint(shares);
    await approve("mockUSDC", deployments.vaultShares, assets);
    await (await vault.mint(shares, account)).wait();
    setNotice("Requested vault shares minted for the previewed asset amount.");
  });

  const doVaultWithdraw = () => run(async () => {
    const assets = parseEther(vaultAmount || "0");
    if (assets <= 0n) throw new Error("Enter a positive asset amount.");
    const vault = await contract("vaultShares", VAULT_ABI);
    await (await vault.withdraw(assets, account, account)).wait();
    setNotice("Underlying demo assets withdrawn by burning the required vault shares.");
  });

  const doVaultRedeem = () => run(async () => {
    const shares = parseEther(vaultSharesAmount || "0");
    if (shares <= 0n) throw new Error("Enter a positive share amount.");
    const vault = await contract("vaultShares", VAULT_ABI);
    await (await vault.redeem(shares, account, account)).wait();
    setNotice("Vault shares redeemed for underlying demo assets.");
  });

  const doAmmAdd = () => run(async () => {
    const amountA = parseEther(ammA || "0"), amountB = parseEther(ammB || "0");
    const amm = await contract("simpleAMM", AMM_ABI);
    await approve("mockUSDC", deployments.simpleAMM, amountA);
    await approve("vaultShares", deployments.simpleAMM, amountB);
    const tx = await amm.addLiquidity(amountA, amountB, 0); await tx.wait();
    setNotice("Liquidity added to the Experiment 4 pool.");
  });

  const doAmmSwap = () => run(async () => {
    const amount = parseEther(tradeAmount || "0");
    const amm = await contract("simpleAMM", AMM_ABI);
    const isAssetIn = tradeDirection === "asset-to-share";
    const tokenKey = isAssetIn ? "mockUSDC" : "vaultShares";
    const token = await contract(tokenKey, TOKEN_ABI);
    await approve(tokenKey, deployments.simpleAMM, amount);
    const reserves = await Promise.all([amm.reserveA(), amm.reserveB()]);
    const quote = await amm.getAmountOut(amount, reserves[isAssetIn ? 0 : 1], reserves[isAssetIn ? 1 : 0]);
    const tx = isAssetIn ? await amm.swapExactAForB(amount, quote * 99n / 100n) : await amm.swapExactBForA(amount, quote * 99n / 100n);
    await tx.wait(); setNotice("Swap completed on the Experiment 4 AMM.");
  });

  const doAmmRemove = () => run(async () => {
    const shares = parseEther(ammLpAmount || "0");
    if (shares <= 0n) throw new Error("Enter a positive LP share amount.");
    const amm = await contract("simpleAMM", AMM_ABI);
    await (await amm.removeLiquidity(shares, 0, 0)).wait();
    setNotice("SimpleAMM LP shares burned and pool assets returned.");
  });

  const doFarm = () => run(async () => {
    const amount = parseEther(lpAmount || "0"), farm = await contract("yieldFarm", FARM_ABI);
    await approve("simpleAMM", deployments.yieldFarm, amount);
    const tx = await farm.stake(amount); await tx.wait(); setNotice("AMM LP shares staked in the yield farm.");
  });

  const doFarmWithdraw = () => run(async () => {
    const amount = parseEther(lpAmount || "0"), farm = await contract("yieldFarm", FARM_ABI);
    await (await farm.withdraw(amount)).wait(); setNotice("LP shares withdrawn from the yield farm; accrued rewards remain claimable.");
  });

  const doStake = () => run(async () => {
    const amount = parseEther(stakeAmount || "0"), staking = await contract("staking", STAKING_ABI);
    await approve("vaultShares", deployments.staking, amount);
    const tx = await staking.stake(amount); await tx.wait(); setNotice("Vault shares staked in the separate direct staking experiment.");
  });

  const doUnstake = () => run(async () => {
    const amount = parseEther(stakeAmount || "0"), staking = await contract("staking", STAKING_ABI);
    await (await staking.unstake(amount)).wait(); setNotice("Vault shares unstaked; accrued rewards remain claimable.");
  });

  const doDexSwap = () => run(async () => {
    const amount = parseEther(dexTradeAmount || "0");
    let path = dexRoute === "asset-share-reward"
      ? [deployments.mockUSDC, deployments.vaultShares, deployments.rewardToken]
      : [deployments[dexTokenA], deployments[dexTokenB]];
    if (tradeDirection === "share-to-asset") path.reverse();
    const router = await contract("dexRouter", ROUTER_ABI);
    const inputKey = Object.entries(deployments).find(([, address]) => address?.toLowerCase() === path[0].toLowerCase())?.[0];
    await approve(inputKey, deployments.dexRouter, amount);
    const quote = await router.getAmountsOut(amount, path);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const tx = await router.swapExactTokensForTokens(amount, quote.at(-1) * 99n / 100n, path, account, deadline);
    await tx.wait(); setNotice("Swap completed through the Experiment 6 DEX router.");
  });

  const doDexAdd = () => run(async () => {
    const amountA = parseEther(dexA || "0"), amountB = parseEther(dexB || "0");
    await approve(dexTokenA, deployments.dexRouter, amountA);
    await approve(dexTokenB, deployments.dexRouter, amountB);
    const router = await contract("dexRouter", ROUTER_ABI);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    await (await router.addLiquidity(deployments[dexTokenA], deployments[dexTokenB], amountA, amountB, 0, 0, account, deadline)).wait();
    setNotice("Liquidity added to the Experiment 6 DEX pair.");
  });

  const doDexRemove = () => run(async () => {
    const amount = parseEther(dexLpAmount || "0");
    if (amount <= 0n) throw new Error("Enter a positive LP amount.");
    const factory = await contract("dexFactory", FACTORY_ABI);
    const pairAddress = await factory.getPair(deployments[dexTokenA], deployments[dexTokenB]);
    if (pairAddress === "0x0000000000000000000000000000000000000000") throw new Error("Create and seed this pair before removing liquidity.");
    const pair = new Contract(pairAddress, PAIR_ABI, await signerProvider.getSigner());
    const allowance = await pair.allowance(account, deployments.dexRouter);
    if (allowance < amount) await (await pair.approve(deployments.dexRouter, amount)).wait();
    const router = await contract("dexRouter", ROUTER_ABI);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    await (await router.removeLiquidity(deployments[dexTokenA], deployments[dexTokenB], amount, 0, 0, account, deadline)).wait();
    setNotice("DEX LP shares burned and the two pair assets returned.");
  });

  const action = (fn) => () => void fn();
  const nav = SECTIONS.map(({ label }, index) => <button key={label} className={active === index ? "nav-item selected" : "nav-item"} aria-current={active === index ? "page" : undefined} onClick={() => setActive(index)}>{label}</button>);

  return <div className="app-shell">
    <header className="topbar"><button className="brand brand-button" onClick={() => setActive(0)} aria-label="InsureChain home"><span className="brand-icon"><ShieldCheck size={21}/></span><span>InsureChain<small>INSURANCE + DEFI LAB</small></span></button><div className="topbar-right"><span className="chain-pill">Chain {chainId ? BigInt(chainId).toString() : "—"}</span>{connected ? <><span className="account-pill"><Wallet size={15}/>{short(account)} · {walletKind === "walletconnect" ? "WC" : "wallet"}</span>{wrongNetwork && <button className="button button-secondary" onClick={switchNetwork}>Switch chain</button>}<button className="button button-secondary" onClick={disconnectWallet}>Disconnect</button></> : <><button className="button button-secondary" onClick={connectWalletConnect}>WalletConnect</button><button className="button button-primary" onClick={connect}><Wallet size={16}/> MetaMask</button></>}</div></header>
    <nav className="primary-nav" aria-label="Main navigation">{nav}</nav>
    <div className="workspace">
      <main className="main-content"><div className="page-heading"><div><div className="eyebrow">INSURECHAIN · {SECTIONS[active].eyebrow}</div><h1>{SECTIONS[active].title}</h1><p>{SECTIONS[active].description}</p></div>{active !== 0 && <button className="button button-secondary" onClick={refresh}><RefreshCw size={15}/> Refresh</button>}</div>
        {notice && <div className="notice" role="status">{notice}</div>}
        {wrongNetwork && <div className="notice warning">Connected to chain {BigInt(chainId).toString()}; switch to configured chain {configuredChainId} before submitting transactions.</div>}
        {!deployments && <div className="notice warning">Deployment registry not found. Run <code>npm run deploy:local</code> after starting the Hardhat node.</div>}
        {active === 0 && <HomeDashboard connected={connected} account={account} wrongNetwork={wrongNetwork} chainId={chainId} configuredChainId={configuredChainId} deployments={deployments} balances={balances} policies={policies} onNavigate={setActive} onConnect={connect} onConnectWalletConnect={connectWalletConnect} onSwitchNetwork={switchNetwork} onRefresh={refresh}/>}

        {active === 1 && <div className="content-grid"><Card title="Private eligibility proof" icon={<LockKeyhole/>} description="The proof is generated in your browser. Only the proof and policy thresholds are submitted to the verifier contract."><div className="fields-grid">{Object.entries(eligibility).map(([key, value]) => <Field key={key} label={key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())} value={value} onChange={(next) => { setEligibility((previous) => ({ ...previous, [key]: next })); setProofResult(null); setPendingPolicyId(""); setProofInfo(""); }}/>)}</div><button disabled={busy || !connected} className="button button-primary wide" onClick={action(() => run(submitEligibility))}>{busy ? "Generating proof / waiting for chain…" : pendingPolicyId ? `Retry pending policy #${pendingPolicyId}` : "Generate proof and activate demo policy"}</button>{proofInfo && <p className="muted result">{proofInfo}</p>}</Card><Card title="My on-chain policy records" icon={<ShieldCheck/>} description="Policy status and public eligibility thresholds read from the connected wallet."><button className="button button-secondary" onClick={() => loadPolicies().catch((error) => setNotice(messageOf(error)))}>Load policy records</button><div className="record-list">{policies.map((policy) => <div className="record" key={policy.id}><strong>Policy #{policy.id}</strong><span className={`status status-${policy.status}`}>{["None", "Pending", "Active", "Rejected"][policy.status] || "Unknown"}</span><small>Income ≥ {policy.minIncome} · Credit ≥ {policy.minCreditScore} · Risk ≤ {policy.maxMedicalRisk}</small></div>)}{!policies.length && <p className="muted">No records loaded yet.</p>}</div></Card></div>}

        {active === 2 && <div className="content-grid"><Card title="ERC-4626 lifecycle" icon={<Layers3/>} description="Deposit/mint assets for vINS shares, or withdraw/redeem by burning shares."><Field label="Asset amount · deposit or withdraw" value={vaultAmount} onChange={setVaultAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doVault}>Approve and deposit assets</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doVaultWithdraw}>Withdraw asset amount</button><Field label="Share amount · mint or redeem" value={vaultSharesAmount} onChange={setVaultSharesAmount}/><button className="button button-secondary wide" disabled={busy || !connected} onClick={doVaultMint}>Mint exact shares</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doVaultRedeem}>Redeem shares</button></Card><Card title="Faucet and vault position" icon={<Coins/>} description="The faucet is local-demo only; the vault has no strategy or promised yield."><button className="button button-primary" disabled={busy || !connected} onClick={mintDemoTokens}>Mint 1,000 demo USDC</button><VaultStats contract={contract} deployments={deployments}/></Card></div>}

        {active === 3 && <div className="content-grid"><Card title="Liquidity · SimpleAMM" icon={<Layers3/>} description="Experiment 4 pool for demo USDC and vINS. LP shares are issued by the pool contract."><Field label="Demo USDC amount" value={ammA} onChange={setAmmA}/><Field label="vINS amount" value={ammB} onChange={setAmmB}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doAmmAdd}>Approve and add liquidity</button><AmmStats contract={contract}/><Field label="LP shares to remove" value={ammLpAmount} onChange={setAmmLpAmount}/><button className="button button-secondary wide" disabled={busy || !connected} onClick={doAmmRemove}>Remove liquidity</button></Card><Card title="Swap · SimpleAMM" icon={<ArrowRightLeft/>} description="Constant-product pool with a 0.30% fee and a 1% demo slippage tolerance."><select className="select" value={tradeDirection} onChange={(event) => setTradeDirection(event.target.value)}><option value="asset-to-share">Demo USDC → vINS</option><option value="share-to-asset">vINS → Demo USDC</option></select><Field label="Input amount" value={tradeAmount} onChange={setTradeAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doAmmSwap}>Swap</button></Card></div>}

        {active === 4 && <div className="content-grid"><Card title="Stake AMM LP shares" icon={<Coins/>} description="Stake Experiment 4 LP shares and accrue RWD over the configured reward period."><Field label="LP share amount to stake or withdraw" value={lpAmount} onChange={setLpAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doFarm}>Approve and stake</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doFarmWithdraw}>Withdraw staked LP shares</button><RewardActions kind="farm" contract={contract} account={account} busy={busy} run={run}/></Card><Card title="Reward schedule" icon={<CircleDollarSign/>} description="The deployer funds the farm reward schedule. Claims are limited by the funded RWD balance."><RewardStats contract={contract} account={account} kind="farm"/><p className="muted">The farm stakes the LP token from Experiment 4; it does not stake vault shares directly.</p></Card></div>}

        {active === 5 && <div className="content-grid"><Card title="Stake vINS directly" icon={<Coins/>} description="A separate Experiment 5 mechanism: stake ERC-4626 shares rather than AMM LP tokens."><Field label="Vault share amount to stake or unstake" value={stakeAmount} onChange={setStakeAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doStake}>Approve and stake</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doUnstake}>Unstake vault shares</button><RewardActions kind="staking" contract={contract} account={account} busy={busy} run={run}/></Card><Card title="Direct staking rewards" icon={<CircleDollarSign/>} description="Rewards use the configured time-based emission schedule."><RewardStats contract={contract} account={account} kind="staking"/><p className="muted">Direct staking and yield farming are separate contracts and positions.</p></Card></div>}

        {active === 6 && <div className="content-grid"><Card title="Pair liquidity · DEX" icon={<Layers3/>} description="Experiment 6 factory creates selected pairs; the router adds and removes their liquidity."><select className="select" value={dexTokenA} onChange={(event) => setDexTokenA(event.target.value)}><TokenOptions exclude={dexTokenB}/></select><select className="select" value={dexTokenB} onChange={(event) => setDexTokenB(event.target.value)}><TokenOptions exclude={dexTokenA}/></select><Field label="First token desired amount" value={dexA} onChange={setDexA}/><Field label="Second token desired amount" value={dexB} onChange={setDexB}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doDexAdd}>Approve and add liquidity</button><Field label="DEX LP amount to remove" value={dexLpAmount} onChange={setDexLpAmount}/><button className="button button-secondary wide" disabled={busy || !connected} onClick={doDexRemove}>Remove pair liquidity</button><DexPairStats contract={contract} deployments={deployments}/></Card><Card title="Swap · DEX Router" icon={<ArrowRightLeft/>} description="Router applies a 0.30% fee per pair, deadline, and 1% minimum-output protection."><select className="select" value={dexRoute} onChange={(event) => setDexRoute(event.target.value)}><option value="direct">Direct selected-token pair</option><option value="asset-share-reward">Multi-hop: demo USDC → vINS → RWD</option></select>{dexRoute === "direct" && <><select className="select" value={dexTokenA} onChange={(event) => setDexTokenA(event.target.value)}><TokenOptions exclude={dexTokenB}/></select><select className="select" value={dexTokenB} onChange={(event) => setDexTokenB(event.target.value)}><TokenOptions exclude={dexTokenA}/></select></>}<select className="select" value={tradeDirection} onChange={(event) => setTradeDirection(event.target.value)}><option value="asset-to-share">Forward path</option><option value="share-to-asset">Reverse path</option></select><Field label="Input amount" value={dexTradeAmount} onChange={setDexTradeAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doDexSwap}>Swap through router</button><p className="muted">For multi-hop swaps, create and seed both adjacent pairs first.</p></Card></div>}

        {active !== 0 && <footer className="disclaimer">Student demonstration only. Do not use real financial, medical, or identity information. Demo assets, vault shares, pools, and rewards have no real-world value. Policy activation demonstrates eligibility verification and does not issue insurance coverage.</footer>}
      </main>
    </div>
  </div>;
}

function HomeDashboard({ connected, account, wrongNetwork, chainId, configuredChainId, deployments, balances, policies, onNavigate, onConnect, onConnectWalletConnect, onSwitchNetwork, onRefresh }) {
  const services = [
    { title: "Private eligibility", copy: "Generate a Groth16 proof in your browser and verify demo policy eligibility on-chain.", icon: <LockKeyhole/>, target: 1, tag: "Insurance" },
    { title: "Reserve vault", copy: "Deposit demo USDC for vINS shares, then explore deposit, mint, withdraw, and redeem.", icon: <Landmark/>, target: 2, tag: "ERC-4626" },
    { title: "Liquidity and swaps", copy: "Supply demo token pairs to a pool or swap against its current reserves.", icon: <ArrowRightLeft/>, target: 3, tag: "AMM" },
    { title: "LP yield farming", copy: "Stake pool LP shares and inspect rewards from the funded demo schedule.", icon: <TrendingUp/>, target: 4, tag: "Rewards" },
    { title: "Direct staking", copy: "Stake vault shares separately from LP farming and claim demo reward tokens.", icon: <Coins/>, target: 5, tag: "Rewards" },
    { title: "Token exchange", copy: "Create pairs, provide liquidity, and trade directly or through a multi-hop route.", icon: <Activity/>, target: 6, tag: "DEX" },
  ];
  const accountState = wrongNetwork ? "Wrong network" : connected ? "Wallet connected" : "Wallet not connected";
  return <div className="home-dashboard">
    <section className="home-hero" id="home">
      <div className="hero-copy"><div className="hero-kicker"><Sparkles size={14}/> INSURANCE ELIGIBILITY + DECENTRALIZED FINANCE</div><h2>Explore a more private way to prove eligibility.</h2><p>InsureChain is an educational DApp that combines browser-generated zero-knowledge proofs with a set of hands-on DeFi tools. Try the insurance flow, then see how vaults, liquidity pools, staking, and token swaps fit together.</p><div className="hero-actions"><button className="button button-primary" onClick={() => onNavigate(1)}>Start eligibility check <ArrowRight size={15}/></button><button className="button button-secondary" onClick={() => onNavigate(2)}>Explore the DeFi tools</button></div></div>
      <div className="hero-status"><div className="status-heading"><span className={connected && !wrongNetwork ? "live-dot" : "live-dot inactive"}/><strong>{accountState}</strong></div><p>{connected ? `Account ${short(account)}` : "Connect a wallet to read balances and submit demo transactions."}</p><div className="status-row"><span>Network</span><b>{chainId ? `Chain ${BigInt(chainId).toString()}` : `Expected ${configuredChainId}`}</b></div><div className="status-row"><span>Contracts</span><b className={deployments ? "status-ready" : "status-missing"}>{deployments ? "Deployment found" : "Not deployed"}</b></div>{connected && <button className="button button-secondary wide" onClick={onRefresh}><RefreshCw size={14}/> Refresh wallet overview</button>}{!connected && <div className="hero-wallet-actions"><button className="button button-primary" onClick={onConnect}><Wallet size={15}/> Connect MetaMask</button><button className="button button-secondary" onClick={onConnectWalletConnect}>WalletConnect</button></div>}{wrongNetwork && <button className="button button-secondary wide" onClick={onSwitchNetwork}>Switch to chain {configuredChainId}</button>}</div>
    </section>
    <section className="home-section"><div className="section-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h2>Wallet overview</h2></div><span className="section-hint">Values are demo tokens on the selected test chain.</span></div><div className="metrics-grid"><Metric title="Demo USDC" value={balances.mockUSDC || "0"}/><Metric title="vINS vault shares" value={balances.vaultShares || "0"}/><Metric title="AMM LP shares" value={balances.lpFarm || "0"}/><Metric title="RWD reward token" value={balances.rewardToken || "0"}/></div>{connected && <div className="dashboard-footnote"><BadgeCheck size={15}/> {policies.length ? `${policies.length} policy record${policies.length === 1 ? "" : "s"} loaded for this wallet.` : "Connect and open Insurance to load this wallet’s policy records."}</div>}</section>
    <section className="home-section"><div className="section-heading"><div><div className="eyebrow">WHAT YOU CAN DO</div><h2>Explore the services</h2></div><span className="section-hint">Choose a tool to open its workspace.</span></div><div className="services-grid">{services.map((service) => <button className="service-card" key={service.title} onClick={() => onNavigate(service.target)}><span className="service-icon">{service.icon}</span><span className="service-tag">{service.tag}</span><strong>{service.title}</strong><span className="service-copy">{service.copy}</span><span className="service-link">Open tool <ArrowRight size={14}/></span></button>)}</div></section>
    <section className="home-section"><div className="section-heading"><div><div className="eyebrow">SUGGESTED JOURNEY</div><h2>How the demo fits together</h2></div></div><div className="journey-grid"><div className="journey-step"><span>01</span><div><strong>Check eligibility</strong><p>Enter sample values and create a proof locally. The verifier checks the proof and public policy thresholds.</p></div></div><div className="journey-step"><span>02</span><div><strong>Explore tokenized reserves</strong><p>Use faucet USDC to learn how a vault accepts assets and issues shares.</p></div></div><div className="journey-step"><span>03</span><div><strong>Provide liquidity or trade</strong><p>Use vault shares and demo tokens to explore pools, LP positions, and DEX routes.</p></div></div><div className="journey-step"><span>04</span><div><strong>Stake and inspect rewards</strong><p>Compare staking vault shares directly with staking AMM LP shares in a farm.</p></div></div></div></section>
    <section className="scope-note"><LockKeyhole size={18}/><div><strong>Educational prototype</strong><p>The policy flow demonstrates eligibility verification only. It does not connect to an insurer, provide insurance coverage, or make payouts. Never enter real medical, identity, or financial information. All DeFi assets and rewards in this app are test/demo tokens with no real-world value.</p></div></section>
  </div>;
}
function Metric({ title, value }) { return <div className="metric"><span>{title}</span><strong>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong></div>; }
function Card({ title, icon, description, children }) { return <article className="card"><div className="card-title"><span className="card-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div>{children}</article>; }
function VaultStats({ contract, deployments }) {
  const [values, setValues] = useState(null);
  useEffect(() => { let live = true; if (!deployments?.vaultShares) return; (async () => { try { const vault = await contract("vaultShares", VAULT_ABI); const [assets, shares] = await Promise.all([vault.totalAssets(), vault.totalSupply()]); if (live) setValues({ assets: formatEther(assets), shares: formatEther(shares) }); } catch {} })(); return () => { live = false; }; }, [contract, deployments]);
  return <div className="stats"><span>Total assets <b>{values?.assets ?? "—"}</b></span><span>Shares outstanding <b>{values?.shares ?? "—"}</b></span></div>;
}
function AmmStats({ contract }) {
  const [values, setValues] = useState(null);
  useEffect(() => { let live = true; (async () => { try { const amm = await contract("simpleAMM", AMM_ABI); const [a, b, supply] = await Promise.all([amm.reserveA(), amm.reserveB(), amm.totalSupply()]); if (live) setValues([a, b, supply].map(formatEther)); } catch {} })(); return () => { live = false; }; }, [contract]);
  return <div className="stats"><span>Reserve A <b>{values?.[0] ?? "—"}</b></span><span>Reserve B <b>{values?.[1] ?? "—"}</b></span><span>LP supply <b>{values?.[2] ?? "—"}</b></span></div>;
}
function DexPairStats({ contract, deployments }) {
  const [pair, setPair] = useState("");
  useEffect(() => { let live = true; (async () => { try { const factory = await contract("dexFactory", FACTORY_ABI); const found = await factory.getPair(deployments.mockUSDC, deployments.vaultShares); if (live) setPair(found); } catch {} })(); return () => { live = false; }; }, [contract, deployments]);
  return <div className="stats"><span>Pair address <b>{pair && pair !== "0x0000000000000000000000000000000000000000" ? short(pair) : "Not created yet"}</b></span><span>Factory <b>{deployments?.dexFactory ? short(deployments.dexFactory) : "—"}</b></span></div>;
}
function RewardActions({ kind, contract, account, run, busy }) {
  const exit = () => run(async () => { const c = await contract(kind === "farm" ? "yieldFarm" : "staking", kind === "farm" ? FARM_ABI : STAKING_ABI); await (await c.exit()).wait(); });
  const claim = () => run(async () => { const c = await contract(kind === "farm" ? "yieldFarm" : "staking", kind === "farm" ? FARM_ABI : STAKING_ABI); await (await (kind === "farm" ? c.getReward() : c.claimReward())).wait(); });
  return <div className="button-row"><button className="button button-secondary" disabled={busy || !account} onClick={claim}>Claim reward</button><button className="button button-secondary" disabled={busy || !account} onClick={exit}>Exit position</button></div>;
}
function RewardStats({ contract, account, kind }) {
  const [values, setValues] = useState(null);
  useEffect(() => { let live = true; if (!account) return; (async () => { try { const c = await contract(kind === "farm" ? "yieldFarm" : "staking", kind === "farm" ? FARM_ABI : STAKING_ABI); const [staked, earned] = await Promise.all([kind === "farm" ? c.balanceOf(account) : c.stakedBalance(account), c.earned(account)]); if (live) setValues([formatEther(staked), formatEther(earned)]); } catch {} })(); return () => { live = false; }; }, [contract, account, kind]);
  return <div className="stats"><span>Your staked balance <b>{values?.[0] ?? "—"}</b></span><span>Accrued rewards <b>{values?.[1] ?? "—"}</b></span></div>;
}
function TokenOptions({ exclude }) {
  const options = [["mockUSDC", "Demo USDC"], ["vaultShares", "vINS vault share"], ["rewardToken", "RWD reward token"]].filter(([key]) => key !== exclude);
  return options.map(([key, label]) => <option key={key} value={key}>{label}</option>);
}
