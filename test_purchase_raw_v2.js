require('dotenv').config();
const { ethers } = require('ethers');

// --- CONFIGURATION ---
const RPC_URL = 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AGGREGATOR_ADDRESS = '0xe47809790a0ce703c2ac81598c90d5cc1569675d';
const AMOUNT_TO_SPEND_IP = '0.3';

// --- TRANSACTION DATA ---
// Raw input data from the successful manual transaction for 0.1 IP
const rawInput = '0x8b22555800000201090000200000bc8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000930dcd3914c9f6c2774014bbbe2702274c01aca0bd0c5389779f5a05001001100002b000014d5178f9f07b08d01d075cc5b7e1a1ae23a37b3811522cb2fed1367201d51d4e51514000000000000000000000000000000000000000bb8d1b2d3df51c3e5a22b09993354b8717e3a7e4d3be15b147923a4a1c4b9bc0aff6e476713e36c0ec3000000000083293e000068c6be390003005a';

// The full 32-byte hex slot for the original amount (0.1 IP)
const originalAmountSlot = '000000000000000000000000000000000000000000000000016345785d8a0000';

async function testCorrectedRawPurchase() {
    console.log('🚀 Starting CORRECTED RAW test purchase...');

    if (!PRIVATE_KEY) {
        console.error('❌ PRIVATE_KEY not found in environment variables. Please set it in your .env file.');
        return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`✅ Wallet loaded: ${wallet.address}`);

    // --- Prepare new transaction data ---
    const amountToSend = ethers.parseUnits(AMOUNT_TO_SPEND_IP, 18);

    // Convert the new amount to a 32-byte hex string, padded with leading zeros
    const newAmountHex = amountToSend.toString(16);
    const newAmountSlot = newAmountHex.padStart(64, '0');

    // Replace the entire original amount slot with the new one
    const newRawInput = rawInput.replace(originalAmountSlot, newAmountSlot);

    console.log(`
🔍 Preparing corrected raw transaction...`);
    console.log(`   - Target Contract: ${AGGREGATOR_ADDRESS}`);
    console.log(`   - Amount to spend: ${ethers.formatEther(amountToSend)} IP`);
    console.log(`   - New Input Data: ${newRawInput}`);

    // Verify the new input data has the correct length
    if (newRawInput.length !== rawInput.length) {
        console.error('❌ Fatal error: New raw input length does not match original length.');
        return;
    }

    try {
        const tx = {
            to: AGGREGATOR_ADDRESS,
            value: amountToSend,
            data: newRawInput,
            gasLimit: 300000 // Using a sufficient gas limit
        };

        console.log('\nSending transaction...');
        const response = await wallet.sendTransaction(tx);

        console.log(`
✅ Transaction sent! Hash: ${response.hash}`);
        console.log('Waiting for transaction to be mined...');

        const receipt = await response.wait();
        console.log(`
🎉 Purchase successful!`);
        console.log(`   - Block Number: ${receipt.blockNumber}`);
        console.log(`   - Gas Used: ${receipt.gasUsed.toString()}`);
        console.log(`   - View on StoryScan: https://www.storyscan.io/tx/${response.hash}`);

    } catch (error) {
        console.error('\n❌ Error during corrected raw test purchase:');
        // Ethers.js often wraps the core error, so we try to find the most specific message
        const errorDetails = error.reason || (error.info ? JSON.stringify(error.info) : '') || error.message;
        console.error(`   - Details: ${errorDetails}`);
        console.error('   - Check the full error object below for more context.');
        console.error(error);
    }
}

testCorrectedRawPurchase();
