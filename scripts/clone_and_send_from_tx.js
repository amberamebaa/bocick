require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL = process.env.STORY_RPC_URL || 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ROUTER = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909';
const WIP = '0x1514000000000000000000000000000000000000';

const IFACE = new ethers.Interface([
  'function exactInput(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)'
]);

async function main() {
  const txHash = process.argv[2];
  const amountStr = process.argv[3] || '0.2';
  if (!txHash) {
    console.error('Usage: node scripts/clone_and_send_from_tx.js <TX_HASH> [AMOUNT_WIP]');
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    console.error('PRIVATE_KEY missing');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const from = await wallet.getAddress();

  const srcTx = await provider.getTransaction(txHash);
  if (!srcTx) throw new Error('Source transaction not found');
  const to = srcTx.to;
  const data = srcTx.input || srcTx.data;
  const valueHex = srcTx.value || '0x0';

  const decoded = IFACE.decodeFunctionData('exactInput', data);
  const path = decoded[0];
  const oldRecipient = decoded[1];
  const oldDeadline = decoded[2];
  const oldAmountIn = decoded[3];
  const oldMinOut = decoded[4];

  console.log('Decoded from tx:', {
    to,
    value: valueHex,
    oldRecipient,
    oldDeadline: oldDeadline.toString(),
    oldAmountIn: oldAmountIn.toString(),
    oldMinOut: oldMinOut.toString(),
    pathLen: path.length
  });

  // Ensure allowance for router
  const wip = new ethers.Contract(WIP, [
    'function allowance(address owner,address spender) view returns(uint256)',
    'function approve(address spender,uint256 amount) returns(bool)'
  ], wallet);

  const amountIn = ethers.parseUnits(amountStr, 18);
  const deadline = BigInt(Math.floor(Date.now()/1000) + 600);
  const minOut = 1n; // tiny positive to avoid potential 0-checks

  const allowance = await wip.allowance(from, ROUTER);
  if (allowance < amountIn) {
    const feeData = await provider.getFeeData();
    console.log('Approving router...');
    const txa = await wip.approve(ROUTER, ethers.MaxUint256, { gasLimit: 120000n, ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {}) });
    console.log('Approve tx:', txa.hash);
    await txa.wait();
  }

  const newData = IFACE.encodeFunctionData('exactInput', [path, from, deadline, amountIn, minOut]);

  const srcValue = BigInt(valueHex);
  const sendValue = srcValue > 0n ? amountIn : 0n;

  const feeData = await provider.getFeeData();
  let gasLimit = 300000n;
  try {
    const est = await provider.estimateGas({ to: ROUTER, from, data: newData, value: sendValue });
    gasLimit = est * 2n;
  } catch (e) {
    console.log('estimateGas failed, using fallback');
  }

  const sent = await wallet.sendTransaction({ to: ROUTER, data: newData, value: sendValue, gasLimit, ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {}) });
  console.log('Swap tx:', sent.hash);
  const rcpt = await sent.wait();
  console.log('Mined block:', rcpt.blockNumber);
}

main().catch(err => { console.error(err); process.exit(1); });

