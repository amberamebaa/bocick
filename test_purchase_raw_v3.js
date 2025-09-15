require('dotenv').config();
const { ethers } = require('ethers');

// --- CONFIGURATION ---
const RPC_URL = 'https://mainnet.storyrpc.io';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AGGREGATOR_ADDRESS = '0xe47809790a0ce703c2ac81598c90d5cc1569675d';

// --- EXACT DATA FROM THE SUCCESSFUL MANUAL TRANSACTION ---
const originalAmount = ethers.parseUnits('0.1', 18);
const originalRawInput = '0x8b22555800000201090000200000bc8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000930dcd3914c9f6c2774014bbbe2702274c01aca0bd0c5389779f5a05001001100002b000014d5178f9f07b08d01d075cc5b7e1a1ae23a37b3811522cb2fed1367201d51d4e51514000000000000000000000000000000000000000bb8d1b2d3df51c3e5a22b09993354b8717e3a7e4d3be15b147923a4a1c4b9bc0aff6e476713e36c0ec3000000000083293e000068c6be390003005a';

async function testExactReplication() {
    console.log('🚀 Starting EXACT REPLICATION test purchase...');

    if (!PRIVATE_KEY) {
        console.error('❌ PRIVATE_KEY not found in environment variables. Please set it in your .env file.');
        return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`✅ Wallet loaded: ${wallet.address}`);

    try {
        const tx = {
            to: AGGREGATOR_ADDRESS,
            value: originalAmount,
            data: originalRawInput,
            gasLimit: 300000
        };

        console.log('\nSending exact replication transaction...');
        console.log('   - Amount: 0.1 IP');

        const response = await wallet.sendTransaction(tx);

        console.log(`\n✅ Transaction sent! Hash: ${response.hash}`);
        console.log('Waiting for transaction to be mined...');

        const receipt = await response.wait();
        console.log(`\n🎉 Purchase successful!`);
        console.log(`   - Block Number: ${receipt.blockNumber}`);
        console.log(`   - View on StoryScan: https://www.storyscan.io/tx/${response.hash}`);

    } catch (error) {
        console.error('\n❌ Error during exact replication test purchase:');
        console.error(error);
    }
}

testExactReplication();
