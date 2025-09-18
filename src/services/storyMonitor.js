const axios = require('axios');
const { ethers } = require('ethers');

// --- CONTRACTS & ADDRESSES FOR PURCHASE ---
const SWAP_ROUTER_ADDRESS = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909'; // From your previous test file
const AGGREGATOR_ADDRESS = '0xe47809790a0ce703c2ac81598c90d5cc1569675d'; // From your previous test file
const WETH9_ADDRESS = '0x4200000000000000000000000000000000000006'; // Common WETH9 address on Optimism/Base, assuming Story Protocol uses a similar one or this is the correct one for your chain
const GAS_LIMIT_APPROVE = 100000;
const GAS_LIMIT_SWAP = 300000;

// --- ABIs ---
const SWAP_ROUTER_ABI = [
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
    "function exactInput(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) external payable returns (uint256 amountOut)",
    "function WIP9() external view returns (address)"
];
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) public returns (bool)",
    "function allowance(address owner, address spender) public view returns (uint256)",
    "function decimals() view returns (uint8)" // Added for convenience
];

// --- RAW INPUT FOR SWAP (from test_purchase_final_v2.js) ---
// Note: This data is for a 0.1 IP swap. We will replace the amount dynamically.
const rawInputForSwap = '0x8b22555800000201090000200000bc8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000930dcd3914c9f6c2774014bbbe2702274c01aca0bd0c5389779f5a05001001100002b000014d5178f9f07b08d01d075cc5b7e1a1ae23a37b3811522cb2fed1367201d51d4e51514000000000000000000000000000000000000000bb8d1b2d3df51c3e5a22b09993354b8717e3a7e4d3be15b147923a4a1c4b9bc0aff6e476713e36c0ec3000000000083293e000068c6be390003005a';
const originalAmountSlot = '000000000000000000000000000000000000000000000000016345785d8a0000';

class StoryProtocolMonitor {
    constructor(database) {
        this.db = database;
        this.rpcUrls = [
            'https://mainnet.storyrpc.io',
            'https://rpc.story.foundation',
            'https://story-rpc.ankr.com'
        ];
        this.storyscanUrl = 'https://www.storyscan.io';
        this.provider = null;
        this.currentRpcIndex = 0;
        this.isMonitoring = false;
        this.lastCheckedBlock = null;
        this.contractAddresses = {
            IPAssetRegistry: '0x35Ec4c334f82AbA1d4F69759A2f6e4bdCf597695'
        };
        this.monitoredTokens = []; // Array to store tokens for 2-hour monitoring
        this.signer = null;
        this.simulationMode = false; // disables live notifications and tx sending when true
        this.simulationResults = [];
    }

    async initialize() {
        // Try each RPC URL until one works
        for (let i = 0; i < this.rpcUrls.length; i++) {
            const rpcUrl = this.rpcUrls[i];
            console.log(`🔗 Trying RPC: ${rpcUrl}`);

            try {
                this.provider = new ethers.JsonRpcProvider(rpcUrl);
                console.log(`[DEBUG] Provider initialized for ${rpcUrl}`);

                // Test connection with timeout
                const blockNumberPromise = this.provider.getBlockNumber();
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000));

                const result = await Promise.race([blockNumberPromise, timeoutPromise]);
                console.log(`[DEBUG] Promise.race result:`, result);

                const blockNumber = result; // Assign result to blockNumber

                console.log(`✅ Connected to Story Protocol RPC - Block: ${blockNumber}`);
                console.log(`✅ Using RPC: ${rpcUrl}`);
                this.currentRpcIndex = i;
                this.lastCheckedBlock = blockNumber;

                // Initialize signer for trading
                if (process.env.PRIVATE_KEY) {
                    try {
                        this.signer = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
                        console.log(`✅ Signer initialized for wallet: ${this.signer.address}`);
                    } catch (e) {
                        console.error(`❌ Failed to initialize signer: ${e.message}`);
                        this.signer = null;
                    }
                } else {
                    console.log('⚠️ PRIVATE_KEY not found in .env file. Trading functionality will be disabled.');
                }

                return true;

            } catch (error) {
                console.log(`❌ RPC ${rpcUrl} failed: ${error.message}`);
                console.error(`[DEBUG] Full error object:`, error); // Log full error object
                continue;
            }
        }

        console.error('❌ All RPC endpoints failed.');
        return false;
    }

    async startMonitoring(bot) {
        if (this.isMonitoring) {
            console.log('⚠️  Monitoring already started');
            return;
        }

        this.isMonitoring = true;
        this.bot = bot;

        console.log('🔍 Starting Story Protocol monitoring...');

        if (this.provider) {
            console.log('✅ Using real blockchain monitoring');
            this.monitorNewBlocks();
        } else {
            console.log('❌ No RPC connection - monitoring disabled');
        }

        console.log('✅ Story Protocol monitoring started');
    }


    async monitorNewBlocks() {
        const checkInterval = 3000; // 3 seconds

        const monitor = async () => {
            if (!this.isMonitoring) return;

            try {
                const currentBlock = await this.provider.getBlockNumber();
                console.log(`[${new Date().toLocaleTimeString()}] [monitorNewBlocks] Current block: ${currentBlock}, Last checked block: ${this.lastCheckedBlock}`);

                if (this.lastCheckedBlock && currentBlock > this.lastCheckedBlock) {
                    console.log(`[${new Date().toLocaleTimeString()}] [monitorNewBlocks] Checking blocks ${this.lastCheckedBlock + 1} to ${currentBlock}`);

                    // Check each new block for IP asset creation events
                    for (let blockNum = this.lastCheckedBlock + 1; blockNum <= currentBlock; blockNum++) {
                        await this.checkBlockForIPEvents(blockNum);
                    }
                }

                this.lastCheckedBlock = currentBlock;

            } catch (error) {
                console.error('❌ Error monitoring blocks:', error.message);

                // Try to reconnect if connection failed
                if (error.message.includes('CONNECTION') || error.message.includes('TIMEOUT')) {
                    console.log('🔄 Attempting to reconnect...');
                    await this.initialize();
                }
            }

            // Schedule next check
            setTimeout(monitor, checkInterval);
        };

        monitor();
    }

    // Simulation helper: scan a fixed range of blocks without sending Telegram alerts
    async simulateBlocks(startBlock, count) {
        if (!this.provider) {
            throw new Error('Provider not initialized. Call initialize() first.');
        }

        this.simulationMode = true;
        this.simulationResults = [];

        console.log(`[SIM] Starting simulation from block ${startBlock} for ${count} blocks...`);
        for (let i = 0; i < count; i++) {
            const blockNum = startBlock + i;
            console.log(`[SIM] Checking block ${blockNum}`);
            await this.checkBlockForIPEvents(blockNum);
        }

        console.log(`[SIM] Simulation finished. Results: ${JSON.stringify(this.simulationResults, null, 2)}`);
        this.simulationMode = false;
        return this.simulationResults;
    }

    async checkBlockForIPEvents(blockNumber) {
        try {
            const block = await this.provider.getBlock(blockNumber, true);
            if (!block || !block.transactions) {
                return;
            }

            const targetToAddress = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909'.toLowerCase();
            const targetDataPrefix = '0xc04b8d59';
            const wipTokenAddress = '0x1514000000000000000000000000000000000000'.toLowerCase();

            // Get WIP token decimals once
            const wipContract = new ethers.Contract(wipTokenAddress, ["function decimals() view returns (uint8)"], this.provider);
            const wipDecimals = await wipContract.decimals();

            console.log(`[FINAL MODE] Checking block ${blockNumber} for trading conditions...`);

            // Initialize counters for this block
            const ipAssetDataMap = {}; // Stores { address: { matchCount, totalWip, transactionsInBlock } }

            // Create an array of promises, where each promise is a getTransaction call
            const transactionPromises = block.transactions.map(txHash => this.provider.getTransaction(txHash));

            // Wait for all promises to resolve
            const transactions = await Promise.all(transactionPromises);

            // Now iterate through the full transaction objects
            for (const tx of transactions) {
                if (!tx || !tx.to) continue;

                if (tx.to.toLowerCase() === targetToAddress && tx.data.startsWith(targetDataPrefix)) {
                    // Dynamiczne wyodrębnianie adresu smart kontraktu z tx.data
                    // Adres znajduje się na końcu ciągu tx.data, ma 40 znaków (bez 0x)
                    // Przykład: ...2b1514000000000000000000000000000000000000000bb8a074aca68eeb6c831a78c84606f3cb44f9e547f500000000000000000000000000000000000000000
                    const dataWithoutPrefix = tx.data.substring(2); // Usuń "0x"
                    const searchString = 'bb8'; // Szukamy tego ciągu przed adresem
                    const searchIndex = dataWithoutPrefix.lastIndexOf(searchString);

                    if (searchIndex !== -1 && dataWithoutPrefix.length >= searchIndex + searchString.length + 40) {
                        const extractedIpAssetToken = '0x' + dataWithoutPrefix.substring(searchIndex + searchString.length, searchIndex + searchString.length + 40);

                        if (!ipAssetDataMap[extractedIpAssetToken]) {
                            ipAssetDataMap[extractedIpAssetToken] = {
                                matchCount: 0,
                                totalWip: ethers.toBigInt(0),
                                transactionsInBlock: []
                            };
                        }

                        ipAssetDataMap[extractedIpAssetToken].matchCount++;
                        ipAssetDataMap[extractedIpAssetToken].transactionsInBlock.push(tx);

                        // Fetch receipt to find WIP transfer
                        try {
                            const receipt = await this.provider.getTransactionReceipt(tx.hash);
                            const erc20ABI = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
                            const iface = new ethers.Interface(erc20ABI);

                            for (const log of receipt.logs) {
                                if (log.address.toLowerCase() === wipTokenAddress) {
                                    try {
                                        const decodedLog = iface.parseLog(log);
                                        if (decodedLog.name === "Transfer") {
                                            ipAssetDataMap[extractedIpAssetToken].totalWip += decodedLog.args.value;
                                        }
                                    } catch (e) { /* ignore non-transfer logs */
                                    }
                                }
                            }
                        } catch (e) {
                            console.error(`   - Error processing receipt for tx ${tx.hash}: ${e.message}`);
                        }
                    }
                }
            }

            // Po przetworzeniu wszystkich transakcji, sprawdź warunki dla każdego IP Asset
            for (const ipAssetAddress in ipAssetDataMap) {
                const data = ipAssetDataMap[ipAssetAddress];
                if (data.matchCount >= 10 && data.totalWip >= ethers.parseUnits("500", wipDecimals)) {
                    const formattedWipTotal = ethers.formatUnits(data.totalWip, wipDecimals);
                    console.log(`🚨 TRADING CONDITIONS MET IN BLOCK ${blockNumber} for IP Asset: ${ipAssetAddress}!`);
                    console.log(`   - Found ${data.matchCount} matching transactions.`);
                    console.log(`   - Total WIP transferred: ${formattedWipTotal}`);

                    // Trigger the final alert
                    await this.sendTradingConditionAlert(blockNumber, data.matchCount, formattedWipTotal, data.transactionsInBlock, [ipAssetAddress]);
                } else {
                    console.log(`Block ${blockNumber}: Conditions not met for IP Asset ${ipAssetAddress}. Found ${data.matchCount} matching transactions, total WIP: ${ethers.formatUnits(data.totalWip, wipDecimals)}`);
                }
            }

        } catch (error) {
            console.error(`❌ Error checking block ${blockNumber} in final mode:`, error.message);
        }
    }

    async sendTargetTransactionAlert(tx, amount = null) {
        try {
            const users = await this.db.getAllUsers();
            if (users.length === 0) {
                console.log('📭 No users to send target transaction alert to');
                return;
            }

            let amountString = '';
            if (amount !== null) {
                amountString = `**WIP Amount:** ${parseFloat(amount).toFixed(4)} IP\n`;
            }

            const alertMessage = `
🎯 **Test Target Transaction Detected!**

A transaction matching your specified criteria has been found.

**To:** 
${tx.to}
**Method:** 
${tx.data.substring(0, 10)}
${amountString}[View on Storyscan](${this.storyscanUrl}/tx/${tx.hash})
            `;

            console.log(`📢 Sending Target Transaction alert to ${users.length} users for tx ${tx.hash}`);

            for (const user of users) {
                try {
                    await this.bot.sendMessage(user.chat_id, alertMessage, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`❌ Failed to send target alert to user ${user.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('❌ Error sending target transaction alert:', error);
        }
    }

    async sendTradingConditionAlert(blockNumber, count, totalWip, matchingTransactions, ipAssetTokens) {
        try {
            if (this.simulationMode) {
                const uniqueIpAssetTokens = [...new Set(ipAssetTokens)];
                const tokenToBuy = uniqueIpAssetTokens[0] || null;
                this.simulationResults.push({blockNumber, tokenToBuy, count, totalWip});
                if (tokenToBuy) {
                    await this.executePurchase(tokenToBuy, 0.2, {dryRun: true});
                }
                return;
            }
            const users = await this.db.getAllUsers();
            if (users.length === 0) {
                console.log('📭 No users to send trading condition alert to');
                return;
            }

            let txHashesString = matchingTransactions.map(tx => ` - [${tx.hash.substring(0, 10)}...](${this.storyscanUrl}/tx/${tx.hash})`).join('\n');
            if (txHashesString.length > 1000) { // Telegram message limit
                txHashesString = txHashesString.substring(0, 900) + '\n... (truncated)';
            }

            const uniqueIpAssetTokens = [...new Set(ipAssetTokens)];
            let ipAssetTokensString = '';
            if (uniqueIpAssetTokens.length > 0) {
                ipAssetTokensString = '\n**IP Asset Tokens:**\n' + uniqueIpAssetTokens.map(addr => ` - [${addr.substring(0, 10)}...](${this.storyscanUrl}/address/${addr})`).join('\n');
            }

            const alertMessage = `
🚨 **HIGH PRIORITY: TRADING CONDITIONS MET!** 🚨

**Block:** ${blockNumber}
**Matching Transactions:** ${count} (>= 10)
**Total WIP Transferred:** ${totalWip} (>= 500)

**Action:** Consider purchasing the relevant token.
${ipAssetTokensString}

**Transaction Hashes:**
${txHashesString}

[View Block on Storyscan](${this.storyscanUrl}/block/${blockNumber})
            `;

            console.log(`📢 Sending TRADING CONDITION alert to ${users.length} users for block ${blockNumber}`);

            // Execute purchase if conditions are met and a token is identified
            if (uniqueIpAssetTokens.length > 0) {
                // Assuming we only purchase the first identified token for simplicity
                const tokenToBuy = uniqueIpAssetTokens[0];
                const amountToSpend = 100; // 60 WIP as requested
                await this.executePurchase(tokenToBuy, amountToSpend);
            }

            for (const user of users) {
                try {
                    await this.bot.sendMessage(user.chat_id, alertMessage, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`❌ Failed to send trading condition alert to user ${user.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('❌ Error sending trading condition alert:', error);
        }
    }

    async checkForMultipleTokenTransfers(blockNumber, transferEventsInBlock) {
        for (const tokenAddress in transferEventsInBlock) {
            const transfers = transferEventsInBlock[tokenAddress];

            if (transfers.length > 10) {
                let totalValue = ethers.toBigInt(0);
                for (const transfer of transfers) {
                    totalValue = totalValue + transfer.value;
                }

                // Assuming WIP token has 18 decimals for now. This might need to be dynamic if other tokens are involved.
                const WIP_DECIMALS = 18;
                const thresholdInWei = ethers.parseUnits("500", WIP_DECIMALS); // 500 whole WIP tokens

                if (totalValue > thresholdInWei) {
                    console.log(`🚨 ALERT: Multiple Token Transfers Detected in Block ${blockNumber}!`);
                    console.log(`   Token Address: ${tokenAddress}`);
                    console.log(`   Number of Transfers: ${transfers.length}`);
                    console.log(`   Total Value (Wei): ${totalValue.toString()}`);
                    console.log(`   Total Value (WIP): ${ethers.formatUnits(totalValue, WIP_DECIMALS)}`);
                    console.log(`   Transaction Hashes: ${transfers.map(t => t.txHash).join(', ')}`);

                    // TODO: Implement actual alert sending (e.g., to Discord)
                    await this.sendMultipleTransferAlert(blockNumber, tokenAddress, transfers.length, ethers.formatUnits(totalValue, WIP_DECIMALS), transfers.map(t => t.txHash));
                }
            }
        }
    }

    async sendMultipleTransferAlert(blockNumber, tokenAddress, numTransfers, totalValueWIP, txHashes) {
        try {
            const users = await this.db.getAllUsers();

            if (users.length === 0) {
                console.log('📭 No users to alert for multiple transfers');
                return;
            }

            const alertMessage = `
🚨 **MULTIPLE TOKEN TRANSFERS DETECTED!**

**Block Number:** ${blockNumber}
**Token Address:** 
${tokenAddress}
**Number of Transfers:** ${numTransfers}
**Total Value (WIP):** ${totalValueWIP}
**Transaction Hashes:**
${txHashes.map(hash => ` - [${hash.substring(0, 10)}...](${this.storyscanUrl}/tx/${hash})`).join('\n')}

📈 High volume of transfers for the same token detected!
            `;

            console.log(`📢 Sending multiple transfer alert to ${users.length} users for token ${tokenAddress}`);

            for (const user of users) {
                try {
                    await this.bot.sendMessage(user.chat_id, alertMessage, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });

                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    console.error(`❌ Failed to send multiple transfer alert to user ${user.user_id}:`, error.message);
                }
            }

        } catch (error) {
            console.error('❌ Error sending multiple transfer alerts:', error);
        }
    }

    async isWhaleTransaction(tx, tokenAddress, decodedLog) {
        const ignoredTokens = [
            '0x1514000000000000000000000000000000000000'.toLowerCase()
        ];

        if (ignoredTokens.includes(tokenAddress.toLowerCase())) {
            return; // It's an ignored token, so we do nothing.
        }

        // --- TEMPORARY DEBUG LOGGING ---
        try {
            const tokenContract = new ethers.Contract(tokenAddress, ["function decimals() view returns (uint8)"], this.provider);
            const tokenDecimals = await tokenContract.decimals();
            const formattedValue = ethers.formatUnits(decodedLog.args.value, tokenDecimals);

            console.log(`[DEBUG] Whale Check:
                - TxHash: ${tx.hash}
                - Token: ${tokenAddress}
                - Decimals: ${tokenDecimals}
                - Raw Value: ${decodedLog.args.value.toString()}
                - Formatted Value: ${formattedValue} IP
            `);
        } catch (e) {
            console.log(`[DEBUG] Could not get decimals for ${tokenAddress}. Error: ${e.message}`);
        }
        // --- END OF DEBUG LOGGING ---

        const {value} = decodedLog.args;
        const DECIMALS = 18; // Assuming 18 decimals, might need to be dynamic
        const threshold = ethers.parseUnits("15", DECIMALS);

        if (value > threshold) {
            console.log(`🚨 WHALE ALERT: Large transaction detected on token ${tokenAddress} | TxHash: ${tx.hash}`);
            await this.sendWhaleAlert(tx, tokenAddress, decodedLog.args);
        }
    }

    async sendWhaleAlert(tx, tokenAddress, args) {
        try {
            const users = await this.db.getAllUsers();
            if (users.length === 0) {
                console.log('📭 No users to send whale alert to');
                return;
            }

            const {from, to, value} = args;
            const DECIMALS = 18;
            const valueFormatted = ethers.formatUnits(value, DECIMALS);

            const alertMessage = `
🐋 **WHALE ALERT!** 🐋

A large transaction has been detected!

**Token:** 
${tokenAddress}
**From:** 
${from}
**To:** 
${to}
**Value:** **${parseFloat(valueFormatted).toFixed(2)} IP**

[View on Storyscan](${this.storyscanUrl}/tx/${tx.hash})
            `;

            console.log(`📢 Sending WHALE alert to ${users.length} users for tx ${tx.hash}`);

            for (const user of users) {
                try {
                    await this.bot.sendMessage(user.chat_id, alertMessage, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`❌ Failed to send whale alert to user ${user.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('❌ Error sending whale alert:', error);
        }
    }


    // ✅ FALLBACK: Monitor via Storyscan API
    async monitorViaStoryscan() {
        const checkInterval = 60000; // 1 minute

        const monitor = async () => {
            if (!this.isMonitoring) return;

            try {
                console.log('🔍 Checking Storyscan for new IP assets...');
                const newIPs = await this.fetchFromStoryscan();

                if (newIPs.length > 0) {
                    console.log(`🆕 Found ${newIPs.length} new IP assets via Storyscan`);
                    await this.processNewIPs(newIPs);
                }

            } catch (error) {
                console.error('❌ Error monitoring via Storyscan:', error.message);
            }

            setTimeout(monitor, checkInterval);
        };

        monitor();
    }

    async fetchFromStoryscan() {
        try {
            // Try to fetch from Storyscan API
            const response = await axios.get(`${this.storyscanUrl}/api/v1/tokens`, {
                params: {
                    limit: 10,
                    sort: 'created_desc'
                },
                timeout: 10000,
                headers: {
                    'User-Agent': 'Story-Monitor-Bot/2.0'
                }
            });

            if (response.data && response.data.tokens) {
                return response.data.tokens.map(token => ({
                    address: token.address,
                    name: token.name,
                    creator: token.creator,
                    initialSupply: token.totalSupply,
                    createdAt: token.createdAt,
                    txHash: token.creationTx
                }));
            }

            return [];

        } catch (error) {
            console.log('⚠️  Storyscan API not available:', error.message);
            return [];
        }
    }

    // ✅ REMOVE ALL MOCK DATA METHODS
    // Removed: generateMockIP()
    // Removed: generateRandomIPName()

    async processNewIPs(newIPs) {
        for (const ip of newIPs) {
            try {
                // Check if we already processed this IP
                const existingIP = await this.db.getIPAsset(ip.address);
                if (existingIP) {
                    continue; // Skip already processed IPs
                }

                // Save to database
                await this.db.saveIPAsset(ip);
                console.log(`💾 Saved new IP: ${ip.name} (${ip.address})`);

                // Send alerts to subscribed users
                await this.sendNewIPAlert(ip);

                // Add to the list of monitored tokens for 2 hours
                const monitorUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
                this.monitoredTokens.push({...ip, monitorUntil});
                console.log(`🔎 Monitoring new token ${ip.name} for 2 hours.`);

            } catch (error) {
                console.error('❌ Error processing new IP:', error.message);
            }
        }
    }

    async sendNewIPAlert(ip) {
        try {
            const users = await this.db.getAllUsers();

            if (users.length === 0) {
                console.log('📭 No users to alert');
                return;
            }

            const alertMessage = `
🆕 **NEW IP ASSET DETECTED!**

**Name:** ${ip.name}
**Address:** \`${ip.address}\`
**Creator:** \`${ip.creator}\`
**Supply:** ${ip.initialSupply ? parseInt(ip.initialSupply).toLocaleString() : 'Unknown'} tokens
**Time:** ${new Date(ip.createdAt).toLocaleString()}
**Block:** ${ip.blockNumber || 'Unknown'}

[View on Storyscan](${this.storyscanUrl}/address/${ip.address})

🚀 Real Story Protocol IP detected!
            `;

            console.log(`📢 Sending REAL IP alert to ${users.length} users: ${ip.name}`);

            for (const user of users) {
                try {
                    await this.bot.sendMessage(user.chat_id, alertMessage, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });

                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    console.error(`❌ Failed to send alert to user ${user.user_id}:`, error.message);
                }
            }

        } catch (error) {
            console.error('❌ Error sending IP alerts:', error);
        }
    }

    async getRecentIPs(hours = 24) {
        return await this.db.getRecentIPs(hours);
    }

    getConnectionStatus() {
        return {
            rpcConnected: !!this.provider,
            currentRpc: this.provider ? this.rpcUrls[this.currentRpcIndex] : 'None',
            monitoringActive: this.isMonitoring,
            lastCheckedBlock: this.lastCheckedBlock,
            mode: this.provider ? 'Real Blockchain Monitoring' : 'Disabled'
        };
    }

    stopMonitoring() {
        this.isMonitoring = false;
        console.log('🛑 Story Protocol monitoring stopped');
    }

    // Add these helper methods to the StoryProtocolMonitor class

// Helper function to validate decimals
    validateDecimals(decimals) {
        const decimalNum = Number(decimals);
        if (decimalNum < 0 || decimalNum > 255 || !Number.isInteger(decimalNum)) {
            throw new Error(`Invalid decimals: ${decimals}. Must be integer between 0-255`);
        }
        return decimalNum;
    }

// Helper function to get ERC20 token details with validation
    async getERC20TokenDetails(tokenAddress, provider) {
        try {
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function decimals() view returns (uint8)',
                'function symbol() view returns (string)',
                'function name() view returns (string)',
                'function totalSupply() view returns (uint256)',
                'function balanceOf(address) view returns (uint256)'
            ], provider);

            const [decimals, symbol, name, totalSupply] = await Promise.all([
                tokenContract.decimals(),
                tokenContract.symbol(),
                tokenContract.name(),
                tokenContract.totalSupply()
            ]);

            // Validate decimals before returning
            const validatedDecimals = this.validateDecimals(decimals);

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

// Updated executePurchase method - SDK-free approach
    async executePurchase(tokenToBuyAddress, amountWipToSpend, options = {}) {
        const {dryRun = false} = options;

        if (!this.signer) {
            console.error('❌ Signer not initialized. Cannot execute purchase.');
            return {success: false, error: 'No signer available'};
        }

        // Validate inputs
        if (!ethers.isAddress(tokenToBuyAddress)) {
            console.error('❌ Invalid token address provided');
            return {success: false, error: 'Invalid token address'};
        }

        if (amountWipToSpend <= 0) {
            console.error('❌ Invalid amount to spend');
            return {success: false, error: 'Invalid amount'};
        }

        console.log(`🚀 Attempting to purchase ${tokenToBuyAddress} with ${amountWipToSpend} WIP...`);

        try {
            const walletAddress = await this.signer.getAddress();

            // Story Protocol specific addresses
            const WIP_TOKEN_ADDRESS = '0x1514000000000000000000000000000000000000';
            const SWAP_ROUTER_ADDRESS = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909';
            const QUOTER_CONTRACT_ADDRESS = '0x865E2Bff1d5f9a01b91196D31126C2e432bC0F6C';

            // Contract ABIs
            const ERC20_ABI = [
                'function approve(address spender, uint256 amount) returns (bool)',
                'function allowance(address owner, address spender) view returns (uint256)',
                'function balanceOf(address account) view returns (uint256)',
                'function decimals() view returns (uint8)',
                'function symbol() view returns (string)',
                'function name() view returns (string)'
            ];

            const ROUTER_ABI = [
                'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
            ];

            const QUOTER_ABI = [
                'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)'
            ];

            // Get target token details first
            console.log('Getting target token details...');
            const targetTokenDetails = await this.getERC20TokenDetails(tokenToBuyAddress, this.provider);
            console.log(`Target Token: ${targetTokenDetails.symbol} (${targetTokenDetails.decimals} decimals)`);

            // The native currency is WIP. We get its balance directly.
            console.log('Getting WIP balance...');
            const wipBalance = await this.provider.getBalance(walletAddress);
            const wipDetails = { decimals: 18, symbol: 'WIP' }; // Assume 18 decimals for native WIP
            const amountInWei = ethers.parseUnits(amountWipToSpend.toString(), wipDetails.decimals);
            console.log(`WIP Balance: ${ethers.formatUnits(wipBalance, wipDetails.decimals)}`);

            if (wipBalance < amountInWei) {
                throw new Error(`Insufficient WIP balance. Have: ${ethers.formatUnits(wipBalance, wipDetails.decimals)}, Need: ${amountWipToSpend}`);
            }

            // This contract is for the precompile and used for the swap parameters
            const wipContract = new ethers.Contract(WIP_TOKEN_ADDRESS, ERC20_ABI, this.signer);

            // Get quote
            console.log('Getting price quote...');
            const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, this.provider);
            const fee = 3000; // 0.3% fee tier

            const quotedAmountOut = await quoterContract.quoteExactInputSingle(
                WIP_TOKEN_ADDRESS,
                tokenToBuyAddress,
                fee,
                amountInWei,
                0
            );

            const quotedAmountFormatted = ethers.formatUnits(quotedAmountOut, targetTokenDetails.decimals);
            console.log(`Quote: ${amountWipToSpend} WIP → ${quotedAmountFormatted} ${targetTokenDetails.symbol}`);

            // For native WIP swaps, approval is not needed.
            console.log('Skipping allowance check for native WIP swap.');

            if (dryRun) {
                // For native swaps, approval is never needed.
                return {
                    success: true,
                    dryRun: true,
                    quotedOutput: quotedAmountFormatted,
                    targetToken: targetTokenDetails.symbol,
                    needsApproval: false 
                };
            }

            // Prepare swap parameters
            console.log('Preparing swap transaction...');
            const routerContract = new ethers.Contract(SWAP_ROUTER_ADDRESS, ROUTER_ABI, this.signer);

            const swapParams = {
                tokenIn: WIP_TOKEN_ADDRESS,
                tokenOut: tokenToBuyAddress,
                fee: fee,
                recipient: walletAddress,
                deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 20), // 20 minutes
                amountIn: amountInWei,
                amountOutMinimum: 0n, // No slippage protection for now
                sqrtPriceLimitX96: 0n
            };

            // Estimate gas with fallback
            let gasLimit = 350000n;
            try {
                // For native swaps, the value must be passed to estimateGas as well
                const gasEstimate = await routerContract.exactInputSingle.estimateGas(swapParams, {value: amountInWei});
                gasLimit = gasEstimate * 2n; // 100% buffer
                console.log(`Gas estimated: ${gasEstimate}, using: ${gasLimit}`);
            } catch (e) {
                console.log(`Gas estimation failed, using fallback: ${gasLimit}. Error: ${e.message}`);
            }

            // Execute swap
            console.log('Executing swap transaction...');
            const feeData = await this.provider.getFeeData();

            const swapTx = await routerContract.exactInputSingle(swapParams, {
                value: amountInWei, // Pass the native WIP amount here
                gasLimit,
                ...(feeData.gasPrice ? {gasPrice: feeData.gasPrice} : {})
            });

            console.log(`✅ Swap transaction sent! Hash: ${swapTx.hash}`);

            const receipt = await swapTx.wait();

            if (receipt.status !== 1) {
                throw new Error('Swap transaction failed');
            }

            console.log(`🎉 Purchase successful!`);
            console.log(`   - Block: ${receipt.blockNumber}`);
            console.log(`   - Gas Used: ${receipt.gasUsed}`);
            console.log(`   - View on StoryScan: ${this.storyscanUrl}/tx/${swapTx.hash}`);

            // Check final balances
            const finalTargetBalance = await new ethers.Contract(tokenToBuyAddress, ERC20_ABI, this.provider).balanceOf(walletAddress);
            const receivedAmount = ethers.formatUnits(finalTargetBalance, targetTokenDetails.decimals);
            console.log(`   - Received: ${receivedAmount} ${targetTokenDetails.symbol}`);

            return {
                success: true,
                txHash: swapTx.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                receivedAmount,
                targetToken: targetTokenDetails.symbol
            };

        } catch (error) {
            console.error('❌ Error during purchase flow:');
            console.error(`   - Error: ${error.message}`);

            // Enhanced error handling
            if (error.message.includes('insufficient funds')) {
                return {success: false, error: 'Insufficient funds for gas fees'};
            } else if (error.message.includes('pool might not exist') || error.message.includes('quote')) {
                return {success: false, error: 'Trading pair does not exist or has no liquidity'};
            } else if (error.message.includes('slippage') || error.message.includes('SLIPPAGE')) {
                return {success: false, error: 'Slippage too high - reduce trade size'};
            } else if (error.message.includes('deadline')) {
                return {success: false, error: 'Transaction deadline exceeded'};
            } else if (error.message.includes('Insufficient WIP balance')) {
                return {success: false, error: error.message};
            }

            return {
                success: false,
                error: error.message,
                code: error.code
            };
        }
    }
}
module.exports = { StoryProtocolMonitor };





