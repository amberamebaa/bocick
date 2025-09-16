require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { getDatabase } = require('./config/database');
const { StoryProtocolMonitor } = require('./services/storyMonitor');

console.log('🚀 Starting Story Monitor Bot...');

// Check if bot token exists
if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN missing! Add your bot token to .env file');
    process.exit(1);
}

let bot;
let db;
let storyMonitor;

async function initializeBot() {
    try {
        // Initialize database
        console.log('📊 Initializing database...');
        db = await getDatabase();

        // Create bot instance
        bot = new TelegramBot(process.env.BOT_TOKEN, {polling: true});

        // Initialize Story Protocol monitoring
        console.log('🔍 Initializing Story monitoring...');
        storyMonitor = new StoryProtocolMonitor(db);
        const rpcConnected = await storyMonitor.initialize();

        if (rpcConnected) {
            console.log('✅ Story Protocol RPC connected');

            // Start the actual monitoring
            storyMonitor.startMonitoring(bot);

        } else {
            console.log('⚠️  Story Protocol monitoring disabled (RPC connection failed)');
            process.exit(1); // Exit if RPC connection failed
        }

        // Handle /newips command
        bot.onText(/.newips/, async (msg) => {
            const chatId = msg.chat.id;

            try {
                bot.sendMessage(chatId, '🔍 Pobieranie ostatnich kreacji IP...');

                const recentIPs = await storyMonitor.getRecentIPs(24);

                if (recentIPs.length === 0) {
                    bot.sendMessage(chatId, `
📊 **Ostatnie IP Assets (24h)**

Nie znaleziono nowych IP assets w ciągu ostatnich 24 godzin.

Monitorowanie jest aktywne - otrzymasz alerty gdy nowe IP będą utworzone! 🚀
      `);
                    return;
                }

                let message = `📊 **Ostatnie IP Assets (24h): ${recentIPs.length}**\n\n`;

                recentIPs.slice(0, 10).forEach((ip, index) => {
                    message += `**${index + 1}.** ${ip.name}\n`;
                    message += `Adres: 
`;
                    message += `Twórca: 
`;
                    message += `Podaż: ${ip.initial_supply?.toLocaleString() || 'Nieznana'}\n`;
                    message += `Utworzono: ${new Date(ip.created_at).toLocaleString()}\n\n`;
                });

                if (recentIPs.length > 10) {
                    message += `...i ${recentIPs.length - 10} więcej`;
                }

                bot.sendMessage(chatId, message, {parse_mode: 'Markdown'});

            } catch (error) {
                console.error('❌ Error getting recent IPs:', error);
                bot.sendMessage(chatId, '❌ Błąd pobierania danych IP. Spróbuj później.');
            }
        });

        // Handle /monitor command
        bot.onText(/.monitor/, async (msg) => {
            const chatId = msg.chat.id;

            const storyStatus = storyMonitor && storyMonitor.isMonitoring ? '✅ AKTYWNY' : '❌ NIEAKTYWNY';

            bot.sendMessage(chatId, `
🔍 **Status Monitora Story Protocol**

**Status IP:** ${storyStatus}
**Monitorowanie:** Tworzenie nowych IP
**Interwał sprawdzania:** Co 30 sekund
**Baza danych:** ${db ? '✅ Połączona' : '❌ Rozłączona'}

Otrzymasz alerty dla:
- 🆕 Tworzenia nowych IP assets
- 📊 Informacji o podażach i twórcach
- 🔗 Bezpośrednich linków do Storyscan

Zostań w gotowości na alpha! 🚀
  `, {parse_mode: 'Markdown'});
        });

        // Handle /help command - NEW
        bot.onText(/.help/, async (msg) => {
            const chatId = msg.chat.id;

            const helpMsg = `
📖 **Pomoc - Story Protocol Bot**

**🎯 Podstawowe Komendy:**
/start - Rejestracja i menu główne
/help - Ta lista komend
/status - Twój status alertów
/users - Liczba użytkowników

**📊 Monitorowanie IP Assets:**
/newips - Najnowsze tokeny IP (24h)
/monitor - Status systemu monitorowania
/test - Test połączeń systemowych

**💡 Pro Tips:**
- Wszystkie linki prowadzą do Storyscan
- Bot działa 24/7

**🚀 Przykłady:**

Potrzebujesz pomocy? Napisz do @story_monitor_support
            `;

            bot.sendMessage(chatId, helpMsg, {parse_mode: 'Markdown'});
        });

        // Handle errors
        bot.on('polling_error', (error) => {
            console.error('❌ Polling error:', error.message);
        });

        console.log('✅ Bot initialized and running!');
        console.log('✅ Database ready for Story Protocol monitoring');
        console.log('Send /start to your bot to test it.');

    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);
        process.exit(1);
    }
}

// Mock function for whale transactions (replace with real database query)
async function getRecentWhaleTransactions(hours) {
    // This would be replaced with actual database query
    const mockWhales = [
        {
            amount: 156,
            type: 'buy',
            tokenName: 'Creative Asset Token',
            timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
        },
        {
            amount: 89,
            type: 'sell',
            tokenName: 'Music Rights IP',
            timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
        }
    ];

    return Math.random() > 0.5 ? mockWhales : [];
}

// Handle shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bot...');

    if (storyMonitor) {
        storyMonitor.stopMonitoring();
    }

    if (db) {
        await db.close();
    }

    process.exit(0);
});

// Start the bot
initializeBot();
