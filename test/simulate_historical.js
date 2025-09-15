const { StoryProtocolMonitor } = require('../src/services/storyMonitor');
const TelegramBot = require('node-telegram-bot-api'); // Mock TelegramBot
require('dotenv').config(); // Load .env file

const START_BLOCK = 7468836;
const BLOCK_COUNT = 10;

async function simulate() {
    console.log('--- Starting Historical Simulation ---');
    // Mock TelegramBot for simulation
    const mockBot = {
        sendMessage: (chatId, message, options) => {
            console.log(`[MOCK TELEGRAM] Sending message to ${chatId}:`);
            console.log(message);
            console.log('------------------------------------');
        }
    };

    // Mock Database for simulation
    const mockDb = {
        getAllUsers: async () => {
            return [{ user_id: 'mock_user', chat_id: 'mock_chat_id' }]; // Return a mock user
        }
    };

    const monitor = new StoryProtocolMonitor(mockDb); // Pass the mockDb
    // Manually set lastCheckedBlock to ensure checkBlockForIPEvents is called for all blocks
    monitor.lastCheckedBlock = START_BLOCK - 1;

    const initialized = await monitor.initialize();
    if (!initialized) {
        console.error('Failed to initialize monitor. Exiting simulation.');
        return;
    }

    // Assign the mock bot to the monitor instance
    monitor.bot = mockBot; // Assign the mock bot here

    // Simulate the monitorNewBlocks loop for the specified range
    for (let i = 0; i < BLOCK_COUNT; i++) {
        const blockNumber = START_BLOCK + i;
        console.log(`
[SIMULATION] Processing block: ${blockNumber}`);
        await monitor.checkBlockForIPEvents(blockNumber);
    }

    console.log(`
--- Historical Simulation Complete ---`);
}

simulate();
