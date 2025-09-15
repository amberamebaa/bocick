require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL = process.env.STORY_RPC_URL || 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Router (same as SWAP_ROUTER_ADDRESS)
const ROUTER = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909';
const WIP = '0x1514000000000000000000000000000000000000';

// ABI fragment for exactInput(bytes,address,uint256,uint256,uint256)
const ROUTER_ABI = [
  'function exactInput(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) payable returns (uint256 amountOut)'
];

function buildV3Path(tokenIn, fee, tokenOut) {
  // tokenIn (20 bytes) + fee (3 bytes big-endian) + tokenOut (20 bytes)
  const tIn = ethers.getAddress(tokenIn).toLowerCase().replace('0x','');
  const tOut = ethers.getAddress(tokenOut).toLowerCase().replace('0x','');
  const feeHex = fee.toString(16).padStart(6, '0');
  return '0x' + tIn + feeHex + tOut;
}

async function main() {
  const tokenOut = process.argv[2];
  const amountStr = process.argv[3] || '0.2';
  const fee = parseInt(process.argv[4] || '3000', 10);
  if (!tokenOut || !ethers.isAddress(tokenOut)) {
    console.error('Usage: node scripts/real_purchase_exactInput.js <TOKEN_OUT> [AMOUNT_WIP] [FEE]');
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    console.error('PRIVATE_KEY missing in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = await wallet.getAddress();

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);

  const path = buildV3Path(WIP, fee, tokenOut);
  const recipient = address;
  const deadline = BigInt(Math.floor(Date.now()/1000) + 600);
  const amountIn = ethers.parseUnits(amountStr, 18);
  const amountOutMinimum = 0n; // no slippage protection in this test

  // send as ERC20 (value=0). Ensure allowance first.
  const ERC20_ABI = [ 'function allowance(address owner,address spender)view returns(uint256)', 'function approve(address spender,uint256 amount) returns(bool)' ];
  const wip = new ethers.Contract(WIP, ERC20_ABI, wallet);
  const allowance = await wip.allowance(address, ROUTER);
  if (allowance < amountIn) {
    const feeData = await provider.getFeeData();
    console.log('Approving router...');
    const txa = await wip.approve(ROUTER, ethers.MaxUint256, { gasLimit: 120000n, ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {}) });
    console.log('Approve tx:', txa.hash);
    await txa.wait();
  }

  // Estimate gas (with 2x buffer)
  let gasLimit = 350000n;
  try {
    const est = await router.exactInput.estimateGas(path, recipient, deadline, amountIn, amountOutMinimum, { value: 0 });
    gasLimit = est * 2n;
  } catch (e) {
    console.log('estimateGas(exactInput) failed, using fallback');
  }

  const feeData = await provider.getFeeData();
  console.log('Sending exactInput swap...');
  const tx = await router.exactInput(path, recipient, deadline, amountIn, amountOutMinimum, {
    value: 0,
    gasLimit,
    ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {})
  });
  console.log('Swap tx:', tx.hash);
  const rcpt = await tx.wait();
  console.log('Mined block:', rcpt.blockNumber);
}

main().catch(err => { console.error(err); process.exit(1); });

