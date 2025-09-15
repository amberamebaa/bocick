require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL = process.env.STORY_RPC_URL || 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const ROUTER = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909';
const WIP = '0x1514000000000000000000000000000000000000';

// Selector 0xc04b8d59 -> function exactInput(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)
const ABI = [
  'function exactInput(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)'
];

function buildPath(tokenIn, fee, tokenOut) {
  const inHex = ethers.getAddress(tokenIn).toLowerCase().replace('0x','');
  const outHex = ethers.getAddress(tokenOut).toLowerCase().replace('0x','');
  const feeHex = fee.toString(16).padStart(6,'0'); // 3 bytes
  return '0x' + inHex + feeHex + outHex;
}

async function main() {
  const tokenOut = process.argv[2];
  const amountStr = process.argv[3] || '0.2';
  const fee = parseInt(process.argv[4] || '3000', 10);
  if (!tokenOut || !ethers.isAddress(tokenOut)) {
    console.error('Usage: node scripts/real_purchase_c04b8d59.js <TOKEN_OUT> [AMOUNT_WIP] [FEE]');
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    console.error('PRIVATE_KEY missing');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const from = await wallet.getAddress();

  // Ensure allowance for router
  const erc20 = new ethers.Contract(WIP, [
    'function allowance(address owner,address spender) view returns(uint256)',
    'function approve(address spender,uint256 amount) returns(bool)'
  ], wallet);

  const amountIn = ethers.parseUnits(amountStr, 18);
  const allowance = await erc20.allowance(from, ROUTER);
  if (allowance < amountIn) {
    const feeData = await provider.getFeeData();
    console.log('Approving router...');
    const txa = await erc20.approve(ROUTER, ethers.MaxUint256, {
      gasLimit: 120000n,
      ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {})
    });
    console.log('Approve tx:', txa.hash);
    await txa.wait();
  }

  const router = new ethers.Contract(ROUTER, ABI, wallet);
  const path = buildPath(WIP, fee, tokenOut);
  const recipient = from;
  const deadline = BigInt(Math.floor(Date.now()/1000) + 600);
  const amountOutMinimum = 0n; // to avoid revert on minOut

  // Try estimate and add 2x buffer
  let gasLimit = 300000n;
  try {
    const est = await router.exactInput.estimateGas(path, recipient, deadline, amountIn, amountOutMinimum, { value: 0 });
    gasLimit = est * 2n;
  } catch (e) {
    console.log('estimateGas failed, using fallback');
  }

  const feeData = await provider.getFeeData();
  console.log('Sending tx to router with selector 0xc04b8d59...');
  const tx = await router.exactInput(path, recipient, deadline, amountIn, amountOutMinimum, {
    value: amountIn,
    gasLimit,
    ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {})
  });
  console.log('Swap tx:', tx.hash);
  const rcpt = await tx.wait();
  console.log('Mined block:', rcpt.blockNumber);
}

main().catch(err => { console.error(err); process.exit(1); });
