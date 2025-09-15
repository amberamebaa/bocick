require('dotenv').config();
const { ethers } = require('ethers');

// Config
const RPC_URL = process.env.STORY_RPC_URL || 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const SWAP_ROUTER_ADDRESS = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909';
const WIP_TOKEN_ADDRESS = '0x1514000000000000000000000000000000000000';

// ABIs
const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
];
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

async function main() {
  const tokenOut = process.argv[2];
  const amountStr = process.argv[3] || '0.2';
  const fee = parseInt(process.argv[4] || '3000', 10);
  if (!tokenOut) {
    console.error('Usage: node scripts/real_purchase_router.js <TOKEN_OUT> [AMOUNT_WIP] [FEE]');
    process.exit(1);
  }
  if (!ethers.isAddress(tokenOut)) {
    console.error('Invalid TOKEN_OUT address');
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    console.error('PRIVATE_KEY missing in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = await wallet.getAddress();

  console.log('RPC:', RPC_URL);
  console.log('From:', address);

  const router = new ethers.Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);
  const wip = new ethers.Contract(WIP_TOKEN_ADDRESS, ERC20_ABI, wallet);

  const amountIn = ethers.parseUnits(amountStr, 18);

  // Ensure allowance for router
  const allowance = await wip.allowance(address, SWAP_ROUTER_ADDRESS);
  console.log('Allowance (router):', ethers.formatUnits(allowance, 18));
  if (allowance < amountIn) {
    console.log('Sending approve to router...');
    const feeData = await provider.getFeeData();
    const approveTx = await wip.approve(SWAP_ROUTER_ADDRESS, ethers.MaxUint256, {
      gasLimit: 120000n,
      ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {})
    });
    console.log('Approve tx:', approveTx.hash);
    await approveTx.wait();
  } else {
    console.log('Sufficient allowance for router.');
  }

  // Build params
  const params = {
    tokenIn: WIP_TOKEN_ADDRESS,
    tokenOut: ethers.getAddress(tokenOut),
    fee,
    recipient: address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 10),
    amountIn,
    amountOutMinimum: 0n, // NOTE: no slippage protection in this quick test
    sqrtPriceLimitX96: 0n
  };

  // Estimate gas (2x buffer)
  let gasLimit;
  try {
    const est = await router.exactInputSingle.estimateGas(params, { value: 0 });
    gasLimit = est * 2n;
  } catch (e) {
    console.log('estimateGas(exactInputSingle) failed, using fallback');
    gasLimit = 350000n;
  }

  const feeData = await provider.getFeeData();
  console.log('Sending swap via router...');
  const tx = await router.exactInputSingle(params, {
    value: 0,
    gasLimit,
    ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {})
  });
  console.log('Swap tx:', tx.hash);
  const receipt = await tx.wait();
  console.log('Mined block:', receipt.blockNumber);
}

main().catch((e) => { console.error(e); process.exit(1); });

