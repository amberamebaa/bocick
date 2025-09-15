require('dotenv').config();
const { ethers } = require('ethers');

// Uniswap V3 Pool minimal ABI
const POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];

async function main() {
  const RPC_URL = process.env.STORY_RPC_URL || 'https://mainnet.storyrpc.io';
  const poolAddress = process.argv[2];
  if (!poolAddress || !ethers.isAddress(poolAddress)) {
    console.error('Usage: node scripts/query_pool.js <POOL_ADDRESS>');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

  const [token0, token1, fee, liquidity, slot0] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.fee(),
    pool.liquidity(),
    pool.slot0()
  ]);

  console.log('Pool:', poolAddress);
  console.log('token0:', token0);
  console.log('token1:', token1);
  console.log('fee:', Number(fee));
  console.log('liquidity:', liquidity.toString());
  console.log('slot0.tick:', slot0.tick);
}

main().catch((e) => { console.error(e); process.exit(1); });

