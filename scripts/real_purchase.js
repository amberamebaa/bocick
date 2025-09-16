require('dotenv').config();
const { ethers } = require('ethers');

// Configuration - Story Protocol specific
const RPC_URL = process.env.STORY_RPC_URL || 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Story Protocol Contract Addresses
const POOL_FACTORY_CONTRACT_ADDRESS = '0xa111dDbE973094F949D78Ad755cd560F8737B7e2';
const QUOTER_CONTRACT_ADDRESS = '0x865E2Bff1d5f9a01b91196D31126C2e432bC0F6C';
const SWAP_ROUTER_ADDRESS = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909';
const WIP_TOKEN_ADDRESS = '0x1514000000000000000000000000000000000000';

// Gas Limits
const GAS_LIMIT_APPROVE = 120000n;
const GAS_LIMIT_SWAP = 350000n;

// ABIs
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function allowance(address owner, address spender) public view returns (uint256)',
  'function balanceOf(address account) public view returns (uint256)',
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)',
  'function name() public view returns (string)',
  'function totalSupply() public view returns (uint256)'
];

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
];

const QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)'
];

// Helper function to validate decimals
function validateDecimals(decimals) {
  const decimalNum = Number(decimals);
  if (decimalNum < 0 || decimalNum > 255 || !Number.isInteger(decimalNum)) {
    throw new Error(`Invalid decimals: ${decimals}. Must be integer between 0-255`);
  }
  return decimalNum;
}

// Helper function to get ERC20 token details with validation
async function getERC20TokenDetails(tokenAddress, provider) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [decimals, symbol, name, totalSupply] = await Promise.all([
      tokenContract.decimals(),
      tokenContract.symbol(),
      tokenContract.name(),
      tokenContract.totalSupply()
    ]);

    // Validate decimals before returning
    const validatedDecimals = validateDecimals(decimals);

    return {
      decimals: validatedDecimals,
      symbol: symbol || 'UNKNOWN',
      name: name || 'Unknown Token',
      totalSupply
    };
  } catch (error) {
    throw new Error(`Failed to get token details for ${tokenAddress}: ${error.message}`);
  }
}

// Validate inputs
function validateInputs(tokenAddress, amount) {
  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    throw new Error('Invalid token address provided');
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    throw new Error('Invalid amount provided');
  }

  if (!PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY missing in .env file');
  }
}

// Build Uniswap V3 path manually
function buildV3Path(tokenIn, fee, tokenOut) {
  const tokenInHex = ethers.getAddress(tokenIn).toLowerCase().replace('0x', '');
  const tokenOutHex = ethers.getAddress(tokenOut).toLowerCase().replace('0x', '');
  const feeHex = fee.toString(16).padStart(6, '0'); // 3 bytes
  return '0x' + tokenInHex + feeHex + tokenOutHex;
}

async function main() {
  console.log("=== Story Protocol Token Purchase Test (SDK-Free) ===");

  // Parse command line arguments
  const tokenToBuyAddress = process.argv[2];
  const amountWipStr = process.argv[3];

  if (!tokenToBuyAddress || !amountWipStr) {
    console.error('Usage: node real_purchase_test.js <TOKEN_ADDRESS> <AMOUNT_WIP>');
    console.error('Example: node real_purchase_test.js 0x1234...5678 0.5');
    process.exit(1);
  }

  try {
    // Validate inputs
    validateInputs(tokenToBuyAddress, amountWipStr);

    console.log(`Token to Buy: ${tokenToBuyAddress}`);
    console.log(`WIP Amount: ${amountWipStr}`);
    console.log(`RPC URL: ${RPC_URL}`);

    // Setup provider and wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`Wallet Address: ${wallet.address}`);

    // Get network info
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    console.log(`Chain ID: ${chainId}`);

    // Check wallet balance
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`ETH Balance: ${ethers.formatEther(ethBalance)}`);

    // Get WIP token details
    console.log("\n--- Getting WIP Token Details ---");
    const wipDetails = await getERC20TokenDetails(WIP_TOKEN_ADDRESS, provider);
    console.log(`WIP Token: ${wipDetails.symbol} (${wipDetails.decimals} decimals)`);

    // Get WIP balance
    const wipContract = new ethers.Contract(WIP_TOKEN_ADDRESS, ERC20_ABI, provider);
    const wipBalance = await wipContract.balanceOf(wallet.address);
    console.log(`WIP Balance: ${ethers.formatUnits(wipBalance, wipDetails.decimals)}`);

    // Check if we have enough WIP
    const amountInWei = ethers.parseUnits(amountWipStr, wipDetails.decimals);
    if (wipBalance < amountInWei) {
      throw new Error(`Insufficient WIP balance. Need: ${amountWipStr}, Have: ${ethers.formatUnits(wipBalance, wipDetails.decimals)}`);
    }

    // Get target token details
    console.log("\n--- Getting Target Token Details ---");
    const targetTokenDetails = await getERC20TokenDetails(tokenToBuyAddress, provider);
    console.log(`Target Token: ${targetTokenDetails.symbol} (${targetTokenDetails.name})`);
    console.log(`Decimals: ${targetTokenDetails.decimals}`);
    console.log(`Total Supply: ${ethers.formatUnits(targetTokenDetails.totalSupply, targetTokenDetails.decimals)}`);

    // Get quote using quoter
    console.log("\n--- Getting Quote ---");
    const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, provider);
    const fee = 3000; // 0.3% fee tier

    let quotedAmountOut;
    try {
      quotedAmountOut = await quoterContract.quoteExactInputSingle(
          WIP_TOKEN_ADDRESS,
          tokenToBuyAddress,
          fee,
          amountInWei,
          0 // no price limit
      );

      const quotedAmountFormatted = ethers.formatUnits(quotedAmountOut, targetTokenDetails.decimals);
      console.log(`Quote: ${amountWipStr} WIP → ${quotedAmountFormatted} ${targetTokenDetails.symbol}`);
    } catch (error) {
      throw new Error(`Failed to get quote - pool might not exist: ${error.message}`);
    }

    // Check current allowance
    console.log("\n--- Checking Allowances ---");
    const currentAllowance = await wipContract.allowance(wallet.address, SWAP_ROUTER_ADDRESS);
    console.log(`Current Allowance: ${ethers.formatUnits(currentAllowance, wipDetails.decimals)} WIP`);

    // Approve if necessary
    if (currentAllowance < amountInWei) {
      console.log("Insufficient allowance, approving...");
      const feeData = await provider.getFeeData();
      const approveTx = await wipContract.connect(wallet).approve(
          SWAP_ROUTER_ADDRESS,
          ethers.MaxUint256,
          {
            gasLimit: GAS_LIMIT_APPROVE,
            ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {})
          }
      );

      console.log(`Approve tx sent: ${approveTx.hash}`);
      const approveReceipt = await approveTx.wait();

      if (approveReceipt.status !== 1) {
        throw new Error('Approval transaction failed');
      }
      console.log("Approval confirmed");
    } else {
      console.log("Sufficient allowance already exists");
    }

    // Prepare swap parameters
    console.log("\n--- Preparing Swap ---");
    const routerContract = new ethers.Contract(SWAP_ROUTER_ADDRESS, ROUTER_ABI, wallet);

    const swapParams = {
      tokenIn: WIP_TOKEN_ADDRESS,
      tokenOut: tokenToBuyAddress,
      fee: fee,
      recipient: wallet.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 20), // 20 minutes
      amountIn: amountInWei,
      amountOutMinimum: 0n, // No slippage protection for testing
      sqrtPriceLimitX96: 0n
    };

    console.log("Swap parameters prepared");
    console.log(`Fee: ${fee} (${fee/10000}%)`);
    console.log(`Deadline: ${swapParams.deadline}`);

    // Estimate gas
    let gasLimit = GAS_LIMIT_SWAP;
    try {
      const gasEstimate = await routerContract.exactInputSingle.estimateGas(swapParams, { value: 0 });
      gasLimit = gasEstimate * 2n; // 100% buffer
      console.log(`Gas estimated: ${gasEstimate}, using: ${gasLimit}`);
    } catch (error) {
      console.log(`Gas estimation failed, using default: ${gasLimit}`);
      console.log(`Gas estimation error: ${error.message}`);
    }

    // Execute swap
    console.log("\n--- Executing Swap ---");
    const feeData = await provider.getFeeData();

    const swapTx = await routerContract.exactInputSingle(swapParams, {
      value: 0, // WIP is ERC20, not native token
      gasLimit: gasLimit,
      ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {})
    });

    console.log(`Swap transaction sent: ${swapTx.hash}`);
    console.log("Waiting for confirmation...");

    const receipt = await swapTx.wait();

    if (receipt.status !== 1) {
      throw new Error('Swap transaction failed');
    }

    console.log("\n=== SWAP SUCCESSFUL ===");
    console.log(`Block Number: ${receipt.blockNumber}`);
    console.log(`Gas Used: ${receipt.gasUsed}`);
    console.log(`Transaction Hash: ${swapTx.hash}`);
    console.log(`View on StoryScan: https://www.storyscan.io/tx/${swapTx.hash}`);

    // Check final balances
    console.log("\n--- Final Balances ---");
    const finalWipBalance = await wipContract.balanceOf(wallet.address);
    console.log(`Final WIP Balance: ${ethers.formatUnits(finalWipBalance, wipDetails.decimals)}`);

    const targetTokenContract = new ethers.Contract(tokenToBuyAddress, ERC20_ABI, provider);
    const finalTargetBalance = await targetTokenContract.balanceOf(wallet.address);
    console.log(`Final ${targetTokenDetails.symbol} Balance: ${ethers.formatUnits(finalTargetBalance, targetTokenDetails.decimals)}`);

    // Calculate actual received amount
    const receivedAmount = ethers.formatUnits(finalTargetBalance, targetTokenDetails.decimals);
    const expectedAmount = ethers.formatUnits(quotedAmountOut, targetTokenDetails.decimals);
    console.log(`Expected: ${expectedAmount}, Received: ${receivedAmount} ${targetTokenDetails.symbol}`);

  } catch (error) {
    console.error("\n❌ ERROR:", error.message);

    // Provide helpful error context
    if (error.message.includes('insufficient funds')) {
      console.error("💡 Make sure you have enough ETH for gas fees");
    } else if (error.message.includes('pool might not exist')) {
      console.error("💡 The trading pair might not exist or have sufficient liquidity");
    } else if (error.message.includes('slippage') || error.message.includes('SLIPPAGE')) {
      console.error("💡 Try reducing trade size or the pool has insufficient liquidity");
    } else if (error.message.includes('DECIMALS')) {
      console.error("💡 Token has invalid decimal configuration");
    } else if (error.message.includes('allowance')) {
      console.error("💡 Token approval failed - check token contract");
    }

    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\nProcess interrupted');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});