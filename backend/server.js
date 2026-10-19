import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { JsonRpcProvider, Interface, formatUnits, getAddress, isAddress, verifyMessage } from "ethers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const envFile of [".env", ".env.local"]) {
  try {
    const text = fs.readFileSync(path.join(ROOT, envFile), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch {}
}

const PORT = Number(process.env.BACKEND_PORT || 3001);
const CHAIN_ID = BigInt(process.env.BACKEND_CHAIN_ID || process.env.VITE_CHAIN_ID || "31337");
const RPC_URL = process.env.BACKEND_RPC_URL || process.env.VITE_RPC_URL || "http://127.0.0.1:8545";
const ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173", ...(process.env.FRONTEND_ORIGIN || "").split(",").map((x) => x.trim()).filter(Boolean)]);
const DATA_DIR = path.join(ROOT, "backend", "data");
const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID));
const sessions = new Map();
const challenges = new Map();
const BLOCK_CHUNK = 2000;
const INDEX_VERSION = 3;

const ABI = {
  policy: new Interface([
    "event PolicyCreated(uint256 indexed policyId,address indexed holder,uint256 minIncome,uint256 minCreditScore,uint256 maxMedicalRisk,uint256 coverageAmount,uint256 premiumAmount,address beneficiary)",
    "event EligibilityVerified(uint256 indexed policyId,address indexed holder)",
    "event PolicyActivated(uint256 indexed policyId,address indexed holder)",
    "event PolicyRejected(uint256 indexed policyId,address indexed holder)",
    "event PremiumPaid(uint256 indexed policyId,address indexed holder,uint256 premium,uint256 reserveShares)",
    "event ClaimSubmitted(uint256 indexed policyId,address indexed holder,address indexed beneficiary,uint256 amount,bytes32 evidenceHash)",
    "event ClaimPaid(uint256 indexed policyId,address indexed holder,address indexed beneficiary,uint256 amount)",
    "event ClaimRejected(uint256 indexed policyId,address indexed holder,address indexed beneficiary,uint256 amount)",
  ]),
  vault: new Interface([
    "event Deposit(address indexed caller,address indexed owner,uint256 assets,uint256 shares)",
    "event Withdraw(address indexed caller,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)",
  ]),
  amm: new Interface([
    "event LiquidityAdded(address indexed provider,uint256 amountA,uint256 amountB,uint256 shares)",
    "event LiquidityRemoved(address indexed provider,uint256 amountA,uint256 amountB,uint256 shares)",
    "event Swap(address indexed trader,address indexed tokenIn,uint256 amountIn,address indexed tokenOut,uint256 amountOut)",
  ]),
  farm: new Interface(["event Staked(address indexed user,uint256 amount)", "event Withdrawn(address indexed user,uint256 amount)", "event RewardPaid(address indexed user,uint256 reward)"]),
  staking: new Interface(["event Staked(address indexed user,uint256 amount)", "event Unstaked(address indexed user,uint256 amount)", "event RewardClaimed(address indexed user,uint256 amount)"]),
  factory: new Interface(["event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairCount)"]),
  pair: new Interface([
    "event Mint(address indexed sender,uint256 amount0,uint256 amount1,address indexed to)",
    "event Burn(address indexed sender,uint256 amount0,uint256 amount1,address indexed to)",
    "event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)",
  ]),
  token: new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]),
  approval: new Interface(["event Approval(address indexed owner,address indexed spender,uint256 value)"]),
};

const fail = (message, status) => Object.assign(new Error(message), { status });
const storeFile = () => path.join(DATA_DIR, "history-" + CHAIN_ID + ".json");

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function bodyJson(req) {
  let raw = "";
  for await (const part of req) {
    raw += part;
    if (Buffer.byteLength(raw) > 32768) throw fail("Request body is too large.", 413);
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw fail("Request body must be valid JSON.", 400); }
}

function sessionFor(req) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    throw fail("History session expired. Sign in again with your wallet.", 401);
  }
  return session;
}

async function readStore() {
  try { return JSON.parse(await fsp.readFile(storeFile(), "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { chainId: CHAIN_ID.toString(), indexVersion: INDEX_VERSION, lastBlock: null, lastHash: null, pairs: [], events: {} };
  }
}

async function writeStore(store) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const file = storeFile();
  const temp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(temp, JSON.stringify(store, null, 2) + "\n", "utf8");
  await fsp.rename(temp, file);
}

async function deployments() {
  const filename = path.join(ROOT, "public", "deployments", CHAIN_ID + ".json");
  try { return JSON.parse(await fsp.readFile(filename, "utf8")); }
  catch { throw fail("Contract deployment registry is missing. Deploy the contracts first.", 503); }
}

async function logsFor(address, from, to) {
  const logs = [];
  for (let start = from; start <= to; start += BLOCK_CHUNK) {
    logs.push(...await provider.getLogs({ address, fromBlock: start, toBlock: Math.min(start + BLOCK_CHUNK - 1, to) }));
  }
  return logs;
}

function parsed(iface, log) {
  try { return iface.parseLog(log); } catch { return null; }
}

function addRecord(store, log, address, category, title, summary, timestamp) {
  const index = log.index ?? log.logIndex;
  const wallet = address.toLowerCase();
  const key = log.transactionHash.toLowerCase() + ":" + index + ":" + wallet;
  if (store.events[key]) return;
  store.events[key] = {
    key, address: wallet, chainId: CHAIN_ID.toString(), txHash: log.transactionHash,
    logIndex: index, blockNumber: Number(log.blockNumber), timestamp, category, title, summary,
  };
}

async function syncHistory(address) {
  const wallet = address.toLowerCase();
  const registry = await deployments();
  const [network, head] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  if (network.chainId !== CHAIN_ID) throw fail("Backend RPC is connected to a different chain.", 503);
  let store = await readStore();

  if (store.indexVersion !== INDEX_VERSION) store = { chainId: CHAIN_ID.toString(), indexVersion: INDEX_VERSION, lastBlock: null, lastHash: null, pairs: [], events: {} };
  if (store.lastBlock !== null) {
    const lastBlock = store.lastBlock <= head ? await provider.getBlock(store.lastBlock) : null;
    if (!lastBlock || lastBlock.hash !== store.lastHash) store = { chainId: CHAIN_ID.toString(), indexVersion: INDEX_VERSION, lastBlock: null, lastHash: null, pairs: [], events: {} };
  }
  const deployBlock = Number(registry.deploymentBlock || 0);
  const from = store.lastBlock === null ? deployBlock : store.lastBlock + 1;
  const candidates = [];
  const transfers = [];
  const pairs = new Set((store.pairs || []).map((x) => x.toLowerCase()));

  if (from <= head) {
    const fixed = [
      ["policy", registry.policy, ABI.policy],
      ["vault", registry.vaultShares, ABI.vault],
      ["amm", registry.simpleAMM, ABI.amm],
      ["farm", registry.yieldFarm, ABI.farm],
      ["staking", registry.staking, ABI.staking],
    ].filter(([, address]) => address);

    for (const [kind, address, iface] of fixed) {
      for (const log of await logsFor(address, from, head)) {
        const event = parsed(iface, log);
        if (!event) continue;
        const a = event.args;
        if (kind === "policy") {
          const id = a.policyId.toString();
          // Build only the matching message. Object literals evaluate every
          // value eagerly, so formatting `premium` or `amount` for unrelated
          // events produced an undefined BigNumberish value during indexing.
          let details;
          if (event.name === "PolicyCreated") details = ["Policy #" + id + " application created", "Demo coverage and premium terms plus public eligibility thresholds were recorded on-chain."];
          else if (event.name === "EligibilityVerified") details = ["Policy #" + id + " eligibility verified", "The Groth16 verifier accepted the proof. Pay the demo premium to activate coverage."];
          else if (event.name === "PolicyActivated") details = ["Policy #" + id + " activated", "The demo premium was deposited into the shared insurance reserve."];
          else if (event.name === "PremiumPaid") details = ["Policy #" + id + " premium paid", formatUnits(a.premium, 18) + " demo USDC contributed to the insurance reserve."];
          else if (event.name === "ClaimSubmitted") details = ["Policy #" + id + " claim submitted", formatUnits(a.amount, 18) + " demo USDC requested; only a reference hash is stored on-chain."];
          else if (event.name === "ClaimPaid") details = ["Policy #" + id + " benefit paid", formatUnits(a.amount, 18) + " demo USDC paid to the recorded beneficiary from the insurance reserve."];
          else if (event.name === "ClaimRejected") details = ["Policy #" + id + " claim declined", "The claims administrator declined the demo claim; the policy remains active if it has not expired."];
          else if (event.name === "PolicyRejected") details = ["Policy #" + id + " proof rejected", "The verifier rejected the submitted proof."];
          if (details) candidates.push({ log, address: a.holder, category: "insurance", title: details[0], summary: details[1] });
        } else if (kind === "vault") {
          const title = event.name === "Deposit" ? "Vault deposit" : "Vault withdrawal";
          const summary = event.name === "Deposit"
            ? formatUnits(a.assets, 18) + " demo USDC deposited; " + formatUnits(a.shares, 18) + " vINS shares issued."
            : formatUnits(a.assets, 18) + " demo USDC withdrawn by burning " + formatUnits(a.shares, 18) + " vINS shares.";
          candidates.push({ log, address: a.owner, category: "vault", title, summary });
        } else if (kind === "amm") {
          const isAdd = event.name === "LiquidityAdded";
          const isRemove = event.name === "LiquidityRemoved";
          const title = isAdd ? "AMM liquidity added" : isRemove ? "AMM liquidity removed" : "AMM swap";
          const summary = isAdd
            ? formatUnits(a.amountA, 18) + " demo USDC and " + formatUnits(a.amountB, 18) + " vINS added to the pool."
            : isRemove ? "Received " + formatUnits(a.amountA, 18) + " demo USDC and " + formatUnits(a.amountB, 18) + " vINS after burning " + formatUnits(a.shares, 18) + " LP shares."
              : formatUnits(a.amountIn, 18) + " " + (a.tokenIn.toLowerCase() === String(registry.mockUSDC).toLowerCase() ? "demo USDC" : "vINS") + " swapped for " + formatUnits(a.amountOut, 18) + " " + (a.tokenOut.toLowerCase() === String(registry.mockUSDC).toLowerCase() ? "demo USDC" : "vINS") + ".";
          candidates.push({ log, address: isAdd || isRemove ? a.provider : a.trader, category: "liquidity", title, summary });
        } else {
          const isFarm = kind === "farm";
          const category = isFarm ? "farming" : "staking";
          const title = event.name === "Staked" ? (isFarm ? "LP shares staked" : "Vault shares staked")
            : event.name === "RewardPaid" || event.name === "RewardClaimed" ? "Reward claimed" : "Stake withdrawn";
          const amount = formatUnits(a.amount ?? a.reward, 18);
          const verb = event.name === "Staked" ? "entered the reward position" : event.name === "RewardPaid" || event.name === "RewardClaimed" ? "claimed as rewards" : "returned from the position";
          candidates.push({ log, address: a.user, category, title, summary: amount + " demo tokens " + verb + "." });
        }
      }
    }

    if (registry.dexFactory) {
      for (const log of await logsFor(registry.dexFactory, from, head)) {
        const event = parsed(ABI.factory, log);
        if (!event) continue;
        pairs.add(event.args.pair.toLowerCase());
        const tx = await provider.getTransaction(log.transactionHash);
        if (tx) candidates.push({
          address: tx.from,
          log, category: "exchange", title: "DEX pair created",
          summary: "Created a pair for " + event.args.token0.slice(0, 6) + "… and " + event.args.token1.slice(0, 6) + "….",
        });
      }
    }

    for (const tokenAddress of [registry.mockUSDC, registry.rewardToken, registry.vaultShares, registry.simpleAMM].filter(Boolean)) {
      for (const log of await logsFor(tokenAddress, from, head)) {
        const event = parsed(ABI.token, log);
        if (!event) {
          const approval = parsed(ABI.approval, log);
          if (approval) {
            const spender = approval.args.spender.toLowerCase();
            const category = spender === String(registry.policy).toLowerCase() ? "insurance"
              : spender === String(registry.vaultShares).toLowerCase() ? "vault"
              : spender === String(registry.simpleAMM).toLowerCase() ? "liquidity"
                : spender === String(registry.yieldFarm).toLowerCase() ? "farming"
                  : spender === String(registry.staking).toLowerCase() ? "staking"
                    : spender === String(registry.dexRouter).toLowerCase() ? "exchange" : "tokens";
            const tokenName = tokenAddress.toLowerCase() === String(registry.mockUSDC).toLowerCase() ? "demo USDC"
              : tokenAddress.toLowerCase() === String(registry.vaultShares).toLowerCase() ? "vINS shares"
                : tokenAddress.toLowerCase() === String(registry.rewardToken).toLowerCase() ? "RWD tokens" : "AMM LP shares";
            candidates.push({ log, address: approval.args.owner, category, title: "Spending approval updated", summary: "Approved " + spender.slice(0, 6) + "…" + spender.slice(-4) + " to spend up to " + formatUnits(approval.args.value, 18) + " " + tokenName + "." });
          }
          continue;
        }
        const sender = event.args.from.toLowerCase();
        const receiver = event.args.to.toLowerCase();
        if (sender !== receiver && sender !== "0x0000000000000000000000000000000000000000") transfers.push({ log, address: sender, category: "tokens", title: "Demo tokens sent", summary: formatUnits(event.args.value, 18) + " tokens sent from this wallet." });
        if (receiver !== "0x0000000000000000000000000000000000000000" && receiver !== sender) {
          const minted = sender === "0x0000000000000000000000000000000000000000";
          const isDemoUsdc = tokenAddress.toLowerCase() === String(registry.mockUSDC).toLowerCase();
          transfers.push({ log, address: receiver, category: minted && isDemoUsdc ? "vault" : "tokens", title: minted ? (isDemoUsdc ? "Demo USDC minted" : "Demo tokens minted") : "Demo tokens received", summary: formatUnits(event.args.value, 18) + " tokens " + (minted ? "minted to" : "received by") + " this wallet." });
        }
      }
    }

    for (const pair of pairs) {
      for (const log of await logsFor(pair, from, head)) {
        const event = parsed(ABI.pair, log);
        if (!event) {
          const approval = parsed(ABI.approval, log);
          if (approval) candidates.push({ log, address: approval.args.owner, category: "exchange", title: "DEX LP allowance updated", summary: "Approved the DEX router to spend up to " + formatUnits(approval.args.value, 18) + " LP shares." });
          continue;
        }
        const title = event.name === "Mint" ? "DEX liquidity added" : event.name === "Burn" ? "DEX liquidity removed" : "DEX swap";
        const summary = event.name === "Mint" ? formatUnits(event.args.amount0, 18) + " token0 and " + formatUnits(event.args.amount1, 18) + " token1 added; pair LP shares were issued."
          : event.name === "Burn" ? "Received " + formatUnits(event.args.amount0, 18) + " token0 and " + formatUnits(event.args.amount1, 18) + " token1 after burning pair LP shares."
            : "Pair swap: " + formatUnits(event.args.amount0In, 18) + " token0 and " + formatUnits(event.args.amount1In, 18) + " token1 in; " + formatUnits(event.args.amount0Out, 18) + " token0 and " + formatUnits(event.args.amount1Out, 18) + " token1 out.";
        candidates.push({ log, address: event.args.to, category: "exchange", title, summary });
      }
    }

    const protocolTxs = new Set(candidates.map((x) => x.log.transactionHash.toLowerCase() + ":" + x.address.toLowerCase()));
    for (const transfer of transfers) {
      const key = transfer.log.transactionHash.toLowerCase() + ":" + transfer.address.toLowerCase();
      if (transfer.title === "Demo tokens minted" || !protocolTxs.has(key)) candidates.push(transfer);
    }
    const blockTimes = new Map();
    for (const item of candidates) {
      const blockNumber = Number(item.log.blockNumber);
      if (!blockTimes.has(blockNumber)) {
        const block = await provider.getBlock(blockNumber);
        blockTimes.set(blockNumber, block ? block.timestamp * 1000 : Date.now());
      }
      addRecord(store, item.log, item.address, item.category, item.title, item.summary, blockTimes.get(blockNumber));
    }
  }

  if (head >= deployBlock) {
    const block = await provider.getBlock(head);
    store.indexVersion = INDEX_VERSION;
    store.lastBlock = head;
    store.lastHash = block?.hash || null;
    store.pairs = [...pairs];
    await writeStore(store);
  }
  return Object.values(store.events).filter((event) => event.address === wallet).sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
}

async function handle(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
      sendJson(res, 200, { ok: true, chainId: network.chainId.toString(), expectedChainId: CHAIN_ID.toString(), blockNumber });
    } catch (error) { sendJson(res, 503, { ok: false, message: "Blockchain RPC unavailable: " + error.message }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/challenge") {
    const data = await bodyJson(req);
    if (!isAddress(data.address)) return sendJson(res, 400, { message: "Enter a valid wallet address." });
    if (String(data.chainId) !== CHAIN_ID.toString()) return sendJson(res, 409, { message: "Connect to chain " + CHAIN_ID + " to enable dashboard history." });
    const address = getAddress(data.address).toLowerCase();
    const issued = Date.now();
    const nonce = randomBytes(24).toString("hex");
    const message = [
      "InsureChain dashboard history access",
      "Wallet: " + address,
      "Chain ID: " + CHAIN_ID,
      "Nonce: " + nonce,
      "Issued at: " + new Date(issued).toISOString(),
      "Expires at: " + new Date(issued + 300000).toISOString(),
      "This signature only authorizes reading this wallet’s activity history. It does not approve a transaction.",
    ].join("\n");
    challenges.set(address, { message, expiresAt: issued + 300000 });
    sendJson(res, 200, { message });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/verify") {
    const data = await bodyJson(req);
    if (!isAddress(data.address) || typeof data.message !== "string" || typeof data.signature !== "string") return sendJson(res, 400, { message: "Wallet, signed challenge, and signature are required." });
    const address = getAddress(data.address).toLowerCase();
    const challenge = challenges.get(address);
    challenges.delete(address);
    if (!challenge || challenge.expiresAt < Date.now() || challenge.message !== data.message) return sendJson(res, 401, { message: "History signature challenge expired. Request a new one." });
    let signer;
    try { signer = verifyMessage(data.message, data.signature).toLowerCase(); }
    catch { return sendJson(res, 401, { message: "Wallet signature could not be verified." }); }
    if (signer !== address) return sendJson(res, 401, { message: "Signature does not match this wallet." });
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    sessions.set(token, { address, expiresAt });
    sendJson(res, 200, { token, address, expiresAt: new Date(expiresAt).toISOString() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/history/sync") {
    const session = sessionFor(req);
    const events = await syncHistory(session.address);
    sendJson(res, 200, { address: session.address, chainId: CHAIN_ID.toString(), events });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const session = sessionFor(req);
    const store = await readStore();
    const events = Object.values(store.events || {}).filter((event) => event.address === session.address).sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
    sendJson(res, 200, { address: session.address, chainId: CHAIN_ID.toString(), events });
    return;
  }

  sendJson(res, 404, { message: "Not found" });
}

http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("History request failed:", error);
    if (!res.headersSent) sendJson(res, Number(error.status) || 500, { message: error.message || "Backend request failed." });
    else res.destroy();
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log("InsureChain history backend listening on 127.0.0.1:" + PORT + " (chain " + CHAIN_ID + ")");
});
