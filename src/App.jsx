import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract, formatEther, keccak256, parseEther, toUtf8Bytes, isAddress } from "ethers";
import { ShieldCheck, Wallet, RefreshCw, ArrowRightLeft, Coins, Layers3, CircleDollarSign, LockKeyhole, Landmark, TrendingUp, ArrowRight, BadgeCheck, Activity, Sparkles, AlertTriangle } from "lucide-react";
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
  "function convertToAssets(uint256) view returns (uint256)", "function previewDeposit(uint256) view returns (uint256)", "function previewMint(uint256) view returns (uint256)",
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
const PAIR_ABI = ["function reserve0() view returns (uint256)", "function reserve1() view returns (uint256)", "function token0() view returns (address)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const ROUTER_ABI = [
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
  "function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256) returns (uint256,uint256)",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
];
const POLICY_ABI = [
  "function createPolicy(uint256,uint256,uint256,uint256,uint256,address) returns (uint256)",
  "function submitEligibilityProof(uint256,uint256[2],uint256[2][2],uint256[2],uint256[4])",
  "function purchasePolicy(uint256) returns (uint256)",
  "function submitClaim(uint256,uint256,bytes32)",
  "function approveClaim(uint256)",
  "function rejectClaim(uint256)",
  "function reserveBalance() view returns (uint256)",
  "function claims(uint256) view returns (uint256,uint256,bytes32,bool,bool)",
  "function nextPolicyId() view returns (uint256)",
  "function policyStatus(uint256) view returns (uint8)",
  "function policies(uint256) view returns (address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,uint8)",
  "function getPolicyIds(address) view returns (uint256[])",
  "event PolicyCreated(uint256 indexed policyId,address indexed holder,uint256 minIncome,uint256 minCreditScore,uint256 maxMedicalRisk,uint256 coverageAmount,uint256 premiumAmount,address beneficiary)",
];

const SECTIONS = [
  { label: "Home", eyebrow: "OVERVIEW", title: "Your InsureChain dashboard", description: "A privacy-first insurance eligibility demo with a hands-on DeFi learning suite." },
  { label: "Insurance", eyebrow: "POLICY LIFECYCLE", title: "Life insurance policy", description: "Prove demo eligibility, activate cover with a premium, and follow a claim through reserve review." },
  { label: "Reserve Vault", eyebrow: "INSURANCE RESERVE", title: "Reserve vault", description: "See policy premiums backing the shared demo reserve alongside personal ERC-4626 deposits and shares." },
  { label: "Liquidity", eyebrow: "RESERVE-ASSET MARKET", title: "Liquidity pool", description: "Create a personal market between demo USDC and vINS, the same vault share used for policy premiums." },
  { label: "Yield Farming", eyebrow: "LIQUIDITY INCENTIVES", title: "Yield farming", description: "Stake LP positions that provide market liquidity for the insurance reserve share token." },
  { label: "Staking", eyebrow: "RESERVE-SHARE PARTICIPATION", title: "Direct staking", description: "Stake personal vINS shares and explore a separate funded reward schedule." },
  { label: "Exchange", eyebrow: "INSURANCE ASSET EXCHANGE", title: "Token exchange", description: "Create pairs and trade demo USDC, vINS reserve shares, and RWD through the DEX router." },
];
const DEFAULT_ELIGIBILITY = { income: "85000", creditScore: "750", medicalRisk: "25", minIncome: "50000", minCreditScore: "650", maxMedicalRisk: "40" };
const messageOf = (error) => {
  if (error?.code === 4001 || /user rejected|user denied/i.test(error?.shortMessage || error?.message || "")) return "The wallet request was cancelled. No transaction was submitted.";
  const raw = String(error?.reason || error?.shortMessage || error?.message || "The action could not be completed.").replace(/^execution reverted:\s*/i, "").split("\n")[0];
  if (/insufficient.*(balance|funds|shares|liquidity)|balance.*insufficient/i.test(raw)) return "Not enough tokens or LP shares in this wallet for that action. Check the selected amount and your available balance.";
  if (/insufficient allowance|allowance.*insufficient/i.test(raw)) return "The contract does not have enough spending approval. Retry the action and approve the requested amount in your wallet.";
  if (/invalid withdrawal|invalid unstake/i.test(raw)) return "The requested amount is greater than your staked balance. Reduce the amount or check your current position.";
  if (/insufficient amount or liquidity|insufficient reserves/i.test(raw)) return "The pool does not have enough liquidity for this action. Try a smaller amount or add liquidity to the pool.";
  if (/invalid (bigNumberish|argument).*value=null|value=null.*invalid_argument/i.test(raw)) return "The app received an empty numeric value from a contract response. Check MetaMask Activity to see whether the transaction was submitted before retrying.";
  if (/missing revert data|call exception/i.test(raw)) return "The contract rejected this action. Check your balance, amount, approval, pool liquidity, and selected network.";
  return raw;
};
const short = (value) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not connected";
const positiveAmount = (value, label) => {
  let parsed;
  try { parsed = parseEther(String(value || "0")); }
  catch { throw new Error(`${label} must be a valid number.`); }
  if (parsed <= 0n) throw new Error(`Enter a positive ${label.toLowerCase()}.`);
  return parsed;
};

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
  const [alertMessage, setAlertMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [balances, setBalances] = useState({});
  const [policies, setPolicies] = useState([]);
  const [historyToken, setHistoryToken] = useState("");
  const [activities, setActivities] = useState([]);
  const [historyStatus, setHistoryStatus] = useState("Sign a wallet message to load this wallet’s on-chain activity.");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
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
  const [coverageAmount, setCoverageAmount] = useState("1000");
  const [premiumAmount, setPremiumAmount] = useState("100");
  const [beneficiary, setBeneficiary] = useState("");
  const [claimPolicyId, setClaimPolicyId] = useState("");
  const [claimAmount, setClaimAmount] = useState("100");
  const [claimReference, setClaimReference] = useState("");
  const walletDataSequence = useRef(0);
  const currentWallet = useRef(wallet);
  const currentAccount = useRef(account);
  currentWallet.current = wallet;
  currentAccount.current = account;

  const configuredChainId = import.meta.env.VITE_CHAIN_ID || "31337";
  const wrongNetwork = Boolean(chainId) && BigInt(chainId) !== BigInt(configuredChainId);
  const signerProvider = useMemo(() => wallet ? new BrowserProvider(wallet) : null, [wallet]);
  const connected = Boolean(account && signerProvider);
  const historyApi = import.meta.env.VITE_BACKEND_URL || "";

  const historyRequest = async (url, options = {}) => {
    const response = await fetch(historyApi + url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `History service returned ${response.status}.`);
    return data;
  };

  const syncHistory = async (token = historyToken) => {
    if (!token) return;
    const sequence = walletDataSequence.current;
    const requestedWallet = wallet;
    const requestedAccount = account;
    try {
      const data = await historyRequest("/api/history/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (sequence !== walletDataSequence.current || currentWallet.current !== requestedWallet || currentAccount.current.toLowerCase() !== requestedAccount.toLowerCase()) return;
      setActivities(data.events || []);
      setHistoryStatus(`Updated from chain ${data.chainId}; ${data.events?.length || 0} recorded activities.`);
    } catch (error) {
      if (sequence === walletDataSequence.current && currentWallet.current === requestedWallet && currentAccount.current.toLowerCase() === requestedAccount.toLowerCase()) {
        setHistoryStatus(messageOf(error));
        setAlertMessage(messageOf(error));
      }
    }
  };

  const enableHistory = async () => {
    if (!connected || wrongNetwork) { setAlertMessage(`Connect your wallet to chain ${configuredChainId} first.`); return; }
    const sequence = walletDataSequence.current;
    const requestedWallet = wallet;
    const requestedAccount = account;
    setHistoryBusy(true);
    try {
      const challenge = await historyRequest("/api/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: requestedAccount, chainId: BigInt(chainId).toString() }) });
      if (sequence !== walletDataSequence.current || currentWallet.current !== requestedWallet || currentAccount.current.toLowerCase() !== requestedAccount.toLowerCase()) return;
      const signer = await signerProvider.getSigner();
      const signature = await signer.signMessage(challenge.message);
      if (sequence !== walletDataSequence.current || currentWallet.current !== requestedWallet || currentAccount.current.toLowerCase() !== requestedAccount.toLowerCase()) return;
      const session = await historyRequest("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: requestedAccount, message: challenge.message, signature }) });
      if (sequence !== walletDataSequence.current || currentWallet.current !== requestedWallet || currentAccount.current.toLowerCase() !== requestedAccount.toLowerCase()) return;
      setHistoryToken(session.token);
      setHistoryStatus("Wallet verified. Loading the on-chain activity history…");
      await syncHistory(session.token);
    } catch (error) {
      if (sequence === walletDataSequence.current && currentWallet.current === requestedWallet && currentAccount.current.toLowerCase() === requestedAccount.toLowerCase()) {
        setHistoryStatus(messageOf(error));
        setAlertMessage(messageOf(error));
      }
    } finally {
      if (sequence === walletDataSequence.current) setHistoryBusy(false);
    }
  };

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
    setRefreshVersion((value) => value + 1);
    if (!wallet || !account) return;
    const sequence = walletDataSequence.current;
    const requestedWallet = wallet;
    const requestedAccount = account;
    const isCurrent = () => sequence === walletDataSequence.current && currentWallet.current === requestedWallet && currentAccount.current.toLowerCase() === requestedAccount.toLowerCase();
    const browser = new BrowserProvider(wallet);
    const entries = {};
    const refreshErrors = [];
    for (const [key, address] of Object.entries(deployments || {})) {
      if (!address || !["mockUSDC", "rewardToken", "vaultShares", "dexFactory"].includes(key)) continue;
      try {
        if (key === "dexFactory") { entries.dexPair = await new Contract(address, FACTORY_ABI, browser).getPair(deployments.mockUSDC, deployments.vaultShares); continue; }
        const abi = key === "vaultShares" ? VAULT_ABI : TOKEN_ABI;
        const value = await new Contract(address, abi, browser).balanceOf(account);
        if (value == null) throw new Error(`${key} balance was empty`);
        entries[key] = formatEther(value);
      } catch (error) { refreshErrors.push(`${key}: ${messageOf(error)}`); }
    }
    try {
      if (deployments?.simpleAMM) {
        const value = await new Contract(deployments.simpleAMM, AMM_ABI, browser).balanceOf(account);
        if (value == null) throw new Error("LP balance was empty");
        entries.lpFarm = formatEther(value);
      }
    } catch (error) { refreshErrors.push(`LP balance: ${messageOf(error)}`); }
    if (!isCurrent()) return;
    setBalances(entries);
    try {
      if (deployments?.policy) {
        const policy = new Contract(deployments.policy, POLICY_ABI, browser);
        const ids = await policy.getPolicyIds(account);
        const records = await Promise.all(ids.map(async (id) => {
          const [record, status] = await Promise.all([policy.policies(id), policy.policyStatus(id)]);
          if (!record || record.length < 11 || record[7] == null || record[8] == null) throw new Error("The deployed policy returned an incomplete record.");
          return { id: id.toString(), createdAt: Number(record[1]), activatedAt: Number(record[2]), expiresAt: Number(record[3]), minIncome: record[4].toString(), minCreditScore: record[5].toString(), maxMedicalRisk: record[6].toString(), coverageAmount: formatEther(record[7]), premiumAmount: formatEther(record[8]), beneficiary: record[9], status: Number(status) };
        }));
        if (!isCurrent()) return;
        setPolicies(records.reverse());
      }
    } catch (error) { refreshErrors.push(`Policy records: ${messageOf(error)}`); }
    if (isCurrent() && refreshErrors.length) {
      setNotice(`Some wallet data could not refresh. Check MetaMask Activity if you just submitted a transaction, then reload the page. ${refreshErrors.join(" · ")}`);
    }
  }, [wallet, account, deployments, chainId]);

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

  useEffect(() => {
    walletDataSequence.current += 1;
    setBalances({});
    setPolicies([]);
    setHistoryToken("");
    setActivities([]);
    setHistoryStatus(account ? "Sign a wallet message to load this wallet’s on-chain activity." : "Connect a wallet to view its policy and transaction history.");
    setHistoryBusy(false);
    setNotice("");
    setAlertMessage("");
    setBusy(false);
    setProofInfo("");
    setProofResult(null);
    setPendingPolicyId("");
    setEligibility(DEFAULT_ELIGIBILITY);
    setVaultAmount("");
    setVaultSharesAmount("");
    setAmmA("");
    setAmmB("");
    setAmmLpAmount("");
    setTradeAmount("");
    setTradeDirection("asset-to-share");
    setDexA("");
    setDexB("");
    setDexTradeAmount("");
    setDexTokenA("mockUSDC");
    setDexTokenB("vaultShares");
    setDexRoute("direct");
    setDexLpAmount("");
    setLpAmount("");
    setStakeAmount("");
    setCoverageAmount("1000");
    setPremiumAmount("100");
    setBeneficiary("");
    setClaimPolicyId("");
    setClaimAmount("100");
    setClaimReference("");
  }, [wallet, account, chainId]);

  useEffect(() => { if (wallet && deployments) refresh(); }, [wallet, deployments, refresh]);

  const connect = async () => {
    setNotice(""); setAlertMessage("");
    if (!window.ethereum) { setAlertMessage("No injected EVM wallet was found. Open the DApp in a compatible wallet browser or install a wallet extension."); return; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setWallet(window.ethereum); setWalletKind("injected"); setAccount(accounts[0]);
      setChainId(await window.ethereum.request({ method: "eth_chainId" }));
      setNotice("Wallet connected. This connection uses the browser wallet provider.");
    } catch (error) { setAlertMessage(messageOf(error)); }
  };

  const connectWalletConnect = async () => {
    const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    if (!projectId) { setAlertMessage("Set VITE_WALLETCONNECT_PROJECT_ID in your local environment to enable WalletConnect QR and mobile links."); return; }
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
        metadata: { name: "InsureChain", description: "Private life-insurance eligibility and DeFi services", url: window.location.origin, icons: [] },
      });
      await provider.connect();
      const accounts = await provider.request({ method: "eth_accounts" });
      setWallet(provider); setWalletKind("walletconnect"); setAccount(accounts[0] || "");
      const activeChain = await provider.request({ method: "eth_chainId" });
      setChainId(typeof activeChain === "number" ? `0x${activeChain.toString(16)}` : activeChain);
      setNotice("WalletConnect session established.");
    } catch (error) { setAlertMessage(messageOf(error)); }
  };

  const switchNetwork = async () => {
    if (!wallet) return;
    try {
      const hexChainId = `0x${BigInt(configuredChainId).toString(16)}`;
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
    } catch (error) { setAlertMessage(messageOf(error)); }
  };

  const disconnectWallet = async () => {
    const activeWallet = wallet;
    const shouldDisconnectWalletConnect = walletKind === "walletconnect";
    setWallet(null);
    setWalletKind("");
    setAccount("");
    setChainId("");
    try { if (shouldDisconnectWalletConnect) await activeWallet?.disconnect?.(); }
    catch (error) { setAlertMessage(messageOf(error)); }
  };

  const run = async (action) => {
    if (!connected) { setAlertMessage("Connect a wallet first."); return; }
    if (wrongNetwork) { setAlertMessage(`Switch your wallet to chain ${configuredChainId}.`); return; }
    const sequence = walletDataSequence.current;
    setBusy(true); setNotice(""); setAlertMessage("");
    try {
      await action();
      if (sequence !== walletDataSequence.current) { setNotice(""); return; }
      await refresh();
      if (sequence === walletDataSequence.current && historyToken) await syncHistory(historyToken);
    } catch (error) {
      if (sequence === walletDataSequence.current) setAlertMessage(messageOf(error));
    } finally {
      if (sequence === walletDataSequence.current) setBusy(false);
    }
  };

  const approve = async (tokenKey, spender, amount) => {
    const token = await contract(tokenKey, TOKEN_ABI);
    const allowance = await token.allowance(account, spender);
    if (allowance < amount) { const tx = await token.approve(spender, amount); await tx.wait(); }
  };

  const loadPolicies = async () => {
    if (!deployments?.policy) return;
    const sequence = walletDataSequence.current;
    const requestedAccount = account;
    // This is a read-only refresh. Do not acquire a wallet signer here: some
    // wallet extensions return incomplete values while a confirmation is being
    // dismissed, even when the on-chain transaction has already succeeded.
    const policy = new Contract(deployments.policy, POLICY_ABI, new BrowserProvider(wallet));
    const ids = await policy.getPolicyIds(account);
    const records = await Promise.all(ids.map(async (id) => {
      const [record, status] = await Promise.all([policy.policies(id), policy.policyStatus(id)]);
      if (!record || record.length < 11 || record[7] == null || record[8] == null) throw new Error("The deployed policy returned an incomplete record; refresh the deployment registry and try again.");
      return { id: id.toString(), createdAt: Number(record[1]), activatedAt: Number(record[2]), expiresAt: Number(record[3]), minIncome: record[4].toString(), minCreditScore: record[5].toString(), maxMedicalRisk: record[6].toString(), coverageAmount: formatEther(record[7]), premiumAmount: formatEther(record[8]), beneficiary: record[9], status: Number(status) };
    }));
    if (sequence === walletDataSequence.current && currentAccount.current.toLowerCase() === requestedAccount.toLowerCase()) setPolicies(records.reverse());
  };

  useEffect(() => { if (connected && deployments?.policy && (active === 0 || active === 1)) loadPolicies().catch(() => {}); }, [connected, deployments, active]);

  async function submitEligibility() {
    const data = Object.fromEntries(Object.entries(eligibility).map(([key, value]) => [key, String(value)]));
    const rangeBits = { income: 64, minIncome: 64, creditScore: 16, minCreditScore: 16, medicalRisk: 16, maxMedicalRisk: 16 };
    for (const [key, value] of Object.entries(data)) {
      if (!/^\d+$/.test(value) || BigInt(value) >= 2n ** BigInt(rangeBits[key])) throw new Error(`${key} must be a valid integer in the circuit range.`);
    }
    if (BigInt(data.income) < BigInt(data.minIncome) || BigInt(data.creditScore) < BigInt(data.minCreditScore) || BigInt(data.medicalRisk) > BigInt(data.maxMedicalRisk)) throw new Error("The demonstration inputs do not satisfy the eligibility thresholds.");
    const coverage = positiveAmount(coverageAmount, "coverage amount");
    const premium = positiveAmount(premiumAmount, "premium amount");
    const policyBeneficiary = beneficiary.trim() || account;
    if (!isAddress(policyBeneficiary) || /^0x0{40}$/i.test(policyBeneficiary)) throw new Error("Enter a valid non-zero beneficiary wallet address.");
    let generated = proofResult;
    if (!generated) {
      generated = await generateEligibilityProof(data);
      setProofResult(generated);
      setProofInfo("Groth16 proof generated in this browser. Raw demonstration inputs were not sent to the chain.");
    }
    const policy = await contract("policy", POLICY_ABI);
    let id = pendingPolicyId ? BigInt(pendingPolicyId) : null;
    if (id === null) {
      const createTx = await policy.createPolicy(data.minIncome, data.minCreditScore, data.maxMedicalRisk, coverage, premium, policyBeneficiary);
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
    setProofInfo(`Eligibility verified for application #${id.toString()}. Pay its demo premium below to activate one-year coverage.`);
    setProofResult(null);
    setPendingPolicyId("");
    // A confirmation is already final at this point. A delayed read must not
    // surface as a failed transaction or hide that success from the user.
    try {
      await loadPolicies();
    } catch {
      setNotice(`Eligibility was verified for application #${id.toString()}. Refresh policy data to display its latest status.`);
    }
  }

  const doPurchasePolicy = (policyId) => run(async () => {
    const policy = await contract("policy", POLICY_ABI);
    const record = await policy.policies(policyId);
    const premium = record[8];
    await approve("mockUSDC", deployments.policy, premium);
    await (await policy.purchasePolicy(policyId)).wait();
    setNotice(`Policy #${policyId} activated for one year. Its demo premium is now part of the shared insurance reserve.`);
  });

  const doSubmitClaim = () => run(async () => {
    if (!claimPolicyId) throw new Error("Choose one of your active policies first.");
    const amount = positiveAmount(claimAmount, "claim amount");
    const selectedPolicy = policies.find((policy) => policy.id === claimPolicyId);
    if (!selectedPolicy || selectedPolicy.status !== 3) throw new Error("Choose a policy that is currently active.");
    if (amount > parseEther(selectedPolicy.coverageAmount)) throw new Error("The requested benefit cannot exceed this policy’s demo coverage amount.");
    const note = claimReference.trim();
    if (note.length < 4) throw new Error("Enter a short demo claim reference so the app can hash it locally.");
    const referenceHash = keccak256(toUtf8Bytes(note));
    const policy = await contract("policy", POLICY_ABI);
    await (await policy.submitClaim(claimPolicyId, amount, referenceHash)).wait();
    setClaimReference("");
    setNotice(`Claim submitted for policy #${claimPolicyId}. The on-chain record contains only a reference hash; a demo claims administrator must review it.`);
  });

  const doReviewClaim = (policyId, approveClaim) => run(async () => {
    const policy = await contract("policy", POLICY_ABI);
    await (await (approveClaim ? policy.approveClaim(policyId) : policy.rejectClaim(policyId))).wait();
    setNotice(approveClaim ? `Claim for policy #${policyId} approved and paid to its recorded beneficiary from the insurance reserve.` : `Claim for policy #${policyId} declined; the policy remains active until its expiry.`);
  });

  const mintDemoTokens = () => run(async () => {
    const token = await contract("mockUSDC", TOKEN_ABI);
    const tx = await token.mint(account, parseEther("1000")); await tx.wait();
    setNotice("Minted 1,000 demo USDC to this wallet.");
  });

  const doVault = () => run(async () => {
    const amount = positiveAmount(vaultAmount, "asset amount");
    const vault = await contract("vaultShares", VAULT_ABI);
    await approve("mockUSDC", deployments.vaultShares, amount);
    const tx = await vault.deposit(amount, account); await tx.wait();
    setNotice("Assets deposited into the demo ERC-4626 vault; vault shares were minted.");
  });

  const doVaultMint = () => run(async () => {
    const shares = positiveAmount(vaultSharesAmount, "share amount");
    const vault = await contract("vaultShares", VAULT_ABI);
    const assets = await vault.previewMint(shares);
    await approve("mockUSDC", deployments.vaultShares, assets);
    await (await vault["mint(uint256,address)"](shares, account)).wait();
    setNotice("Requested vault shares minted for the previewed asset amount.");
  });

  const doVaultWithdraw = () => run(async () => {
    const assets = positiveAmount(vaultAmount, "asset amount");
    const vault = await contract("vaultShares", VAULT_ABI);
    await (await vault.withdraw(assets, account, account)).wait();
    setNotice("Underlying demo assets withdrawn by burning the required vault shares.");
  });

  const doVaultRedeem = () => run(async () => {
    const shares = positiveAmount(vaultSharesAmount, "share amount");
    const vault = await contract("vaultShares", VAULT_ABI);
    await (await vault.redeem(shares, account, account)).wait();
    setNotice("Vault shares redeemed for underlying demo assets.");
  });

  const doAmmAdd = () => run(async () => {
    const amountA = positiveAmount(ammA, "Demo USDC amount"), amountB = positiveAmount(ammB, "vINS amount");
    const amm = await contract("simpleAMM", AMM_ABI);
    await approve("mockUSDC", deployments.simpleAMM, amountA);
    await approve("vaultShares", deployments.simpleAMM, amountB);
    const tx = await amm.addLiquidity(amountA, amountB, 0); await tx.wait();
    setNotice("Liquidity added to the SimpleAMM pool.");
  });

  const doAmmSwap = () => run(async () => {
    const amount = positiveAmount(tradeAmount, "swap amount");
    const amm = await contract("simpleAMM", AMM_ABI);
    const isAssetIn = tradeDirection === "asset-to-share";
    const tokenKey = isAssetIn ? "mockUSDC" : "vaultShares";
    const token = await contract(tokenKey, TOKEN_ABI);
    await approve(tokenKey, deployments.simpleAMM, amount);
    const reserves = await Promise.all([amm.reserveA(), amm.reserveB()]);
    const quote = await amm.getAmountOut(amount, reserves[isAssetIn ? 0 : 1], reserves[isAssetIn ? 1 : 0]);
    const tx = isAssetIn ? await amm.swapExactAForB(amount, quote * 99n / 100n) : await amm.swapExactBForA(amount, quote * 99n / 100n);
    await tx.wait(); setNotice("Swap completed on the SimpleAMM pool.");
  });

  const doAmmRemove = () => run(async () => {
    const shares = positiveAmount(ammLpAmount, "LP share amount");
    const amm = await contract("simpleAMM", AMM_ABI);
    await (await amm.removeLiquidity(shares, 0, 0)).wait();
    setNotice("SimpleAMM LP shares burned and pool assets returned.");
  });

  const doFarm = () => run(async () => {
    const amount = positiveAmount(lpAmount, "LP share amount"), farm = await contract("yieldFarm", FARM_ABI);
    await approve("simpleAMM", deployments.yieldFarm, amount);
    const tx = await farm.stake(amount); await tx.wait(); setNotice("AMM LP shares staked in the yield farm.");
  });

  const doFarmWithdraw = () => run(async () => {
    const amount = positiveAmount(lpAmount, "LP share amount"), farm = await contract("yieldFarm", FARM_ABI);
    await (await farm.withdraw(amount)).wait(); setNotice("LP shares withdrawn from the yield farm; accrued rewards remain claimable.");
  });

  const doStake = () => run(async () => {
    const amount = positiveAmount(stakeAmount, "vault share amount"), staking = await contract("staking", STAKING_ABI);
    await approve("vaultShares", deployments.staking, amount);
    const tx = await staking.stake(amount); await tx.wait(); setNotice("Vault shares staked in the direct staking service.");
  });

  const doUnstake = () => run(async () => {
    const amount = positiveAmount(stakeAmount, "vault share amount"), staking = await contract("staking", STAKING_ABI);
    await (await staking.unstake(amount)).wait(); setNotice("Vault shares unstaked; accrued rewards remain claimable.");
  });

  const doDexSwap = () => run(async () => {
    const amount = positiveAmount(dexTradeAmount, "swap amount");
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
    await tx.wait(); setNotice("Swap completed through the DEX router.");
  });

  const doDexAdd = () => run(async () => {
    const amountA = positiveAmount(dexA, "first token amount"), amountB = positiveAmount(dexB, "second token amount");
    await approve(dexTokenA, deployments.dexRouter, amountA);
    await approve(dexTokenB, deployments.dexRouter, amountB);
    const router = await contract("dexRouter", ROUTER_ABI);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    await (await router.addLiquidity(deployments[dexTokenA], deployments[dexTokenB], amountA, amountB, 0, 0, account, deadline)).wait();
    setNotice("Liquidity added to the DEX pair.");
  });

  const doDexRemove = () => run(async () => {
    const amount = positiveAmount(dexLpAmount, "LP amount");
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
      <main className="main-content"><div className="page-heading"><div><div className="eyebrow">INSURECHAIN · {SECTIONS[active].eyebrow}</div><h1>{SECTIONS[active].title}</h1><p>{SECTIONS[active].description}</p></div>{active !== 0 && <button className="button button-secondary" onClick={async () => { await refresh(); if (historyToken) await syncHistory(historyToken); }}><RefreshCw size={15}/> Refresh page data</button>}</div>
        {notice && <div className="notice" role="status">{notice}</div>}
        {wrongNetwork && <div className="notice warning">Connected to chain {BigInt(chainId).toString()}; switch to configured chain {configuredChainId} before submitting transactions.</div>}
        {!deployments && <div className="notice warning">Deployment registry not found. Run <code>npm run deploy:local</code> after starting the Hardhat node.</div>}
        {active === 0 && <HomeDashboard connected={connected} account={account} wrongNetwork={wrongNetwork} chainId={chainId} configuredChainId={configuredChainId} deployments={deployments} balances={balances} policies={policies} activities={activities} historyToken={historyToken} historyStatus={historyStatus} historyBusy={historyBusy} onEnableHistory={enableHistory} onSyncHistory={() => syncHistory()} onNavigate={setActive} onConnect={connect} onConnectWalletConnect={connectWalletConnect} onSwitchNetwork={switchNetwork} onRefresh={refresh} contract={contract} refreshKey={refreshVersion}/>}

        {active === 1 && <>
          <div className="content-grid insurance-flow-grid">
            <Card title="1 · Apply and prove eligibility" icon={<LockKeyhole/>} description="The browser creates a Groth16 proof from demo inputs. Only the proof and public policy terms go on-chain.">
              <p className="flow-note">Use sample values only. The private eligibility inputs stay in this browser; the policy does not activate until its premium is paid.</p>
              <div className="fields-grid">{Object.entries(eligibility).map(([key, value]) => <Field key={key} label={key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())} value={value} onChange={(next) => { setEligibility((previous) => ({ ...previous, [key]: next })); setProofResult(null); setPendingPolicyId(""); setProofInfo(""); }}/>)}</div>
              <div className="fields-grid"><Field label="Demo benefit amount · USDC" value={coverageAmount} onChange={setCoverageAmount}/><Field label="One-time demo premium · USDC" value={premiumAmount} onChange={setPremiumAmount}/></div>
              <Field label="Beneficiary wallet (defaults to you)" value={beneficiary} onChange={setBeneficiary} placeholder={account || "0x…"}/>
              <p className="muted">Demo cover term: one year. The premium is deposited into the shared reserve vault after proof verification.</p>
              <button disabled={busy || !connected} className="button button-primary wide" onClick={() => run(submitEligibility)}>{busy ? "Generating proof / waiting for chain…" : pendingPolicyId ? `Retry pending application #${pendingPolicyId}` : "Create application and verify eligibility"}</button>
              {proofInfo && <p className="muted result">{proofInfo}</p>}
            </Card>
            <Card title="2 · Activate and manage policies" icon={<ShieldCheck/>} description="Pay the quoted demo premium to activate cover, then track its beneficiary, term, and status.">
              <button className="button button-secondary" onClick={() => loadPolicies().catch((error) => setAlertMessage(messageOf(error)))}>Refresh my policies</button>
              <div className="record-list">{policies.map((policy) => <article className="record policy-record" key={policy.id}>
                <div className="policy-record-heading"><strong>Policy #{policy.id}</strong><span className={`status status-${policy.status}`}>{["None", "Awaiting proof", "Eligible · premium due", "Active", "Claim under review", "Benefit paid", "Expired", "Rejected"][policy.status] || "Unknown"}</span></div>
                <small>Benefit {Number(policy.coverageAmount).toLocaleString()} USDC · Premium {Number(policy.premiumAmount).toLocaleString()} USDC · Term one year</small>
                <small>Beneficiary {short(policy.beneficiary)} · Income ≥ {policy.minIncome} · Credit ≥ {policy.minCreditScore} · Risk ≤ {policy.maxMedicalRisk}</small>
                {policy.status === 2 && <button className="button button-primary wide" disabled={busy || !connected || wrongNetwork} onClick={() => doPurchasePolicy(policy.id)}>Approve premium and activate</button>}
                {policy.status === 3 && <small>In force until {new Date(policy.expiresAt * 1000).toLocaleDateString()}.</small>}
                {policy.status === 4 && <small>A demo claim is awaiting the reserve administrator’s review.</small>}
                {policy.status === 5 && <small>Claim paid to the recorded beneficiary.</small>}
              </article>)}{!policies.length && <p className="muted">Your applications and policy records will appear here.</p>}</div>
            </Card>
            <Card title="3 · Submit a demo claim" icon={<Landmark/>} description="A policyholder requests a benefit; the reserve administrator reviews it and, if approved, pays the beneficiary from policy-owned vault shares.">
              <label className="field"><span>Active policy</span><select className="select" value={claimPolicyId} onChange={(event) => setClaimPolicyId(event.target.value)}><option value="">Select one of your active policies</option>{policies.filter((policy) => policy.status === 3).map((policy) => <option key={policy.id} value={policy.id}>Policy #{policy.id} · {policy.coverageAmount} USDC cover</option>)}</select></label>
              <Field label="Requested benefit · USDC" value={claimAmount} onChange={setClaimAmount}/>
              <Field label="Demo claim reference (hashed locally)" value={claimReference} onChange={setClaimReference} placeholder="e.g. demo-case-001"/>
              <p className="muted">Never enter medical records, death certificates, identity details, or other sensitive information. Only a hash of this demo reference is written to the chain.</p>
              <small className="muted">Claims administrator: {short(deployments?.deployer)}. Switch to that wallet after submission to review the request. A wallet cannot approve a claim on its own policy.</small>
              <button className="button button-primary wide" disabled={busy || !connected || wrongNetwork || !policies.some((policy) => policy.status === 3)} onClick={doSubmitClaim}>Submit claim for review</button>
            </Card>
            {connected && deployments?.deployer?.toLowerCase() === account.toLowerCase() && <ClaimsReview contract={contract} refreshKey={refreshVersion} busy={busy} reviewer={account} onReview={doReviewClaim}/>}
          </div>
          <ToolHistory title="Insurance lifecycle history" description="Applications, private eligibility verification, premium payments, policy activation, and demo claim decisions." category="insurance" activities={activities} historyToken={historyToken} historyBusy={historyBusy} onEnableHistory={enableHistory} onSyncHistory={() => syncHistory()}/>
        </>}

        {active === 2 && <><div className="content-grid"><Card title="Personal deposits and insurance reserve" icon={<Layers3/>} description="Your personal deposits mint wallet-owned vINS. Policy premiums are deposited separately and held by the policy contract as reserve backing."><Field label="Asset amount · deposit or withdraw" value={vaultAmount} onChange={setVaultAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doVault}>Approve and deposit assets</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doVaultWithdraw}>Withdraw asset amount</button><Field label="Share amount · mint or redeem" value={vaultSharesAmount} onChange={setVaultSharesAmount}/><button className="button button-secondary wide" disabled={busy || !connected} onClick={doVaultMint}>Mint exact shares</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doVaultRedeem}>Redeem shares</button></Card><Card title="Faucet and vault position" icon={<Coins/>} description="The faucet is local-demo only; the vault has no strategy or promised yield."><button className="button button-primary" disabled={busy || !connected} onClick={mintDemoTokens}>Mint 1,000 demo USDC</button><VaultStats key={`${account}:${chainId}`} contract={contract} deployments={deployments} refreshKey={refreshVersion}/><InsuranceReserveStats contract={contract} refreshKey={refreshVersion} connected={connected}/></Card></div><ToolHistory title="Reserve vault history" description="Demo USDC issued, vault shares created, and assets withdrawn or redeemed." category="vault" activities={activities} historyToken={historyToken} historyBusy={historyBusy} onEnableHistory={enableHistory} onSyncHistory={() => syncHistory()}/></>}

        {active === 3 && <><div className="notice">Insurance connection: this market provides liquidity for personal vINS vault shares, the same share token issued when policy premiums enter the reserve. Policy-owned reserve shares stay locked in the policy contract.</div><div className="content-grid"><Card title="Liquidity · SimpleAMM" icon={<Layers3/>} description="Demo USDC and personal vINS form a market for the insurance reserve share asset. LP shares are issued by the pool contract."><Field label="Demo USDC amount" value={ammA} onChange={setAmmA}/><Field label="vINS amount" value={ammB} onChange={setAmmB}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doAmmAdd}>Approve and add liquidity</button><AmmStats key={`${account}:${chainId}`} contract={contract} refreshKey={refreshVersion}/><Field label="LP shares to remove" value={ammLpAmount} onChange={setAmmLpAmount}/><button className="button button-secondary wide" disabled={busy || !connected} onClick={doAmmRemove}>Remove liquidity</button></Card><Card title="Swap · SimpleAMM" icon={<ArrowRightLeft/>} description="Constant-product pool with a 0.30% fee and a 1% demo slippage tolerance."><select className="select" value={tradeDirection} onChange={(event) => setTradeDirection(event.target.value)}><option value="asset-to-share">Demo USDC → vINS</option><option value="share-to-asset">vINS → Demo USDC</option></select><Field label="Input amount" value={tradeAmount} onChange={setTradeAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doAmmSwap}>Swap</button></Card></div><ToolHistory title="Liquidity pool history" description="Pool deposits, assets removed, swaps, and LP token approvals." category="liquidity" activities={activities} historyToken={historyToken} historyBusy={historyBusy} onEnableHistory={enableHistory} onSyncHistory={() => syncHistory()}/></>}

        {active === 4 && <><div className="notice">Insurance connection: the farm incentivizes market liquidity for demo USDC and personal vINS. Rewards are RWD and do not come from premiums or the policy reserve.</div><div className="content-grid"><Card title="Stake AMM LP shares" icon={<Coins/>} description="Stake AMM LP shares and accrue RWD over the configured reward period."><Field label="LP share amount to stake or withdraw" value={lpAmount} onChange={setLpAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doFarm}>Approve and stake</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doFarmWithdraw}>Withdraw staked LP shares</button><RewardActions kind="farm" contract={contract} account={account} busy={busy} run={run}/></Card><Card title="Reward schedule" icon={<CircleDollarSign/>} description="The deployer funds the RWD incentive schedule for LPs providing liquidity to the demo reserve-share market."><RewardStats key={`${account}:${chainId}`} contract={contract} account={account} kind="farm" refreshKey={refreshVersion}/><p className="muted">The farm stakes the LP token from the SimpleAMM pool; it does not stake vault shares directly.</p></Card></div><ToolHistory title="Yield farming history" description="LP shares staked or withdrawn and RWD rewards claimed." category="farming" activities={activities} historyToken={historyToken} historyBusy={historyBusy} onEnableHistory={enableHistory} onSyncHistory={() => syncHistory()}/></>}

        {active === 5 && <><div className="notice">Insurance connection: vINS is the share token issued for premiums and personal vault deposits. This staking page uses only the connected account’s personal vINS; policy-held shares cannot be staked here.</div><div className="content-grid"><Card title="Stake vINS directly" icon={<Coins/>} description="Stake personal ERC-4626 shares directly, separately from AMM LP tokens and locked policy reserve shares."><Field label="Vault share amount to stake or unstake" value={stakeAmount} onChange={setStakeAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doStake}>Approve and stake</button><button className="button button-secondary wide" disabled={busy || !connected} onClick={doUnstake}>Unstake vault shares</button><RewardActions kind="staking" contract={contract} account={account} busy={busy} run={run}/></Card><Card title="Direct staking rewards" icon={<CircleDollarSign/>} description="Rewards use the configured time-based emission schedule."><RewardStats key={`${account}:${chainId}`} contract={contract} account={account} kind="staking" refreshKey={refreshVersion}/><p className="muted">Direct staking and yield farming are separate contracts and positions.</p></Card></div><ToolHistory title="Direct staking history" description="vINS shares staked or unstaked and RWD rewards claimed." category="staking" activities={activities} historyToken={historyToken} historyBusy={historyBusy} onEnableHistory={enableHistory} onSyncHistory={() => syncHistory()}/></>}

        {active === 6 && <><div className="notice">Insurance connection: the DEX lets users exchange personal demo USDC, vINS reserve shares, and RWD. It cannot trade policy-owned reserve shares or route claim payments.</div><div className="content-grid"><Card title="Pair liquidity · DEX" icon={<Layers3/>} description="The DEX factory creates selected token pairs; the router adds and removes their liquidity."><select className="select" value={dexTokenA} onChange={(event) => setDexTokenA(event.target.value)}><TokenOptions exclude={dexTokenB}/></select><select className="select" value={dexTokenB} onChange={(event) => setDexTokenB(event.target.value)}><TokenOptions exclude={dexTokenA}/></select><Field label="First token desired amount" value={dexA} onChange={setDexA}/><Field label="Second token desired amount" value={dexB} onChange={setDexB}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doDexAdd}>Approve and add liquidity</button><Field label="DEX LP amount to remove" value={dexLpAmount} onChange={setDexLpAmount}/><button className="button button-secondary wide" disabled={busy || !connected} onClick={doDexRemove}>Remove pair liquidity</button><DexPairStats key={`${account}:${chainId}`} contract={contract} deployments={deployments} refreshKey={refreshVersion}/></Card><Card title="Swap · DEX Router" icon={<ArrowRightLeft/>} description="Trade personal demo USDC, vINS reserve shares, and RWD. The router applies fees, deadline, and minimum-output protection."><select className="select" value={dexRoute} onChange={(event) => setDexRoute(event.target.value)}><option value="direct">Direct selected-token pair</option><option value="asset-share-reward">Multi-hop: demo USDC → vINS → RWD</option></select>{dexRoute === "direct" && <><select className="select" value={dexTokenA} onChange={(event) => setDexTokenA(event.target.value)}><TokenOptions exclude={dexTokenB}/></select><select className="select" value={dexTokenB} onChange={(event) => setDexTokenB(event.target.value)}><TokenOptions exclude={dexTokenA}/></select></> }<select className="select" value={tradeDirection} onChange={(event) => setTradeDirection(event.target.value)}><option value="asset-to-share">Forward path</option><option value="share-to-asset">Reverse path</option></select><Field label="Input amount" value={dexTradeAmount} onChange={setDexTradeAmount}/><button className="button button-primary wide" disabled={busy || !connected} onClick={doDexSwap}>Swap through router</button><p className="muted">For multi-hop swaps, create and seed both adjacent pairs first.</p></Card></div><ToolHistory title="Exchange history" description="DEX pair creation, liquidity, swaps, and LP token approvals." category="exchange" activities={activities} historyToken={historyToken} historyBusy={historyBusy} onEnableHistory={enableHistory} onSyncHistory={() => syncHistory()}/></>}

        {active !== 0 && <footer className="disclaimer">Student demonstration only. No real insurance coverage or claim adjudication is provided. Never enter real medical, identity, or financial information. Demo premiums, benefits, tokens, reserves, pools, and rewards have no real-world value.</footer>}
      </main>
    </div>
    {alertMessage && <div className="alert-overlay"><section className="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-description"><div className="alert-icon"><AlertTriangle size={24}/></div><div className="alert-copy"><h2 id="alert-title">Action could not be completed</h2><p id="alert-description">{alertMessage}</p><button className="button button-primary" autoFocus onClick={() => setAlertMessage("")}>Close</button></div><button className="alert-close" aria-label="Close alert" onClick={() => setAlertMessage("")}>×</button></section></div>}
  </div>;
}

function HomeDashboard({ connected, account, wrongNetwork, chainId, configuredChainId, deployments, balances, policies, activities, historyToken, historyStatus, historyBusy, onEnableHistory, onSyncHistory, onNavigate, onConnect, onConnectWalletConnect, onSwitchNetwork, onRefresh, contract, refreshKey }) {
  const services = [
    { title: "Policy lifecycle", copy: "Prove sample eligibility, activate a one-year demo policy, and submit a hashed-reference claim.", icon: <LockKeyhole/>, target: 1, tag: "Insurance" },
    { title: "Insurance reserve", copy: "Policy premiums buy vINS shares held by the policy contract to back reviewed demo benefits.", icon: <Landmark/>, target: 2, tag: "ERC-4626" },
    { title: "Liquidity and swaps", copy: "Provide liquidity for the vINS share token used by policy premiums, then trade personal demo USDC and vINS.", icon: <ArrowRightLeft/>, target: 3, tag: "AMM" },
    { title: "LP yield farming", copy: "Earn demo RWD incentives by staking LP shares in the reserve-share market.", icon: <TrendingUp/>, target: 4, tag: "Rewards" },
    { title: "Direct staking", copy: "Stake personal vINS shares in a separate demo reward pool; policy reserve shares remain locked.", icon: <Coins/>, target: 5, tag: "Rewards" },
    { title: "Token exchange", copy: "Exchange personal demo USDC, vINS reserve shares, and RWD through direct or multi-hop routes.", icon: <Activity/>, target: 6, tag: "DEX" },
  ];
  const accountState = wrongNetwork ? "Wrong network" : connected ? "Wallet connected" : "Wallet not connected";
  return <div className="home-dashboard">
    <section className="home-hero" id="home">
      <div className="hero-copy"><div className="hero-kicker"><Sparkles size={14}/> INSURANCE ELIGIBILITY + DECENTRALIZED FINANCE</div><h2>A transparent demo from eligibility proof through reserve-backed benefits.</h2><p>InsureChain connects a browser-generated eligibility proof to a demo policy, premium contribution, shared vault reserve, and administrator-reviewed benefit request. Then explore how separate personal DeFi positions use the same demo assets and vault shares.</p><div className="hero-actions"><button className="button button-primary" onClick={() => onNavigate(1)}>Start eligibility check <ArrowRight size={15}/></button><button className="button button-secondary" onClick={() => onNavigate(2)}>Explore the DeFi tools</button></div></div>
      <div className="hero-status"><div className="status-heading"><span className={connected && !wrongNetwork ? "live-dot" : "live-dot inactive"}/><strong>{accountState}</strong></div><p>{connected ? `Account ${short(account)}` : "Connect a wallet to read balances and submit demo transactions."}</p><div className="status-row"><span>Network</span><b>{chainId ? `Chain ${BigInt(chainId).toString()}` : `Expected ${configuredChainId}`}</b></div><div className="status-row"><span>Contracts</span><b className={deployments ? "status-ready" : "status-missing"}>{deployments ? "Deployment found" : "Not deployed"}</b></div>{connected && <button className="button button-secondary wide" onClick={onRefresh}><RefreshCw size={14}/> Refresh wallet overview</button>}{!connected && <div className="hero-wallet-actions"><button className="button button-primary" onClick={onConnect}><Wallet size={15}/> Connect MetaMask</button><button className="button button-secondary" onClick={onConnectWalletConnect}>WalletConnect</button></div>}{wrongNetwork && <button className="button button-secondary wide" onClick={onSwitchNetwork}>Switch to chain {configuredChainId}</button>}</div>
    </section>
    <section className="home-section"><div className="section-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h2>Wallet overview</h2></div><span className="section-hint">Values are demo tokens on the selected test chain.</span></div><div className="metrics-grid"><Metric title="Demo USDC" value={connected ? (balances.mockUSDC || "0") : "—"}/><Metric title="vINS vault shares" value={connected ? (balances.vaultShares || "0") : "—"}/><Metric title="AMM LP shares" value={connected ? (balances.lpFarm || "0") : "—"}/><Metric title="RWD reward token" value={connected ? (balances.rewardToken || "0") : "—"}/></div>{connected && <div className="dashboard-footnote"><BadgeCheck size={15}/> {policies.length ? `${policies.length} policy record${policies.length === 1 ? "" : "s"} loaded for this wallet.` : "No policy records are currently loaded for this wallet."}</div>}<InsuranceReserveStats contract={contract} refreshKey={refreshKey} connected={connected}/></section>
    <section className="home-section history-section"><div className="section-heading"><div><div className="eyebrow">POLICY + TRANSACTION RECORDS</div><h2>Your activity history</h2><p className="section-hint">Policy records and recognized DApp contract events associated with this wallet.</p></div><div className="history-controls">{historyToken ? <button className="button button-secondary" disabled={historyBusy} onClick={onSyncHistory}><RefreshCw size={14}/> Refresh history</button> : <button className="button button-primary" disabled={!connected || wrongNetwork || historyBusy} onClick={onEnableHistory}>{historyBusy ? "Verifying wallet…" : "Enable private history"}</button>}</div></div><p className="history-status">{historyStatus}</p><div className="history-body-grid"><section className="history-panel policy-panel"><div className="history-panel-heading"><div><span className="eyebrow">INSURANCE</span><h3>Policy records</h3></div><span className="history-count">{policies.length}</span></div><div className="policy-history">{policies.map((policy) => <article className="history-card" key={policy.id}><div><strong>Policy #{policy.id}</strong><span className={`status status-${policy.status}`}>{["None", "Awaiting proof", "Eligible · premium due", "Active", "Claim under review", "Benefit paid", "Expired", "Rejected"][policy.status] || "Unknown"}</span></div><p>Benefit {Number(policy.coverageAmount).toLocaleString()} USDC · Premium {Number(policy.premiumAmount).toLocaleString()} USDC · Beneficiary {short(policy.beneficiary)}</p><small>Income ≥ {policy.minIncome} · Credit ≥ {policy.minCreditScore} · Risk ≤ {policy.maxMedicalRisk} · Created {policy.createdAt ? new Date(policy.createdAt * 1000).toLocaleString() : "time unavailable"}</small></article>)}{connected && !policies.length && <p className="muted">No policy records found for this wallet.</p>}</div></section><section className="history-panel activity-panel"><div className="history-panel-heading"><div><span className="eyebrow">ON-CHAIN</span><h3>DApp activity</h3></div><span className="history-count">{activities.length}</span></div><div className="activity-list">{activities.map((event) => <article className="activity-item" key={event.key}><span className="activity-category">{event.category}</span><div className="activity-detail"><strong>{event.title}</strong><p>{event.summary}</p><small>{new Date(event.timestamp).toLocaleString()} · block {event.blockNumber} · tx {short(event.txHash)}</small></div></article>)}{historyToken && !activities.length && <p className="muted">No recognized contract activity found yet.</p>}{!historyToken && <p className="muted">Enable history to verify wallet ownership and load activity from the chain.</p>}</div></section></div><small className="history-privacy">History login is an off-chain signature, not a blockchain transaction. The backend indexes public contract events; private ZK eligibility inputs are not sent to it.</small></section>
    <section className="home-section"><div className="section-heading"><div><div className="eyebrow">WHAT YOU CAN DO</div><h2>Explore the services</h2></div><span className="section-hint">Choose a tool to open its workspace.</span></div><div className="services-grid">{services.map((service) => <button className="service-card" key={service.title} onClick={() => onNavigate(service.target)}><span className="service-icon">{service.icon}</span><span className="service-tag">{service.tag}</span><strong>{service.title}</strong><span className="service-copy">{service.copy}</span><span className="service-link">Open tool <ArrowRight size={14}/></span></button>)}</div></section>
    <section className="home-section"><div className="section-heading"><div><div className="eyebrow">SUGGESTED JOURNEY</div><h2>How insurance and DeFi connect</h2></div></div><div className="journey-grid"><div className="journey-step"><span>01</span><div><strong>Prove eligibility</strong><p>Generate the proof in your browser; the policy contract records only public thresholds and verification status.</p></div></div><div className="journey-step"><span>02</span><div><strong>Activate a demo policy</strong><p>Approve its quoted premium. The policy contract deposits it into the ERC-4626 reserve and holds the resulting vINS shares.</p></div></div><div className="journey-step"><span>03</span><div><strong>Review a benefit request</strong><p>Submit a demo claim reference; the reserve administrator can approve payment to the named beneficiary if reserves cover it.</p></div></div><div className="journey-step"><span>04</span><div><strong>Explore the DeFi tools</strong><p>Use personal demo tokens and shares in pools, farming, staking, and exchange flows. Those positions are educational and separate from policy reserves.</p></div></div></div></section>
    <section className="scope-note"><LockKeyhole size={18}/><div><strong>Educational prototype</strong><p>This prototype demonstrates a complete on-chain policy lifecycle with sample eligibility, demo premiums, a seeded reserve, and an administrator-reviewed demo claim. It is not real insurance: there is no trusted underwriting source or real claim evidence, and every asset and payment has no real-world value. Never enter real medical, identity, or financial information.</p></div></section>
  </div>;
}
function InsuranceReserveStats({ contract, refreshKey, connected }) {
  const [values, setValues] = useState(null);
  useEffect(() => {
    let live = true;
    if (!connected) { setValues(null); return () => { live = false; }; }
    (async () => {
      try {
        const [vault, policy] = await Promise.all([contract("vaultShares", VAULT_ABI), contract("policy", POLICY_ABI)]);
        const [assets, reserveBacking] = await Promise.all([vault.totalAssets(), policy.reserveBalance()]);
        if (live) setValues({ assets: formatEther(assets), backing: formatEther(reserveBacking) });
      } catch { if (live) setValues(null); }
    })();
    return () => { live = false; };
  }, [contract, refreshKey, connected]);
  return <div className="insurance-reserve-summary"><div><span className="eyebrow">POLICY PREMIUMS SUPPORT THIS POOL</span><strong>Insurance reserve · {connected ? (values?.backing ?? "Loading…") : "Connect wallet to view"} demo USDC</strong><small>Policy premiums are deposited as vINS shares and held by the policy contract for reviewed demo benefits.</small></div><div><span>All vault assets</span><b>{connected ? (values?.assets ?? "—") : "—"} USDC</b></div></div>;
}

function ClaimsReview({ contract, refreshKey, busy, reviewer, onReview }) {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const policy = await contract("policy", POLICY_ABI);
        const count = Number(await policy.nextPolicyId());
        const requests = await Promise.all(Array.from({ length: Math.max(0, count) }, (_, index) => index + 1).map(async (id) => {
          const [record, claim] = await Promise.all([policy.policies(id), policy.claims(id)]);
          if (Number(record[10]) !== 4 || claim[3] || record[0].toLowerCase() === reviewer.toLowerCase()) return null;
          return { id: String(id), holder: record[0], beneficiary: record[9], amount: formatEther(claim[0]), requestedAt: Number(claim[1]), evidenceHash: claim[2] };
        }));
        if (live) setQueue(requests.filter(Boolean));
      } catch { if (live) setQueue([]); }
    })();
    return () => { live = false; };
  }, [contract, refreshKey, reviewer]);
  return <Card title="4 · Reserve administrator review" icon={<ShieldCheck/>} description="The deployment account reviews requests from other wallets. Approval pays the named beneficiary from insurance-owned vINS reserve shares.">
    <div className="record-list">{queue.map((claim) => <article className="record claim-record" key={claim.id}><div className="policy-record-heading"><strong>Policy #{claim.id} · {claim.amount} USDC requested</strong><span className="status status-4">Under review</span></div><small>Holder {short(claim.holder)} · Beneficiary {short(claim.beneficiary)}</small><small>Reference hash {short(claim.evidenceHash)} · Submitted {new Date(claim.requestedAt * 1000).toLocaleString()}</small><div className="button-row"><button className="button button-primary" disabled={busy} onClick={() => onReview(claim.id, true)}>Approve and pay</button><button className="button button-secondary" disabled={busy} onClick={() => onReview(claim.id, false)}>Decline claim</button></div></article>)}{!queue.length && <p className="muted">No submitted claims are waiting for review.</p>}</div>
  </Card>;
}

function ToolHistory({ title, description, category, activities, historyToken, historyBusy, onEnableHistory, onSyncHistory }) {
  const rows = activities.filter((event) => event.category === category);
  return <section className="tool-history"><div className="tool-history-heading"><div><div className="eyebrow">THIS TOOL · TRANSACTION HISTORY</div><h2>{title}</h2><p>{description}</p></div>{historyToken ? <button className="button button-secondary" disabled={historyBusy} onClick={onSyncHistory}><RefreshCw size={14}/> Refresh history</button> : <button className="button button-primary" disabled={historyBusy} onClick={onEnableHistory}>{historyBusy ? "Verifying wallet…" : "Enable history"}</button>}</div>{!historyToken ? <div className="tool-history-empty">Sign a wallet message to load this tool’s activity. The signature is free and does not send a transaction.</div> : <div className="tool-history-list">{rows.map((event) => <article className="tool-history-item" key={event.key}><div className="tool-history-main"><span className="tool-event-category">{event.category}</span><div><strong>{event.title}</strong><p>{event.summary}</p></div></div><div className="tool-history-meta"><time>{new Date(event.timestamp).toLocaleString()}</time><span>Block {event.blockNumber}</span><span>Tx {short(event.txHash)}</span></div></article>)}{!rows.length && <div className="tool-history-empty">No {title.toLowerCase()} activity found for this wallet yet.</div>}</div>}</section>;
}
function Metric({ title, value }) { return <div className="metric"><span>{title}</span><strong>{value === "—" ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong></div>; }
function Card({ title, icon, description, children }) { return <article className="card"><div className="card-title"><span className="card-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div>{children}</article>; }
function VaultStats({ contract, deployments, refreshKey }) {
  const [values, setValues] = useState(null);
  useEffect(() => { let live = true; if (!deployments?.vaultShares) return; (async () => { try { const vault = await contract("vaultShares", VAULT_ABI); const [assets, shares] = await Promise.all([vault.totalAssets(), vault.totalSupply()]); if (live) setValues({ assets: formatEther(assets), shares: formatEther(shares) }); } catch {} })(); return () => { live = false; }; }, [contract, deployments, refreshKey]);
  return <div className="stats"><span>Total assets <b>{values?.assets ?? "—"}</b></span><span>Shares outstanding <b>{values?.shares ?? "—"}</b></span></div>;
}
function AmmStats({ contract, refreshKey }) {
  const [values, setValues] = useState(null);
  useEffect(() => { let live = true; (async () => { try { const amm = await contract("simpleAMM", AMM_ABI); const [a, b, supply] = await Promise.all([amm.reserveA(), amm.reserveB(), amm.totalSupply()]); if (live) setValues([a, b, supply].map(formatEther)); } catch {} })(); return () => { live = false; }; }, [contract, refreshKey]);
  return <div className="stats"><span>Reserve A <b>{values?.[0] ?? "—"}</b></span><span>Reserve B <b>{values?.[1] ?? "—"}</b></span><span>LP supply <b>{values?.[2] ?? "—"}</b></span></div>;
}
function DexPairStats({ contract, deployments, refreshKey }) {
  const [pair, setPair] = useState("");
  useEffect(() => { let live = true; (async () => { try { const factory = await contract("dexFactory", FACTORY_ABI); const found = await factory.getPair(deployments.mockUSDC, deployments.vaultShares); if (live) setPair(found); } catch {} })(); return () => { live = false; }; }, [contract, deployments, refreshKey]);
  return <div className="stats"><span>Pair address <b>{pair && pair !== "0x0000000000000000000000000000000000000000" ? short(pair) : "Not created yet"}</b></span><span>Factory <b>{deployments?.dexFactory ? short(deployments.dexFactory) : "—"}</b></span></div>;
}
function RewardActions({ kind, contract, account, run, busy }) {
  const exit = () => run(async () => { const c = await contract(kind === "farm" ? "yieldFarm" : "staking", kind === "farm" ? FARM_ABI : STAKING_ABI); await (await c.exit()).wait(); });
  const claim = () => run(async () => { const c = await contract(kind === "farm" ? "yieldFarm" : "staking", kind === "farm" ? FARM_ABI : STAKING_ABI); await (await (kind === "farm" ? c.getReward() : c.claimReward())).wait(); });
  return <div className="button-row"><button className="button button-secondary" disabled={busy || !account} onClick={claim}>Claim reward</button><button className="button button-secondary" disabled={busy || !account} onClick={exit}>Exit position</button></div>;
}
function RewardStats({ contract, account, kind, refreshKey }) {
  const [values, setValues] = useState(null);
  useEffect(() => { let live = true; if (!account) return; (async () => { try { const c = await contract(kind === "farm" ? "yieldFarm" : "staking", kind === "farm" ? FARM_ABI : STAKING_ABI); const [staked, earned] = await Promise.all([kind === "farm" ? c.balanceOf(account) : c.stakedBalance(account), c.earned(account)]); if (live) setValues([formatEther(staked), formatEther(earned)]); } catch {} })(); return () => { live = false; }; }, [contract, account, kind, refreshKey]);
  return <div className="stats"><span>Your staked balance <b>{values?.[0] ?? "—"}</b></span><span>Accrued rewards <b>{values?.[1] ?? "—"}</b></span></div>;
}
function TokenOptions({ exclude }) {
  const options = [["mockUSDC", "Demo USDC"], ["vaultShares", "vINS vault share"], ["rewardToken", "RWD reward token"]].filter(([key]) => key !== exclude);
  return options.map(([key, label]) => <option key={key} value={key}>{label}</option>);
}
