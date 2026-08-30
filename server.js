import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// 智能寻找 index.html 路径 (支持各种上传目录结构)
function findIndexPath() {
  const possiblePaths = [
    path.join(__dirname, 'index.html'),
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, 'client/index.html'),
    path.join(process.cwd(), 'client/index.html'),
    path.join(__dirname, 'texas-holdem/index.html'),
    path.join(process.cwd(), 'texas-holdem/index.html')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

app.use(express.static(__dirname));
app.use(express.static(process.cwd()));

app.get('*', (req, res) => {
  if (req.path.startsWith('/socket.io') || req.path.startsWith('/health')) return;
  const p = findIndexPath();
  if (p) {
    res.sendFile(p);
  } else {
    // 终极保底：如果 GitHub 上没有上传 index.html，直接返回内置前端
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><title>德州聚会 - 提示</title><meta charset="utf-8"></head>
      <body style="background:#0b0f19;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
        <h2>🃏 德州服务运行中</h2>
        <p>请将项目中的 <b>index.html</b> 上传到 GitHub 仓库根目录即可完整展示牌桌！</p>
      </body>
      </html>
    `);
  }
});

// ================= 扑克引擎与密码学洗牌 =================
const SUITS = ['s', 'h', 'd', 'c'];
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANKS = [
  { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' },
  { value: 5, label: '5' }, { value: 6, label: '6' }, { value: 7, label: '7' },
  { value: 8, label: '8' }, { value: 9, label: '9' }, { value: 10, label: '10' },
  { value: 11, label: 'J' }, { value: 12, label: 'Q' }, { value: 13, label: 'K' },
  { value: 14, label: 'A' }
];

class Card {
  constructor(suit, rank, label) {
    this.suit = suit;
    this.rank = rank;
    this.label = label;
    this.symbol = SUIT_SYMBOLS[suit];
    this.id = `${label}${suit}`;
  }
  toString() { return `${this.label}${this.symbol}`; }
  toJSON() { return { id: this.id, suit: this.suit, rank: this.rank, label: this.label, symbol: this.symbol }; }
}

class Deck {
  constructor() {
    this.cards = [];
    this.reset();
  }
  reset() {
    this.cards = [];
    for (const s of SUITS) {
      for (const r of RANKS) {
        this.cards.push(new Card(s, r.value, r.label));
      }
    }
  }
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      const temp = this.cards[i];
      this.cards[i] = this.cards[j];
      this.cards[j] = temp;
    }
  }
  burn() {
    if (this.cards.length > 0) return this.cards.pop();
    return null;
  }
  deal(count = 1) {
    const res = [];
    for (let i = 0; i < count; i++) {
      if (this.cards.length > 0) res.push(this.cards.pop());
    }
    return res;
  }
}

// ================= 7选5 手牌评级 =================
const HAND_TYPES = {
  ROYAL_FLUSH: { rank: 10, name: '皇家同花顺' },
  STRAIGHT_FLUSH: { rank: 9, name: '同花顺' },
  FOUR_OF_A_KIND: { rank: 8, name: '四条' },
  FULL_HOUSE: { rank: 7, name: '葫芦' },
  FLUSH: { rank: 6, name: '同花' },
  STRAIGHT: { rank: 5, name: '顺子' },
  THREE_OF_A_KIND: { rank: 4, name: '三条' },
  TWO_PAIR: { rank: 3, name: '两对' },
  ONE_PAIR: { rank: 2, name: '一对' },
  HIGH_CARD: { rank: 1, name: '高牌' }
};

const RANK_NAMES = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };

function evaluate5Cards(cards) {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = sorted.map(c => c.rank);
  const suits = sorted.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = false;
  let straightHigh = 0;

  if (ranks[0] - ranks[1] === 1 && ranks[1] - ranks[2] === 1 && ranks[2] - ranks[3] === 1 && ranks[3] - ranks[4] === 1) {
    isStraight = true;
    straightHigh = ranks[0];
  } else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
    isStraight = true;
    straightHigh = 5;
  }

  const countMap = {};
  for (const r of ranks) countMap[r] = (countMap[r] || 0) + 1;
  const counts = Object.entries(countMap)
    .map(([r, c]) => ({ rank: parseInt(r, 10), count: c }))
    .sort((a, b) => b.count !== a.count ? b.count - a.count : b.rank - a.rank);

  if (isFlush && isStraight) {
    if (straightHigh === 14) return { type: HAND_TYPES.ROYAL_FLUSH, score: [10, 14], description: '皇家同花顺' };
    return { type: HAND_TYPES.STRAIGHT_FLUSH, score: [9, straightHigh], description: `同花顺 (${RANK_NAMES[straightHigh]}高)` };
  }
  if (counts[0].count === 4) return { type: HAND_TYPES.FOUR_OF_A_KIND, score: [8, counts[0].rank, counts[1].rank], description: `四条 (${RANK_NAMES[counts[0].rank]})` };
  if (counts[0].count === 3 && counts[1].count === 2) return { type: HAND_TYPES.FULL_HOUSE, score: [7, counts[0].rank, counts[1].rank], description: `葫芦 (${RANK_NAMES[counts[0].rank]}带${RANK_NAMES[counts[1].rank]})` };
  if (isFlush) return { type: HAND_TYPES.FLUSH, score: [6, ...ranks], description: `同花 (${RANK_NAMES[ranks[0]]}高)` };
  if (isStraight) return { type: HAND_TYPES.STRAIGHT, score: [5, straightHigh], description: `顺子 (${RANK_NAMES[straightHigh]}高)` };
  if (counts[0].count === 3) return { type: HAND_TYPES.THREE_OF_A_KIND, score: [4, counts[0].rank, counts[1].rank, counts[2].rank], description: `三条 (${RANK_NAMES[counts[0].rank]})` };
  if (counts[0].count === 2 && counts[1].count === 2) {
    const hp = Math.max(counts[0].rank, counts[1].rank);
    const lp = Math.min(counts[0].rank, counts[1].rank);
    return { type: HAND_TYPES.TWO_PAIR, score: [3, hp, lp, counts[2].rank], description: `两对 (${RANK_NAMES[hp]}和${RANK_NAMES[lp]})` };
  }
  if (counts[0].count === 2) return { type: HAND_TYPES.ONE_PAIR, score: [2, counts[0].rank, counts[1].rank, counts[2].rank, counts[3].rank], description: `一对 (${RANK_NAMES[counts[0].rank]})` };
  return { type: HAND_TYPES.HIGH_CARD, score: [1, ...ranks], description: `高牌 (${RANK_NAMES[ranks[0]]}高)` };
}

function compareScores(scoreA, scoreB) {
  const len = Math.max(scoreA.length, scoreB.length);
  for (let i = 0; i < len; i++) {
    const a = scoreA[i] || 0;
    const b = scoreB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function get5Combinations(cards) {
  const res = [];
  function fn(start, chosen) {
    if (chosen.length === 5) { res.push([...chosen]); return; }
    for (let i = start; i < cards.length; i++) {
      chosen.push(cards[i]);
      fn(i + 1, chosen);
      chosen.pop();
    }
  }
  fn(0, []);
  return res;
}

function evaluateHand(cards) {
  if (!cards || cards.length < 5) return { type: HAND_TYPES.HIGH_CARD, score: [0], description: '高牌' };
  const combos = get5Combinations(cards);
  let best = null;
  for (const c of combos) {
    const cur = evaluate5Cards(c);
    if (!best || compareScores(cur.score, best.score) > 0) best = cur;
  }
  return best;
}

// ================= 多边池管理 =================
class PotManager {
  static calculatePots(contributors) {
    const active = contributors.filter(p => p.totalBet > 0).map(p => ({ ...p }));
    if (active.length === 0) return [];
    const levels = Array.from(new Set(active.map(p => p.totalBet))).sort((a, b) => a - b);
    const pots = [];
    let processed = 0;
    for (const lvl of levels) {
      if (lvl <= processed) continue;
      const inc = lvl - processed;
      let amt = 0;
      const elig = [];
      for (const p of active) {
        if (p.totalBet >= lvl) {
          amt += inc;
          if (!p.folded) elig.push(p.id);
        }
      }
      if (amt > 0 && elig.length > 0) pots.push({ amount: amt, eligiblePlayerIds: elig });
      processed = lvl;
    }
    return pots;
  }

  static distributePots(players) {
    const pots = this.calculatePots(players);
    const payouts = [];
    const pMap = new Map();
    players.forEach(p => pMap.set(p.id, p));

    for (let i = 0; i < pots.length; i++) {
      const pot = pots[i];
      const eligible = pot.eligiblePlayerIds.map(id => pMap.get(id)).filter(Boolean);
      if (eligible.length === 0) continue;
      if (eligible.length === 1) {
        payouts.push({ playerId: eligible[0].id, amount: pot.amount });
        continue;
      }

      let best = [eligible[0]];
      for (let j = 1; j < eligible.length; j++) {
        const cmp = compareScores(eligible[j].bestHand.score, best[0].bestHand.score);
        if (cmp > 0) best = [eligible[j]];
        else if (cmp === 0) best.push(eligible[j]);
      }

      const share = Math.floor(pot.amount / best.length);
      let rem = pot.amount % best.length;
      for (const w of best) {
        let winAmt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        payouts.push({ playerId: w.id, amount: winAmt });
      }
    }

    const summary = {};
    payouts.forEach(p => {
      if (!summary[p.playerId]) summary[p.playerId] = { playerId: p.playerId, totalWon: 0 };
      summary[p.playerId].totalWon += p.amount;
    });
    return Object.values(summary);
  }
}

// ================= AI 决策 =================
const BOT_NAMES = [
  '周星星·赌圣', '高进·赌神', '陈刀仔', '老谋深算·老王',
  '狂徒·杰克', '数学家·冯诺', '锦鲤·小美', '稳健大师·强哥',
  'AlphaPoker', '萌新小白'
];

class PokerBot {
  static decide(table, bot) {
    const toCall = table.currentBet - bot.currentRoundBet;
    const canCheck = toCall === 0;
    const chips = bot.chips;

    if (table.stage === 'PREFLOP') {
      const [c1, c2] = bot.holeCards;
      const r1 = Math.max(c1.rank, c2.rank);
      const r2 = Math.min(c1.rank, c2.rank);
      const isPair = r1 === r2;
      const isSuited = c1.suit === c2.suit;

      let score = (r1 + r2) * 2;
      if (isPair) score += 30;
      if (isSuited) score += 10;

      if (canCheck) {
        if (score >= 45 && Math.random() < 0.6) return { action: 'raise', amount: table.bigBlind * 3 };
        return { action: 'check', amount: 0 };
      }
      if (score >= 50) {
        if (Math.random() < 0.3) return { action: 'raise', amount: table.currentBet * 2 + table.minRaise };
        return { action: 'call', amount: toCall };
      } else if (score >= 32 && toCall <= table.bigBlind * 2) {
        return { action: 'call', amount: toCall };
      }
      return { action: 'fold', amount: 0 };
    }

    // 翻牌后
    const allCards = [...bot.holeCards, ...table.communityCards];
    const evalRes = evaluateHand(allCards);
    const rank = evalRes.type.rank;

    if (rank >= 4) {
      if (canCheck) return Math.random() < 0.3 ? { action: 'check', amount: 0 } : { action: 'bet', amount: Math.floor(table.pot * 0.6) };
      return Math.random() < 0.4 ? { action: 'raise', amount: table.currentBet * 2 + table.minRaise } : { action: 'call', amount: toCall };
    }
    if (rank >= 2) {
      if (canCheck) return { action: 'check', amount: 0 };
      if (toCall <= chips * 0.25) return { action: 'call', amount: toCall };
      return { action: 'fold', amount: 0 };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }
}

// ================= 牌桌状态机 =================
class PokerTable {
  constructor({ id, name = '德州聚会桌', maxSeats = 10, gameMode = 'CASH', smallBlind = 10, bigBlind = 20, defaultBuyIn = 1000 }) {
    this.id = id;
    this.name = name;
    this.maxSeats = maxSeats;
    this.gameMode = gameMode;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.defaultBuyIn = defaultBuyIn;
    this.seats = new Array(maxSeats).fill(null);
    this.deck = new Deck();
    this.communityCards = [];
    this.stage = 'IDLE';
    this.dealerSeat = -1;
    this.smallBlindSeat = -1;
    this.bigBlindSeat = -1;
    this.currentActorSeat = -1;
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.pot = 0;
    this.handCount = 0;
    this.handWinners = [];
    this.actionTimeRemaining = 15;
    this.timerInterval = null;
    this.playerStatsMap = {};
    this.handHistoryList = [];
    this.onStateChange = null;
    this.onLog = null;
  }

  log(msg) { if (this.onLog) this.onLog(msg); }
  notify() { if (this.onStateChange) this.onStateChange(this); }

  sitDown(idx, player) {
    if (idx < 0 || idx >= this.maxSeats || this.seats[idx] !== null) return { success: false, msg: '座位已占用' };
    
    const existing = this.seats.find(s => s && s.id === player.id);
    if (existing) return { success: false, msg: '您已在牌桌中' };

    const seatPlayer = {
      id: player.id,
      name: player.name,
      avatar: player.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${player.name}`,
      isBot: Boolean(player.isBot),
      chips: player.chips || this.defaultBuyIn,
      holeCards: [],
      currentRoundBet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      hasActed: false,
      lastAction: null,
      showCards: false
    };

    this.seats[idx] = seatPlayer;
    if (!this.playerStatsMap[player.id]) {
      this.playerStatsMap[player.id] = { id: player.id, name: player.name, played: 0, wins: 0, chips: seatPlayer.chips };
    }
    this.log(`玩家 [${player.name}] 坐在了 ${idx + 1} 号位`);
    this.notify();
    return { success: true, player: seatPlayer };
  }

  standUp(playerId) {
    const idx = this.seats.findIndex(s => s && s.id === playerId);
    if (idx === -1) return false;
    const p = this.seats[idx];
    this.log(`玩家 [${p.name}] 离开了座位`);
    if (this.stage !== 'IDLE' && this.stage !== 'END_HAND' && !p.folded) {
      this.playerAction(playerId, 'fold');
    }
    this.seats[idx] = null;
    this.notify();
    return true;
  }

  rebuy(playerId, amt = 1000) {
    const p = this.seats.find(s => s && s.id === playerId);
    if (p && p.chips === 0) {
      p.chips += amt;
      this.log(`玩家 [${p.name}] 重新带入了 ${amt} 筹码`);
      this.notify();
      return { success: true };
    }
    return { success: false, msg: '筹码未耗尽' };
  }

  getActiveSeats() {
    return this.seats.map((p, i) => ({ p, i })).filter(item => item.p !== null && item.p.chips > 0);
  }
  getInHandSeats() {
    return this.seats.map((p, i) => ({ p, i })).filter(item => item.p !== null && !item.p.folded && item.p.holeCards.length > 0);
  }

  startNewHand() {
    clearInterval(this.timerInterval);
    const active = this.getActiveSeats();
    if (active.length < 2) {
      this.stage = 'IDLE';
      this.log('等待至少 2 名玩家就绪...');
      this.notify();
      return false;
    }

    this.handCount++;
    this.stage = 'PREFLOP';
    this.communityCards = [];
    this.handWinners = [];
    this.pot = 0;
    this.deck.reset();
    this.deck.shuffle();

    this.seats.forEach(p => {
      if (p) {
        p.holeCards = [];
        p.currentRoundBet = 0;
        p.totalBet = 0;
        p.folded = p.chips <= 0;
        p.allIn = false;
        p.hasActed = false;
        p.lastAction = null;
        p.showCards = false;
        if (this.playerStatsMap[p.id]) this.playerStatsMap[p.id].played++;
      }
    });

    this.rotateDealer();
    this.postBlinds();

    for (let r = 0; r < 2; r++) {
      for (const item of this.getActiveSeats()) {
        if (!item.p.folded) item.p.holeCards.push(this.deck.deal(1)[0]);
      }
    }

    this.log(`--- 第 ${this.handCount} 局开始 [盲注 ${this.smallBlind}/${this.bigBlind}] ---`);
    this.setInitialActorPreflop();
    this.notify();
    this.startTimer();
    return true;
  }

  rotateDealer() {
    const active = this.getActiveSeats();
    if (this.dealerSeat === -1) {
      this.dealerSeat = active[0].i;
    } else {
      let next = (this.dealerSeat + 1) % this.maxSeats;
      while (!this.seats[next] || this.seats[next].chips <= 0) {
        next = (next + 1) % this.maxSeats;
      }
      this.dealerSeat = next;
    }
  }

  getNextSeat(from) {
    let n = (from + 1) % this.maxSeats;
    while (!this.seats[n] || this.seats[n].folded || this.seats[n].chips <= 0) {
      n = (n + 1) % this.maxSeats;
    }
    return n;
  }

  postBlinds() {
    const active = this.getActiveSeats();
    if (active.length === 2) {
      this.smallBlindSeat = this.dealerSeat;
      this.bigBlindSeat = active.find(it => it.i !== this.dealerSeat).i;
    } else {
      this.smallBlindSeat = this.getNextSeat(this.dealerSeat);
      this.bigBlindSeat = this.getNextSeat(this.smallBlindSeat);
    }

    const sb = this.seats[this.smallBlindSeat];
    const bb = this.seats[this.bigBlindSeat];

    const sbAmt = Math.min(this.smallBlind, sb.chips);
    sb.chips -= sbAmt; sb.currentRoundBet = sbAmt; sb.totalBet = sbAmt;
    if (sb.chips === 0) sb.allIn = true;
    sb.lastAction = `小盲 ${sbAmt}`;

    const bbAmt = Math.min(this.bigBlind, bb.chips);
    bb.chips -= bbAmt; bb.currentRoundBet = bbAmt; bb.totalBet = bbAmt;
    if (bb.chips === 0) bb.allIn = true;
    bb.lastAction = `大盲 ${bbAmt}`;

    this.pot = sbAmt + bbAmt;
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
  }

  setInitialActorPreflop() {
    const active = this.getActiveSeats();
    this.currentActorSeat = active.length === 2 ? this.dealerSeat : this.getNextSeat(this.bigBlindSeat);
  }

  startTimer() {
    clearInterval(this.timerInterval);
    this.actionTimeRemaining = 15;
    this.timerInterval = setInterval(() => {
      this.actionTimeRemaining--;
      this.notify();
      if (this.actionTimeRemaining <= 0) {
        clearInterval(this.timerInterval);
        this.handleTimeout();
      }
    }, 1000);
  }

  handleTimeout() {
    if (this.currentActorSeat === -1) return;
    const p = this.seats[this.currentActorSeat];
    if (!p) return;
    if (p.currentRoundBet === this.currentBet) {
      this.playerAction(p.id, 'check');
    } else {
      this.playerAction(p.id, 'fold');
    }
  }

  playerAction(playerId, act, amount = 0) {
    if (this.currentActorSeat === -1) return { success: false, msg: '当前不可行动' };
    const p = this.seats[this.currentActorSeat];
    if (!p || p.id !== playerId) return { success: false, msg: '不是您的行动回合' };

    const toCall = this.currentBet - p.currentRoundBet;

    if (act === 'fold') {
      p.folded = true;
      p.lastAction = '弃牌';
      this.log(`玩家 [${p.name}] 弃牌`);
    } else if (act === 'check') {
      if (toCall > 0) return this.playerAction(playerId, 'fold');
      p.lastAction = '过牌';
      this.log(`玩家 [${p.name}] 过牌`);
    } else if (act === 'call') {
      const callAmt = Math.min(toCall, p.chips);
      p.chips -= callAmt; p.currentRoundBet += callAmt; p.totalBet += callAmt;
      this.pot += callAmt;
      if (p.chips === 0) p.allIn = true;
      p.lastAction = p.allIn ? `全下跟注 ${callAmt}` : `跟注 ${callAmt}`;
      this.log(`玩家 [${p.name}] ${p.lastAction}`);
    } else if (act === 'raise' || act === 'bet') {
      const target = Math.max(parseInt(amount, 10), this.currentBet + this.minRaise);
      const need = target - p.currentRoundBet;
      if (need >= p.chips) return this.playerAction(playerId, 'allIn');

      p.chips -= need; p.currentRoundBet = target; p.totalBet += need;
      this.pot += need;
      this.minRaise = target - this.currentBet;
      this.currentBet = target;
      p.lastAction = `加注至 ${target}`;
      this.log(`玩家 [${p.name}] 加注至 ${target}`);
    } else if (act === 'allIn') {
      const allChips = p.chips;
      const target = p.currentRoundBet + allChips;
      p.chips = 0; p.currentRoundBet = target; p.totalBet += allChips;
      this.pot += allChips;
      p.allIn = true;
      if (target > this.currentBet) {
        this.minRaise = Math.max(this.minRaise, target - this.currentBet);
        this.currentBet = target;
      }
      p.lastAction = `All-in 全下 (${allChips})`;
      this.log(`🔥 玩家 [${p.name}] All-in 全下 ${allChips}！`);
    }

    p.hasActed = true;
    this.advance();
    return { success: true };
  }

  advance() {
    clearInterval(this.timerInterval);
    const inHand = this.getInHandSeats();
    if (inHand.length === 1) {
      this.settleSurvivor(inHand[0].p);
      return;
    }

    const betting = inHand.filter(it => !it.p.allIn);
    const allActed = inHand.every(it => it.p.hasActed || it.p.allIn);
    const allEqual = inHand.every(it => it.p.allIn || it.p.currentRoundBet === this.currentBet);

    if ((betting.length <= 1 && allEqual) || (allActed && allEqual)) {
      this.nextStage();
    } else {
      this.currentActorSeat = this.findNextActor(this.currentActorSeat);
      this.notify();
      this.startTimer();
    }
  }

  findNextActor(from) {
    for (let i = 1; i <= this.maxSeats; i++) {
      const s = (from + i) % this.maxSeats;
      const p = this.seats[s];
      if (p && !p.folded && !p.allIn && (!p.hasActed || p.currentRoundBet < this.currentBet)) {
        return s;
      }
    }
    return -1;
  }

  nextStage() {
    this.seats.forEach(p => { if (p) { p.currentRoundBet = 0; p.hasActed = false; } });
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    const betting = this.getInHandSeats().filter(it => !it.p.allIn);
    const autoRun = betting.length <= 1;

    if (this.stage === 'PREFLOP') {
      this.deck.burn();
      this.communityCards.push(...this.deck.deal(3));
      this.stage = 'FLOP';
      this.log(`【发翻牌】${this.communityCards.map(c => c.toString()).join(' ')}`);
    } else if (this.stage === 'FLOP') {
      this.deck.burn();
      this.communityCards.push(...this.deck.deal(1));
      this.stage = 'TURN';
      this.log(`【发转牌】${this.communityCards.map(c => c.toString()).join(' ')}`);
    } else if (this.stage === 'TURN') {
      this.deck.burn();
      this.communityCards.push(...this.deck.deal(1));
      this.stage = 'RIVER';
      this.log(`【发河牌】${this.communityCards.map(c => c.toString()).join(' ')}`);
    } else if (this.stage === 'RIVER') {
      this.settleShowdown();
      return;
    }

    if (autoRun) {
      this.notify();
      setTimeout(() => this.nextStage(), 1200);
    } else {
      this.currentActorSeat = this.getNextSeat(this.dealerSeat);
      this.notify();
      this.startTimer();
    }
  }

  settleSurvivor(winner) {
    this.stage = 'END_HAND';
    winner.chips += this.pot;
    this.handWinners = [{ playerId: winner.id, name: winner.name, totalWon: this.pot, description: '对手全部弃牌' }];
    this.recordHandResult();
    this.log(`🏆 玩家 [${winner.name}] 独揽底池 ${this.pot} 筹码`);
    this.finishHand();
  }

  settleShowdown() {
    this.stage = 'SHOWDOWN';
    const inHand = this.getInHandSeats();

    const evaluated = inHand.map(it => {
      const all = [...it.p.holeCards, ...this.communityCards];
      const b = evaluateHand(all);
      it.p.bestHand = b;
      it.p.showCards = true;
      return { id: it.p.id, name: it.p.name, totalBet: it.p.totalBet, folded: it.p.folded, bestHand: b };
    });

    const payouts = PotManager.distributePots(evaluated);
    this.handWinners = payouts.map(w => {
      const p = this.seats.find(s => s && s.id === w.playerId);
      if (p) p.chips += w.totalWon;
      const info = evaluated.find(e => e.id === w.playerId);
      return { playerId: w.playerId, name: info ? info.name : '未知', totalWon: w.totalWon, description: info ? info.bestHand.description : '' };
    });

    this.recordHandResult();
    this.handWinners.forEach(w => this.log(`🏆 [${w.name}] 赢得 ${w.totalWon} 筹码 (${w.description})`));
    this.stage = 'END_HAND';
    this.finishHand();
  }

  recordHandResult() {
    this.handWinners.forEach(w => {
      if (this.playerStatsMap[w.playerId]) this.playerStatsMap[w.playerId].wins++;
    });

    this.seats.forEach(p => {
      if (p && this.playerStatsMap[p.id]) {
        this.playerStatsMap[p.id].chips = p.chips;
      }
    });

    this.handHistoryList.unshift({
      handNumber: this.handCount,
      pot: this.pot,
      communityCards: this.communityCards.map(c => c.toString()),
      winners: this.handWinners
    });
    if (this.handHistoryList.length > 30) this.handHistoryList.pop();
  }

  finishHand() {
    clearInterval(this.timerInterval);
    this.notify();
    setTimeout(() => {
      if (this.getActiveSeats().length >= 2) this.startNewHand();
      else { this.stage = 'IDLE'; this.notify(); }
    }, 4000);
  }

  getPublicState(viewerId) {
    return {
      id: this.id,
      stage: this.stage,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerSeat: this.dealerSeat,
      smallBlindSeat: this.smallBlindSeat,
      bigBlindSeat: this.bigBlindSeat,
      currentActorSeat: this.currentActorSeat,
      actionTimeRemaining: this.actionTimeRemaining,
      handWinners: this.handWinners,
      handCount: this.handCount,
      communityCards: this.communityCards.map(c => c.toJSON()),
      seats: this.seats.map((p, idx) => {
        if (!p) return null;
        const isSelf = p.id === viewerId;
        const reveal = this.stage === 'SHOWDOWN' || this.stage === 'END_HAND' || p.showCards;
        return {
          seatIndex: idx,
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          isBot: p.isBot,
          chips: p.chips,
          currentRoundBet: p.currentRoundBet,
          totalBet: p.totalBet,
          folded: p.folded,
          allIn: p.allIn,
          lastAction: p.lastAction,
          holeCards: p.holeCards.map(c => (isSelf || reveal) ? c.toJSON() : { isHidden: true })
        };
      })
    };
  }
}

// ================= Socket.io 房间管理 =================
const rooms = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let res = '';
  for (let i = 0; i < 6; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

io.on('connection', socket => {
  let currentRoomId = null;
  let currentPlayerId = null;

  function broadcastTable(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    io.in(roomId).fetchSockets().then(sockets => {
      for (const s of sockets) {
        s.emit('table_update', room.table.getPublicState(s.data.playerId));
      }
    });
  }

  function checkBotTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const { table } = room;
    if (table.stage === 'IDLE' || table.stage === 'END_HAND') return;
    const actor = table.seats[table.currentActorSeat];
    if (actor && actor.isBot) {
      setTimeout(() => {
        if (table.seats[table.currentActorSeat] && table.seats[table.currentActorSeat].id === actor.id) {
          const dec = PokerBot.decide(table, actor);
          table.playerAction(actor.id, dec.action, dec.amount);
        }
      }, 800 + Math.random() * 800);
    }
  }

  socket.on('create_room', (options, callback) => {
    const roomId = generateRoomId();
    const table = new PokerTable({
      id: roomId,
      name: options.name || `德州房间 ${roomId}`,
      gameMode: options.gameMode || 'CASH'
    });

    table.onStateChange = () => {
      broadcastTable(roomId);
      checkBotTurn(roomId);
    };
    table.onLog = msg => io.to(roomId).emit('game_log', { message: msg });

    rooms.set(roomId, { table, hostId: options.playerId });
    socket.join(roomId);
    currentRoomId = roomId;
    currentPlayerId = options.playerId;
    socket.data.playerId = options.playerId;

    callback({ success: true, roomId });
  });

  socket.on('join_room', ({ roomId, player }, callback) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return callback({ success: false, msg: '房间号不存在' });

    currentRoomId = roomId.toUpperCase();
    currentPlayerId = player.id;
    socket.data.playerId = player.id;
    socket.join(currentRoomId);

    callback({ success: true, roomId: currentRoomId, tableState: room.table.getPublicState(player.id) });
    broadcastTable(currentRoomId);
  });

  socket.on('sit_down', ({ seatIndex, player }, callback) => {
    if (!currentRoomId) return callback({ success: false, msg: '未加入房间' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ success: false, msg: '房间不存在' });
    callback(room.table.sitDown(seatIndex, player));
  });

  socket.on('add_bot', (opts, callback) => {
    if (!currentRoomId) return callback({ success: false, msg: '未加入房间' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ success: false, msg: '房间不存在' });

    const emptyIdx = room.table.seats.findIndex(s => s === null);
    if (emptyIdx === -1) return callback({ success: false, msg: '座位已满' });

    const used = room.table.seats.filter(Boolean).map(s => s.name);
    const available = BOT_NAMES.filter(n => !used.includes(n));
    const bName = available.length > 0 ? available[0] : `AI ${Math.floor(Math.random() * 100)}`;
    const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    callback(room.table.sitDown(emptyIdx, { id: botId, name: bName, isBot: true, chips: 1000 }));
  });

  socket.on('start_game', callback => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback({ success: room.table.startNewHand() });
  });

  socket.on('player_action', ({ action, amount }, callback) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.playerAction(currentPlayerId, action, amount));
  });

  socket.on('rebuy', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.rebuy(currentPlayerId, 1000));
  });

  socket.on('get_stats', callback => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const list = Object.values(room.table.playerStatsMap).map(p => ({
      ...p,
      winRate: p.played > 0 ? ((p.wins / p.played) * 100).toFixed(1) + '%' : '0.0%'
    })).sort((a, b) => b.chips - a.chips);

    callback({ leaderboard: list, recentHands: room.table.handHistoryList });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Texas Hold'em Server running on port ${PORT}`);
});
