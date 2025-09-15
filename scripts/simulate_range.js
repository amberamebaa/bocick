require('dotenv').config();
const { ethers } = require('ethers');

const RPCS = [process.env.STORY_RPC_URL,'https://mainnet.storyrpc.io','https://rpc.story.foundation','https://story-rpc.ankr.com'].filter(Boolean);
const SWAP_ROUTER_ADDRESS = '0x1062916B1Be3c034C1dC6C26f682Daf1861A3909'.toLowerCase();
const DATA_PREFIX = '0xc04b8d59';
const WIP_TOKEN_ADDRESS = '0x1514000000000000000000000000000000000000'.toLowerCase();

async function getProvider() {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await Promise.race([
        p.getBlockNumber(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000))
      ]);
      console.log(`[SIM] Using RPC: ${url}`);
      return p;
    } catch (e) {
      console.log(`[SIM] RPC failed: ${url} -> ${e.message}`);
    }
  }
  throw new Error('No working RPC');
}

async function extractTargetAddressFromData(data) {
  if (!data || !data.startsWith('0x')) return null;
  const hex = data.slice(2);
  const marker = 'bb8';
  const idx = hex.lastIndexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  const end = start + 40;
  if (hex.length < end) return null;
  const addr = '0x' + hex.slice(start, end);
  try { return ethers.getAddress(addr).toLowerCase(); } catch { return null; }
}

async function main() {
  const start = parseInt(process.env.SIM_START_BLOCK || '8381002', 10);
  const count = parseInt(process.env.SIM_BLOCK_COUNT || '10', 10);
  const end = start + count - 1;
  const provider = await getProvider();

  const erc20Iface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)'
  ]);

  console.log(`[SIM] Scanning blocks ${start}..${end}`);

  const results = [];

  for (let bn = start; bn <= end; bn++) {
    const block = await provider.getBlock(bn);
    if (!block || !block.transactions || block.transactions.length === 0) {
      console.log(`[SIM] Block ${bn}: no transactions`);
      continue;
    }

    const txs = await Promise.all(block.transactions.map(h => provider.getTransaction(h)));

    const map = {};

    for (const tx of txs) {
      if (!tx || !tx.to || !tx.data) continue;
      if (tx.to.toLowerCase() !== SWAP_ROUTER_ADDRESS) continue;
      if (!tx.data.startsWith(DATA_PREFIX)) continue;

      const targetAddr = await extractTargetAddressFromData(tx.data);
      if (!targetAddr) continue;

      if (!map[targetAddr]) map[targetAddr] = { matchCount: 0, totalWip: 0n, txs: [] };
      map[targetAddr].matchCount += 1;
      map[targetAddr].txs.push(tx);

      try {
        const receipt = await provider.getTransactionReceipt(tx.hash);
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== WIP_TOKEN_ADDRESS) continue;
          try {
            const parsed = erc20Iface.parseLog(log);
            if (parsed && parsed.name === 'Transfer') {
              map[targetAddr].totalWip += parsed.args.value;
            }
          } catch {}
        }
      } catch {}
    }

    const wipDecimals = 18;
    for (const addr of Object.keys(map)) {
      const m = map[addr];
      const meets = m.matchCount >= 10 && m.totalWip >= ethers.parseUnits('500', wipDecimals);
      console.log(`[SIM] Block ${bn} | ${addr} -> matches=${m.matchCount}, totalWip=${ethers.formatUnits(m.totalWip, wipDecimals)} | meets=${meets}`);
      if (meets) {
        results.push({ blockNumber: bn, tokenToBuy: addr, matchCount: m.matchCount, totalWip: ethers.formatUnits(m.totalWip, wipDecimals) });
      }
    }
  }

  if (results.length === 0) {
    console.log('[SIM] No blocks met trading conditions in the range.');
  } else {
    console.log('[SIM] Matches:', JSON.stringify(results, null, 2));
  }
}

main().catch(err => { console.error(err); process.exit(1); });

