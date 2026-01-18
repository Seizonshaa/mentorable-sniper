// Mentorable Telegram Sniper Bot - Railway Deployment
// Reads configuration from environment variables

const { ethers } = require('ethers');
const TelegramBot = require('node-telegram-bot-api');

// ============================================
// CONFIGURATION FROM ENVIRONMENT VARIABLES
// ============================================
const CONFIG = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID,
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || '0x329740b817165e7bf08f8d75ca560f12299ac62',
  RPC_URL: process.env.RPC_URL || 'https://mainnet.base.org',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  
  BUY_AMOUNT: process.env.BUY_AMOUNT || '0.01',
  MAX_PRIORITY_FEE: process.env.MAX_PRIORITY_FEE || '0.001',
  MAX_FEE: process.env.MAX_FEE || '0.002',
  AUTO_SNIPE: process.env.AUTO_SNIPE === 'false' ? false : true,
  MIN_BALANCE: process.env.MIN_BALANCE || '0.05',
};

// Validate required environment variables
if (!CONFIG.TELEGRAM_TOKEN) {
  console.error('❌ ERROR: TELEGRAM_TOKEN environment variable is required!');
  process.exit(1);
}
if (!CONFIG.ADMIN_ID) {
  console.error('❌ ERROR: ADMIN_ID environment variable is required!');
  process.exit(1);
}
if (!CONFIG.PRIVATE_KEY) {
  console.error('❌ ERROR: PRIVATE_KEY environment variable is required!');
  process.exit(1);
}

// ============================================
// CONTRACT ABI
// ============================================
const CONTRACT_ABI = [
  'event TokenMinted(address indexed mentor, string name, string symbol, uint256 timestamp)',
  'function buyTokens(address mentor, uint256 amount) payable returns (bool)',
  'function getPrice(address mentor) view returns (uint256)',
  'function getTokenInfo(address mentor) view returns (string, string, uint256)',
];

// ============================================
// TELEGRAM SNIPER BOT CLASS
// ============================================
class TelegramSniperBot {
  constructor(config) {
    this.config = config;
    this.isRunning = false;
    this.stats = {
      sniped: 0,
      successful: 0,
      failed: 0,
      totalSpent: '0',
    };
    
    // Initialize Telegram bot
    this.bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
    
    // Initialize blockchain connection
    this.provider = new ethers.JsonRpcProvider(config.RPC_URL);
    this.wallet = new ethers.Wallet(config.PRIVATE_KEY, this.provider);
    this.contract = new ethers.Contract(
      config.CONTRACT_ADDRESS,
      CONTRACT_ABI,
      this.wallet
    );
    
    this.setupCommands();
    this.sendMessage('🤖 Mentorable Sniper Bot is online!');
  }

  async sendMessage(text, options = {}) {
    try {
      await this.bot.sendMessage(this.config.ADMIN_ID, text, {
        parse_mode: 'HTML',
        ...options
      });
    } catch (error) {
      console.error('Error sending message:', error.message);
    }
  }

  setupCommands() {
    // Command: /start
    this.bot.onText(/\/start/, (msg) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) {
        this.bot.sendMessage(msg.chat.id, '❌ Unauthorized');
        return;
      }
      
      this.bot.sendMessage(msg.chat.id, `
🤖 <b>Mentorable Sniper Bot</b>

Available commands:

/snipe - Start auto-sniping
/stop - Stop auto-sniping
/status - Check bot status
/balance - Check wallet balance
/stats - View trading statistics
/config - View current settings
/setamount [ETH] - Set buy amount
/help - Show this menu

Example: /setamount 0.02
      `, { parse_mode: 'HTML' });
    });

    // Command: /snipe
    this.bot.onText(/\/snipe/, async (msg) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) return;
      
      if (this.isRunning) {
        await this.bot.sendMessage(msg.chat.id, '⚠️ Bot is already running!');
        return;
      }
      
      await this.startSniping();
    });

    // Command: /stop
    this.bot.onText(/\/stop/, async (msg) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) return;
      
      if (!this.isRunning) {
        await this.bot.sendMessage(msg.chat.id, '⚠️ Bot is not running!');
        return;
      }
      
      this.stopSniping();
      await this.bot.sendMessage(msg.chat.id, '⏹️ Bot stopped');
    });

    // Command: /status
    this.bot.onText(/\/status/, async (msg) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) return;
      
      const balance = await this.provider.getBalance(this.wallet.address);
      const status = this.isRunning ? '🟢 Running' : '🔴 Stopped';
      
      await this.bot.sendMessage(msg.chat.id, `
📊 <b>Bot Status</b>

Status: ${status}
Wallet: <code>${this.wallet.address}</code>
Balance: ${ethers.formatEther(balance)} ETH
Contract: <code>${this.config.CONTRACT_ADDRESS}</code>

Auto-snipe: ${this.config.AUTO_SNIPE ? '✅ Enabled' : '❌ Disabled'}
Buy Amount: ${this.config.BUY_AMOUNT} ETH
      `, { parse_mode: 'HTML' });
    });

    // Command: /balance
    this.bot.onText(/\/balance/, async (msg) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) return;
      
      const balance = await this.provider.getBalance(this.wallet.address);
      await this.bot.sendMessage(msg.chat.id, `
💰 <b>Wallet Balance</b>

${ethers.formatEther(balance)} ETH

Address: <code>${this.wallet.address}</code>
      `, { parse_mode: 'HTML' });
    });

    // Command: /stats
    this.bot.onText(/\/stats/, async (msg) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) return;
      
      await this.bot.sendMessage(msg.chat.id, `
📈 <b>Trading Statistics</b>

Total Attempts: ${this.stats.sniped}
✅ Successful: ${this.stats.successful}
❌ Failed: ${this.stats.failed}
💸 Total Spent: ${this.stats.totalSpent} ETH

Success Rate: ${this.stats.sniped > 0 ? 
  ((this.stats.successful / this.stats.sniped) * 100).toFixed(1) : 0}%
      `, { parse_mode: 'HTML' });
    });

    // Command: /setamount
    this.bot.onText(/\/setamount (.+)/, async (msg, match) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) return;
      
      const amount = match[1];
      if (isNaN(amount) || parseFloat(amount) <= 0) {
        await this.bot.sendMessage(msg.chat.id, '❌ Invalid amount');
        return;
      }
      
      this.config.BUY_AMOUNT = amount;
      await this.bot.sendMessage(msg.chat.id, 
        `✅ Buy amount set to ${amount} ETH`);
    });

    // Command: /config
    this.bot.onText(/\/config/, async (msg) => {
      if (msg.from.id.toString() !== this.config.ADMIN_ID) return;
      
      await this.bot.sendMessage(msg.chat.id, `
⚙️ <b>Current Configuration</b>

Buy Amount: ${this.config.BUY_AMOUNT} ETH
Max Priority Fee: ${this.config.MAX_PRIORITY_FEE} gwei
Max Fee: ${this.config.MAX_FEE} gwei
Min Balance: ${this.config.MIN_BALANCE} ETH
Auto-Snipe: ${this.config.AUTO_SNIPE ? 'ON' : 'OFF'}
      `, { parse_mode: 'HTML' });
    });
  }

  async startSniping() {
    this.isRunning = true;
    await this.sendMessage('🎯 <b>Auto-sniping started!</b>\n\nWatching for new mints...');
    
    this.contract.on('TokenMinted', async (mentor, name, symbol, timestamp, event) => {
      const notification = `
🚨 <b>NEW MINT DETECTED!</b>

👤 Mentor: <code>${mentor}</code>
📛 Name: ${name}
🏷️ Symbol: ${symbol}
⏰ Time: ${new Date(Number(timestamp) * 1000).toLocaleTimeString()}

${this.config.AUTO_SNIPE ? '💰 Attempting to buy...' : '⏸️ Auto-snipe disabled'}
      `;
      
      await this.sendMessage(notification);
      
      if (this.config.AUTO_SNIPE) {
        await this.snipe(mentor, name, symbol);
      }
    });
  }

  stopSniping() {
    this.isRunning = false;
    this.contract.removeAllListeners('TokenMinted');
  }

  async snipe(mentor, name, symbol) {
    this.stats.sniped++;
    
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      if (parseFloat(ethers.formatEther(balance)) < parseFloat(this.config.MIN_BALANCE)) {
        await this.sendMessage('⚠️ <b>Low balance!</b> Stopping bot.');
        this.stopSniping();
        return;
      }

      const price = await this.contract.getPrice(mentor);
      await this.sendMessage(`💵 Current price: ${ethers.formatEther(price)} ETH`);

      const buyAmount = ethers.parseEther(this.config.BUY_AMOUNT);
      const tx = await this.contract.buyTokens(mentor, 1, {
        value: buyAmount,
        maxPriorityFeePerGas: ethers.parseUnits(this.config.MAX_PRIORITY_FEE, 'gwei'),
        maxFeePerGas: ethers.parseUnits(this.config.MAX_FEE, 'gwei'),
      });

      await this.sendMessage(`📤 Transaction sent!\n<code>${tx.hash}</code>`);

      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.stats.successful++;
        this.stats.totalSpent = (
          parseFloat(this.stats.totalSpent) + parseFloat(this.config.BUY_AMOUNT)
        ).toString();
        
        await this.sendMessage(`
✅ <b>SUCCESS!</b>

🎉 Tokens purchased for ${name}!
💰 Spent: ${this.config.BUY_AMOUNT} ETH
🔗 <a href="https://basescan.org/tx/${tx.hash}">View on BaseScan</a>

Stats: ${this.stats.successful}/${this.stats.sniped} successful
        `);
      } else {
        this.stats.failed++;
        await this.sendMessage('❌ Transaction failed');
      }

    } catch (error) {
      this.stats.failed++;
      await this.sendMessage(`
❌ <b>Snipe Failed</b>

Error: ${error.message}

This might be due to:
- Insufficient funds
- Gas price too low
- Token sold out
      `);
    }
  }
}

// ============================================
// STARTUP
// ============================================
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   MENTORABLE SNIPER BOT v1.0          ║');
  console.log('║   Running on Railway                   ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log('- Telegram Bot:', CONFIG.TELEGRAM_TOKEN ? '✅ Set' : '❌ Missing');
  console.log('- Admin ID:', CONFIG.ADMIN_ID ? '✅ Set' : '❌ Missing');
  console.log('- Private Key:', CONFIG.PRIVATE_KEY ? '✅ Set' : '❌ Missing');
  console.log('- Contract:', CONFIG.CONTRACT_ADDRESS);
  console.log('- RPC:', CONFIG.RPC_URL);
  console.log('- Buy Amount:', CONFIG.BUY_AMOUNT, 'ETH\n');

  const bot = new TelegramSniperBot(CONFIG);
  
  console.log('✅ Bot is running!');
  console.log('📱 Send /start to your bot on Telegram\n');
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled error:', error);
});

process.on('SIGINT', () => {
  console.log('\n👋 Bot stopped');
  process.exit(0);
});

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { TelegramSniperBot };
