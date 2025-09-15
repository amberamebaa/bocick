require('dotenv').config();
const { ethers } = require('ethers');

// --- CONFIGURATION ---
const RPC_URL = 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// --- CONTRACTS & ADDRESSES ---
const AGGREGATOR_ADDRESS = '0xe47809790a0ce703c2ac81598c90d5cc1569675d';
const SWAP_ROUTER_ADDRESS = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909';
const TOKEN_TO_BUY = '0xd1b2D3Df51c3E5a22b09993354B8717e3a7E4D3b';

// --- TRANSACTION SETTINGS ---
const AMOUNT_TO_SPEND_IP = '0.3';
const gasLimitApprove = 100000;
const gasLimitSwap = 300000;

// --- ABIs ---
const SWAP_ROUTER_ABI = [
    "function WIP9() external view returns (address)"
];
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) public returns (bool)",
    "function allowance(address owner, address spender) public view returns (uint256)"
];

// --- RAW INPUT FOR SWAP ---
// Note: This data is for a 0.1 IP swap. We will replace the amount dynamically.
const rawInputForSwap = '0x8b22555800000201090000200000bc8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000930dcd3914c9f6c2774014bbbe2702274c01aca0bd0c5389779f5a05001001100002b000014d5178f9f07b08d01d075cc5b7e1a1ae23a37b3811522cb2fed1367201d51d4e51514000000000000000000000000000000000000000bb8d1b2d3df51c3e5a22b09993354b8717e3a7e4d3be15b147923a4a1c4b9bc0aff6e476713e36c0ec3000000000083293e000068c6be390003005a';
const originalAmountSlot = '000000000000000000000000000000000000000000000000016345785d8a0000';

async function testFullPurchaseFlow() {
    console.log('🚀 Starting FINAL V2 test purchase flow...');

    if (!PRIVATE_KEY) {
        console.error('❌ PRIVATE_KEY not found in .env file.');
        return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`✅ Wallet loaded: ${wallet.address}`);

    try {
        // === STEP 0: Get correct WIP9 address from the router ===
        console.log('\n--- STEP 0: Fetching correct WIP9 address ---');
        const routerContract = new ethers.Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, provider);
        const correctWIP9Address = await routerContract.WIP9();
        console.log(`✅ Found correct WIP9 address: ${correctWIP9Address}`);

        // === STEP 1: Approve the Aggregator to spend WIP9 ===
        console.log('\n--- STEP 1: Approving Spender ---');
        const wip9Contract = new ethers.Contract(correctWIP9Address, ERC20_ABI, wallet);
        const amountToSend = ethers.parseUnits(AMOUNT_TO_SPEND_IP, 18);

        const currentAllowance = await wip9Contract.allowance(wallet.address, AGGREGATOR_ADDRESS);
        console.log(`Current allowance for Aggregator: ${ethers.formatEther(currentAllowance)} WIP9`);

        if (currentAllowance < amountToSend) {
            console.log('Allowance is too low. Sending approve transaction...');
            const approveTx = await wip9Contract.approve(AGGREGATOR_ADDRESS, ethers.MaxUint256, { gasLimit: gasLimitApprove });
            console.log(`Approve transaction sent: ${approveTx.hash}`);
            await approveTx.wait();
            console.log('✅ Approve transaction confirmed!');
        } else {
            console.log('✅ Sufficient allowance already set.');
        }

        // === STEP 2: Execute the Swap ===
        console.log('\n--- STEP 2: Executing Swap ---');
        const newAmountHex = amountToSend.toString(16).padStart(64, '0');
        const finalRawInput = rawInputForSwap.replace(originalAmountSlot, newAmountHex);

        const txRequest = await wallet.populateTransaction({
            to: AGGREGATOR_ADDRESS,
            value: amountToSend,
            data: finalRawInput,
            gasLimit: gasLimitSwap
        });

        console.log('Sending final swap transaction...');
        const swapResponse = await wallet.sendTransaction(txRequest);
        console.log(`\n✅ Swap transaction sent! Hash: ${swapResponse.hash}`);
        console.log('Waiting for transaction to be mined...');

        const receipt = await swapResponse.wait();
        console.log(`\n🎉 Purchase successful!`);
        console.log(`   - Block: ${receipt.blockNumber}`);
        console.log(`   - View on StoryScan: https://www.storyscan.io/tx/${swapResponse.hash}`);

    } catch (error) {
        console.error('\n❌ Error during final purchase flow:');
        const errorDetails = error.reason || (error.info ? JSON.stringify(error.info) : '') || error.message;
        console.error(`   - Details: ${errorDetails}`);
        console.error(error);
    }
}

testFullPurchaseFlow();