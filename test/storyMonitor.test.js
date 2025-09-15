const { StoryProtocolMonitor } = require('../src/services/storyMonitor');
const { ethers } = require('ethers');

describe('StoryProtocolMonitor', () => {
    let monitor;
    let mockDb;
    let mockBot;
    let mockProvider;

    beforeEach(() => {
        mockDb = {
            getAllUsers: jest.fn().mockResolvedValue([{ chat_id: 1, user_id: 1 }]),
            // Add other mock DB methods if needed by the tested functions
        };
        mockBot = {
            sendMessage: jest.fn().mockResolvedValue(true),
        };
        mockProvider = {
            getBlockNumber: jest.fn().mockResolvedValue(100),
            getBlock: jest.fn().mockResolvedValue({ transactions: [] }),
            getTransaction: jest.fn().mockResolvedValue({}),
            getTransactionReceipt: jest.fn().mockResolvedValue({ logs: [] }),
        };

        monitor = new StoryProtocolMonitor(mockDb);
        monitor.bot = mockBot; // Manually assign bot mock
        monitor.provider = mockProvider; // Manually assign provider mock
        monitor.storyscanUrl = 'https://www.storyscan.io'; // Ensure storyscanUrl is set
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('checkForMultipleTokenTransfers', () => {
        it('should not send alert if criteria are not met (less than 10 transfers)', async () => {
            const blockNumber = 123;
            const tokenAddress = '0xToken1';
            const transferEventsInBlock = {
                [tokenAddress]: Array(5).fill({ txHash: '0xhash', value: ethers.parseUnits('100', 18) })
            };

            await monitor.checkForMultipleTokenTransfers(blockNumber, transferEventsInBlock);

            expect(mockBot.sendMessage).not.toHaveBeenCalled();
        });

        it('should not send alert if criteria are not met (total value less than 500 WIP)', async () => {
            const blockNumber = 123;
            const tokenAddress = '0xToken1';
            const transferEventsInBlock = {
                [tokenAddress]: Array(11).fill({ txHash: '0xhash', value: ethers.parseUnits('10', 18) }) // 11 * 10 = 110 WIP
            };

            await monitor.checkForMultipleTokenTransfers(blockNumber, transferEventsInBlock);

            expect(mockBot.sendMessage).not.toHaveBeenCalled();
        });

        it('should send alert if criteria are met (more than 10 transfers and total value over 500 WIP)', async () => {
            const blockNumber = 123;
            const tokenAddress = '0xToken1';
            const transferEventsInBlock = {
                [tokenAddress]: Array(11).fill({ txHash: '0xhash', value: ethers.parseUnits('50', 18) }) // 11 * 50 = 550 WIP
            };

            await monitor.checkForMultipleTokenTransfers(blockNumber, transferEventsInBlock);

            expect(mockBot.sendMessage).toHaveBeenCalledTimes(1);
            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                1, // chat_id from mockDb.getAllUsers
                expect.stringContaining('MULTIPLE TOKEN TRANSFERS DETECTED!'),
                expect.any(Object)
            );
        });
    });
});
