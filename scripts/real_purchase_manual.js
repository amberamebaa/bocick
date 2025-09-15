require('dotenv').config();
const axios = require('axios');
const https = require('https');
const { URL } = require('url');
const { ethers } = require('ethers');

const RPCS = [
  'https://mainnet.storyrpc.io',
  process.env.STORY_RPC_URL,
  'https://rpc.story.foundation',
  'https://story-rpc.ankr.com'
].filter(Boolean);
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const AGGREGATOR_ADDRESS = '0xe47809790a0ce703c2ac81598c90d5cc1569675d';
const WIP_TOKEN_ADDRESS = '0x1514000000000000000000000000000000000000';

const GAS_LIMIT_APPROVE = 100000n;
const GAS_LIMIT_SWAP = 300000n;

const RAW_INPUT = '0x8b22555800000201090000200000bc8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000930dcd3914c9f6c2774014bbbe2702274c01aca0bd0c5389779f5a05001001100002b000014d5178f9f07b08d01d075cc5b7e1a1ae23a37b3811522cb2fed1367201d51d4e51514000000000000000000000000000000000000000bb8d1b2d3df51c3e5a22b09993354b8717e3a7e4d3be15b147923a4a1c4b9bc0aff6e476713e36c0ec3000000000083293e000068c6be390003005a';
const ORIGINAL_AMOUNT_SLOT = '000000000000000000000000000000000000000000000000016345785d8a0000';

function replaceAmount(raw, amountWip) {
  const wei = ethers.parseUnits(amountWip.toString(), 18);
  const hex = wei.toString(16).padStart(64, '0');
  return raw.replace(ORIGINAL_AMOUNT_SLOT, hex);
}

function replaceLastTokenAfterBB8(raw, newTokenAddress) {
  const no0x = raw.startsWith('0x') ? raw.slice(2) : raw;
  const marker = 'bb8';
  const idx = no0x.lastIndexOf(marker);
  if (idx === -1) throw new Error("Marker 'bb8' not found in raw input");
  const start = idx + marker.length;
  const end = start + 40;
  const lowerAddr = newTokenAddress.toLowerCase().replace(/^0x/, '');
  if (!/^([0-9a-f0-9]{40})$/.test(lowerAddr)) throw new Error('Invalid token address format');
  const replaced = no0x.slice(0, start) + lowerAddr + no0x.slice(end);
  return '0x' + replaced;
}

let rpcInstance = null;
let currentRpc = null;
function makeRpc(baseURL){
  try {
    const u = new URL(baseURL);
    const agent = new https.Agent({
      // Dla poprawnego SNI ustawiamy nazwę hosta zgodną z URL
      servername: u.hostname,
      // Opcjonalnie można włączyć weryfikację certyfikatu. Zostawiamy domyślną (true)
    });
    return axios.create({ baseURL, httpsAgent: agent, headers: { 'content-type': 'application/json' }, timeout: 15000 });
  } catch (_) {
    // Fallback bez agenta (gdyby URL był niestandardowy)
    return axios.create({ baseURL, headers: { 'content-type': 'application/json' }, timeout: 15000 });
  }
}

let rpcId = 1;
async function call(method, params = []) {
  if (!rpcInstance) throw new Error('RPC not initialized');
  const { data } = await rpcInstance.post('', { jsonrpc: '2.0', id: rpcId++, method, params });
  if (data.error) throw new Error(`${method} error: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function waitReceipt(hash) {
  for (let i = 0; i < 120; i++) {
    const r = await call('eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error('Timeout waiting for receipt');
}

function toHex(n) { return '0x' + n.toString(16); }

async function main() {
  const tokenToBuy = process.argv[2];
  const amountStr = process.argv[3] || '0.2';
  if (!tokenToBuy) {
    console.error('Usage: node scripts/real_purchase_manual.js <TOKEN_ADDRESS> [AMOUNT_WIP]');
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    console.error('PRIVATE_KEY missing in .env');
    process.exit(1);
  }

  // pick first working RPC
  for (const url of RPCS) {
    try {
      rpcInstance = makeRpc(url);
      currentRpc = url;
      await call('eth_chainId');
      break;
    } catch (e) {
      rpcInstance = null; currentRpc = null;
    }
  }
  if (!rpcInstance) {
    throw new Error('No working RPC from list: ' + RPCS.join(', '));
  }

  // Basic chain data
  const chainIdHex = await call('eth_chainId');
  const chainId = Number(chainIdHex);
  const gasPrice = BigInt(await call('eth_gasPrice'));

  const wallet = new ethers.Wallet(PRIVATE_KEY);
  const from = await wallet.getAddress();
  let nonce = Number(await call('eth_getTransactionCount', [from, 'latest']));

  console.log('Using RPC:', currentRpc);
  console.log('From:', from);
  console.log('ChainId:', chainId);
  console.log('GasPrice:', gasPrice.toString());

  // 1) Approve Max for WIP token to Aggregator
  const erc20Iface = new ethers.Interface([
    'function approve(address spender, uint256 amount) returns (bool)'
  ]);
  const approveData = erc20Iface.encodeFunctionData('approve', [AGGREGATOR_ADDRESS, ethers.MaxUint256]);

  // Estimate gas for approve and apply 2x buffer
  const approveCall = {
    from,
    to: WIP_TOKEN_ADDRESS,
    value: '0x0',
    data: approveData
  };
  let approveGas;
  try {
    const est = await call('eth_estimateGas', [approveCall]);
    approveGas = BigInt(est) * 2n;
  } catch (e) {
    console.log('estimateGas(approve) failed, using fallback');
    approveGas = GAS_LIMIT_APPROVE * 2n;
  }

  const approveTx = {
    from,
    to: WIP_TOKEN_ADDRESS,
    nonce,
    gasPrice: toHex(gasPrice),
    gasLimit: toHex(approveGas),
    value: '0x0',
    data: approveData,
    chainId,
  };

  const signedApprove = await wallet.signTransaction(approveTx);
  const approveHash = await call('eth_sendRawTransaction', [signedApprove]);
  console.log('Approve sent:', approveHash);
  const approveReceipt = await waitReceipt(approveHash);
  console.log('Approve mined in block:', parseInt(approveReceipt.blockNumber, 16));

  // 2) Swap via Aggregator with raw input and value=amount
  const amountWei = ethers.parseUnits(amountStr, 18);
  let data = replaceAmount(RAW_INPUT, amountStr);
  data = replaceLastTokenAfterBB8(data, tokenToBuy);

  // Estimate gas for swap and apply 2x buffer
  const swapCall = {
    from,
    to: AGGREGATOR_ADDRESS,
    value: toHex(amountWei),
    data
  };
  let swapGas;
  try {
    const est = await call('eth_estimateGas', [swapCall]);
    swapGas = BigInt(est) * 2n;
  } catch (e) {
    console.log('estimateGas(swap) failed, using fallback');
    swapGas = GAS_LIMIT_SWAP * 2n;
  }

  const swapTx = {
    from,
    to: AGGREGATOR_ADDRESS,
    nonce: nonce + 1,
    gasPrice: toHex(gasPrice),
    gasLimit: toHex(swapGas),
    value: toHex(amountWei),
    data,
    chainId,
  };

  console.log('SwapTx preview:', {
    to: swapTx.to,
    nonce: swapTx.nonce,
    gasPrice: swapTx.gasPrice,
    gasLimit: swapTx.gasLimit,
    value: swapTx.value,
    dataLen: data.length
  });
  const signedSwap = await wallet.signTransaction(swapTx);
  const swapHash = await call('eth_sendRawTransaction', [signedSwap]);
  console.log('Swap sent:', swapHash);
  const swapReceipt = await waitReceipt(swapHash);
  console.log('Swap mined in block:', parseInt(swapReceipt.blockNumber, 16));
}

main().catch(e => { console.error(e); process.exit(1); });
