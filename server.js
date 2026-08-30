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

// 彻底禁用页面缓存，确保更新后即刻生效
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

let cachedHtml = '';
function getIndexContent() {
  const possiblePaths = [
    path.join(__dirname, 'index.html'),
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, 'client/index.html'),
    path.join(process.cwd(), 'client/index.html'),
    path.join(__dirname, 'texas-holdem/index.html'),
    path.join(process.cwd(), 'texas-holdem/index.html')
  ];
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        cachedHtml = fs.readFileSync(p, 'utf8');
        return cachedHtml;
      }
    } catch (e) {}
  }
  return cachedHtml;
}

// 启动时预读
getIndexContent();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/socket.io') || req.path.startsWith('/health')) return;
  const html = getIndexContent();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } else {
    res.status(200).send('Texas Holdem Server is running.');
  }
});

// ================= 扑克引擎与四色牌定义 =================
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

// 实时牌型说明计算 (从 Preflop 到 River 全程实时分析)
function getHandDescription(holeCards, communityCards = []) {
  if (!holeCards || holeCards.length < 2) return '';
  const validHoles = holeCards.filter(c => c && c.rank);
  if (validHoles.length < 2) return '';

  const validCommunity = communityCards.filter(c => c && c.rank);
  const all = [...validHoles, ...validCommunity];
  if (all.length >= 5) {
    const evalRes = evaluateHand(all);
    return evalRes.description || evalRes.type.name;
  }
  if (validHoles[0].rank === validHoles[1].rank) {
    return `一对 (${RANK_NAMES[validHoles[0].rank]})`;
  }
  const maxR = Math.max(validHoles[0].rank, validHoles[1].rank);
  return `高牌 (${RANK_NAMES[maxR]}高)`;
}

// 蒙特卡洛/全排列实时胜率计算器 (All-in Equity Calculator)
function calculateAllInEquities(playersInAllIn, communityCards, deckCards) {
  const remainingNeed = 5 - communityCards.length;
  if (remainingNeed < 0 || playersInAllIn.length < 2) return {};

  const knownCards = new Set();
  communityCards.forEach(c => knownCards.add(c.toString()));
  playersInAllIn.forEach(p => p.holeCards.forEach(c => knownCards.add(c.toString())));

  const availableDeck = deckCards.filter(c => !knownCards.has(c.toString()));
  const wins = {};
  playersInAllIn.forEach(p => wins[p.id] = 0);
  const simulations = 400;

  for (let sim = 0; sim < simulations; sim++) {
    const drawn = [];
    const pool = [...availableDeck];
    for (let k = 0; k < remainingNeed; k++) {
      const idx = Math.floor(Math.random() * pool.length);
      drawn.push(pool[idx]);
      pool.splice(idx, 1);
    }
    const simCommunity = [...communityCards, ...drawn];
    let bestScore = null;
    let winners = [];
    for (const p of playersInAllIn) {
      const full = [...p.holeCards, ...simCommunity];
      const evalRes = evaluateHand(full);
      if (!bestScore || compareScores(evalRes.score, bestScore) > 0) {
        bestScore = evalRes.score;
        winners = [p.id];
      } else if (compareScores(evalRes.score, bestScore) === 0) {
        winners.push(p.id);
      }
    }
    winners.forEach(wId => {
      wins[wId] += 1 / winners.length;
    });
  }

  const equities = {};
  playersInAllIn.forEach(p => {
    equities[p.id] = Math.round((wins[p.id] / simulations) * 100) + '%';
  });
  return equities;
}

// ================= 边池分配 =================
class PotManager {
  static calculatePots(contributors) {
    const active = contributors.filter(p => p.totalBet > 0).map(p => ({ ...p }));
    if (active.length === 0) return [];
    const levels = Array.from(new Set(active.map(p => p.totalBet))).sort((a, b) => a - b);
    const pots = [];
    let processed = 0;
    let accumulatedDeadMoney = 0;

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
      if (elig.length > 0) {
        pots.push({ amount: amt + accumulatedDeadMoney, eligiblePlayerIds: elig });
        accumulatedDeadMoney = 0;
      } else {
        if (pots.length > 0) {
          pots[pots.length - 1].amount += amt;
        } else {
          accumulatedDeadMoney += amt;
        }
      }
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

// ================= AI 陪练 =================
const BOT_NAMES = [
  '周星星·赌圣', '高进·赌神', '陈刀仔', '老谋深算·老王',
  '狂徒·杰克', '数学家·冯诺', '锦鲤·小美', '稳健大师·强哥',
  'AlphaPoker', '萌新小白'
];

class PokerBot {
  static decide(table, bot) {
    const toCall = Math.max(0, table.currentBet - bot.currentRoundBet);
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
      } else if (score >= 26 && toCall <= table.bigBlind * 2) {
        return { action: 'call', amount: toCall };
      }
      return { action: 'fold', amount: 0 };
    }

    const allCards = [...bot.holeCards, ...table.communityCards];
    const evalRes = evaluateHand(allCards);
    const rank = evalRes.type.rank;

    if (rank >= 4) {
      if (canCheck) return Math.random() < 0.3 ? { action: 'check', amount: 0 } : { action: 'bet', amount: Math.max(table.bigBlind, Math.floor(table.pot * 0.6)) };
      return Math.random() < 0.4 ? { action: 'raise', amount: table.currentBet * 2 + table.minRaise } : { action: 'call', amount: toCall };
    }
    if (rank >= 2) {
      if (canCheck) return { action: 'check', amount: 0 };
      if (toCall <= chips * 0.35) return { action: 'call', amount: toCall };
      return { action: 'fold', amount: 0 };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }
}

// ================= 专业德州牌桌状态机 =================
class PokerTable {
  constructor({ id, hostId, hostName = '房主', name = 'poker', maxSeats = 9, gameMode = 'CASH', smallBlind = 10, bigBlind = 20, defaultBuyIn = 1000, durationMinutes = 0 }) {
    this.id = id;
    this.hostId = hostId;
    this.hostName = hostName;
    this.name = name;
    this.maxSeats = maxSeats;
    this.gameMode = gameMode;
    this.smallBlind = parseInt(smallBlind, 10) || 10;
    this.bigBlind = parseInt(bigBlind, 10) || (this.smallBlind * 2);
    this.defaultBuyIn = parseInt(defaultBuyIn, 10) || 1000;
    this.durationMinutes = parseInt(durationMinutes, 10) || 0;
    this.startTime = new Date();
    this.endTime = null;
    this.expireTimestamp = this.durationMinutes > 0 ? (Date.now() + this.durationMinutes * 60 * 1000) : null;

    if (this.gameMode === 'TOURNAMENT') {
      this.blindLevel = 1;
      this.blindTimerInterval = setInterval(() => {
        if (!this.isPaused && !this.isGameEnded) {
          this.blindLevel++;
          this.smallBlind = Math.round(this.smallBlind * 1.5);
          this.bigBlind = this.smallBlind * 2;
          this.minRaise = this.bigBlind;
          this.log(`🔔【锦标赛升盲】当前进入第 ${this.blindLevel} 级别，盲注升至: ${this.smallBlind}/${this.bigBlind}`);
          this.notify();
        }
      }, 300000);
    }

    this.seats = new Array(maxSeats).fill(null);
    this.deck = new Deck();
    this.communityCards = [];
    
    this.defaultActionTime = 20;
    this.actionTimeRemaining = 20;
    this.isUsingTimeBank = false;
    this.timerInterval = null;
    this.autoDealTimer = null;

    this.stage = 'IDLE';
    this.isPaused = false;
    this.isGameEnded = false;
    this.dealerSeat = -1;
    this.smallBlindSeat = -1;
    this.bigBlindSeat = -1;
    this.currentActorSeat = -1;
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.pot = 0;
    this.handCount = 0;
    this.handWinners = [];

    this.rabbitCards = [];
    this.rabbitAvailable = false;
    this.lastSurvivorWinnerId = null;
    this.bounty27Winners = [];

    this.playerStatsMap = {};
    this.handHistoryList = [];

    this.onStateChange = null;
    this.onLog = null;
  }

  log(msg) { if (this.onLog) this.onLog(msg); }
  notify() { if (this.onStateChange) this.onStateChange(this); }

  sitDown(idx, player) {
    if (this.isGameEnded && this.stage === 'IDLE') {
      this.isGameEnded = false;
    }
    if (idx < 0 || idx >= this.maxSeats) return { success: false, msg: '座位索引无效' };
    
    // 如果该玩家已经在桌上某个座位，自动更新绑定该座位
    const existingIdx = this.seats.findIndex(s => s && s.id === player.id);
    if (existingIdx !== -1) {
      const existingSeat = this.seats[existingIdx];
      existingSeat.name = player.name || existingSeat.name;
      existingSeat.avatar = player.avatar || existingSeat.avatar;
      this.notify();
      return { success: true, player: existingSeat };
    }

    if (this.seats[idx] !== null) return { success: false, msg: '该座位已被占用' };

    let realChips;
    if (this.playerStatsMap[player.id]) {
      // 玩家曾在此桌打过，严格继承并锁定本桌历史筹码！
      realChips = this.playerStatsMap[player.id].chips;
      this.playerStatsMap[player.id].name = player.name || this.playerStatsMap[player.id].name;
      this.playerStatsMap[player.id].avatar = player.avatar || this.playerStatsMap[player.id].avatar;
      this.log(`👋 玩家 [${player.name}] 重新回到 ${idx + 1} 号席位 (继承本桌真实战绩筹码: ${realChips} 🪙)`);
    } else {
      // 首次入座此房间，记录初始带入
      realChips = player.chips || this.defaultBuyIn;
      this.playerStatsMap[player.id] = {
        id: player.id,
        name: player.name,
        avatar: player.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${player.name}`,
        totalBuyIn: realChips,
        played: 0,
        wins: 0,
        chips: realChips,
        profit: 0
      };
      this.log(`玩家 [${player.name}] 首次加入本桌坐下 ${idx + 1} 号位 (初始带入: ${realChips} 🪙)`);
    }

    const seatPlayer = {
      id: player.id,
      name: player.name,
      avatar: player.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${player.name}`,
      isBot: Boolean(player.isBot),
      chips: realChips,
      holeCards: [],
      currentRoundBet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      sittingOut: false,
      leaveNextHand: false,
      timeBank: 300,
      autoMuck: true,
      revealedCards: [false, false],
      hasActed: false,
      lastAction: null,
      is27Hand: false
    };

    this.seats[idx] = seatPlayer;
    this.notify();
    this.checkAutoStart();
    return { success: true, player: seatPlayer };
  }

  // 增加/补充记分牌 (筹码)
  addChips(playerId, amount) {
    const p = this.seats.find(s => s && s.id === playerId);
    if (!p) return { success: false, msg: '玩家未在座位上' };

    const addVal = parseInt(amount, 10);
    if (isNaN(addVal) || addVal <= 0) return { success: false, msg: '请输入合法的记分牌数值' };

    p.chips += addVal;
    if (this.playerStatsMap[playerId]) {
      this.playerStatsMap[playerId].totalBuyIn += addVal;
      this.playerStatsMap[playerId].chips = p.chips;
    }
    this.log(`🪙 玩家 [${p.name}] 成功补充带入记分牌 +${addVal} (当前记分牌: ${p.chips})`);
    this.notify();
    return { success: true, newChips: p.chips };
  }

  updatePlayerName(playerId, newName) {
    const cleanName = (newName || '').trim();
    if (!cleanName) return { success: false, msg: '昵称不能为空' };
    const p = this.seats.find(s => s && s.id === playerId);
    if (p) {
      p.name = cleanName;
      p.avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanName}`;
    }
    if (this.playerStatsMap[playerId]) {
      this.playerStatsMap[playerId].name = cleanName;
      this.playerStatsMap[playerId].avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanName}`;
    }
    this.log(`✏️ 玩家更改昵称为: [${cleanName}]`);
    this.notify();
    return { success: true, newName: cleanName };
  }

  standUp(playerId) {
    const idx = this.seats.findIndex(s => s && s.id === playerId);
    if (idx === -1) return false;
    const p = this.seats[idx];
    if (this.playerStatsMap[p.id]) {
      this.playerStatsMap[p.id].chips = p.chips;
    }
    this.log(`玩家 [${p.name}] 站起离座 (带离记分牌 ${p.chips})`);
    if (this.stage !== 'IDLE' && this.stage !== 'END_HAND' && !p.folded) {
      this.playerAction(playerId, 'fold');
    }
    this.seats[idx] = null;
    this.notify();
    return true;
  }

  toggleSitOut(playerId, sitOutState) {
    const p = this.seats.find(s => s && s.id === playerId);
    if (!p) return { success: false, msg: '未在座位中' };

    p.sittingOut = sitOutState !== undefined ? sitOutState : !p.sittingOut;
    if (p.sittingOut) {
      this.log(`玩家 [${p.name}] 保位离座中`);
      if (this.stage !== 'IDLE' && this.stage !== 'END_HAND' && !p.folded) {
        this.playerAction(playerId, 'fold');
      }
    } else {
      this.log(`玩家 [${p.name}] 回到座位`);
      this.checkAutoStart();
    }
    this.notify();
    return { success: true, sittingOut: p.sittingOut };
  }

  toggleLeaveNextHand(playerId) {
    const p = this.seats.find(s => s && s.id === playerId);
    if (!p) return { success: false, msg: '未在座位中' };
    p.leaveNextHand = !p.leaveNextHand;
    this.log(`玩家 [${p.name}] 设置为: ${p.leaveNextHand ? '【本局结束后自动提前离开】' : '【取消提前离开】'}`);
    this.notify();
    return { success: true, leaveNextHand: p.leaveNextHand };
  }

  toggleShowCardIntent(playerId, cardIndex, isSelected) {
    const p = this.seats.find(s => s && s.id === playerId);
    if (!p) return { success: false };
    if (!p.showCardIntent) p.showCardIntent = [false, false];
    const idx = parseInt(cardIndex, 10);
    p.showCardIntent[idx] = isSelected !== undefined ? isSelected : !p.showCardIntent[idx];
    this.notify();
    return { success: true, showCardIntent: p.showCardIntent };
  }

  showCards(playerId, which = 'both') {
    const p = this.seats.find(s => s && s.id === playerId);
    if (!p || p.holeCards.length < 2) return { success: false };

    if (which === 'left') {
      p.revealedCards[0] = true;
      this.log(`👀 玩家 [${p.name}] 亮出左手单张: [${p.holeCards[0].toString()}]`);
    } else if (which === 'right') {
      p.revealedCards[1] = true;
      this.log(`👀 玩家 [${p.name}] 亮出右手单张: [${p.holeCards[1].toString()}]`);
    } else {
      p.revealedCards = [true, true];
      this.log(`👀 玩家 [${p.name}] 秀出双手牌: [${p.holeCards[0].toString()} ${p.holeCards[1].toString()}]`);
    }
    this.notify();
    return { success: true };
  }

  requestExtraTime(playerId) {
    if (this.currentActorSeat === -1) return { success: false, msg: '非行动回合' };
    const p = this.seats[this.currentActorSeat];
    if (!p || p.id !== playerId) return { success: false, msg: '不是您的行动回合' };

    this.actionTimeRemaining += 30;
    this.log(`⏳ 玩家 [${p.name}] 申请免费加时 +30s！`);
    this.notify();
    return { success: true, newTime: this.actionTimeRemaining };
  }

  huntRabbit(playerId) {
    if (!this.rabbitAvailable || this.rabbitCards.length === 0) {
      return { success: false, msg: '当前不可猎兔' };
    }
    const hunter = this.seats.find(s => s && s.id === playerId);
    const winner = this.seats.find(s => s && s.id === this.lastSurvivorWinnerId);
    if (!hunter) return { success: false, msg: '玩家不在桌上' };

    const cost = this.bigBlind;
    if (hunter.chips >= cost && winner && hunter.id !== winner.id) {
      hunter.chips -= cost;
      winner.chips += cost;
      this.log(`🐰 玩家 [${hunter.name}] 支付 ${cost} 记分牌给赢家 [${winner.name}]，揭晓未发牌！`);
    }

    const cardsStr = this.rabbitCards.map(c => c.toString()).join(' ');
    this.log(`🐰【猎兔牌面揭晓】后面未发的牌是: ${cardsStr}`);
    this.rabbitAvailable = false;
    this.notify();
    return { success: true, rabbitCards: this.rabbitCards.map(c => c.toJSON()) };
  }

  destroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.blindTimerInterval) {
      clearInterval(this.blindTimerInterval);
      this.blindTimerInterval = null;
    }
    this.isPaused = true;
    this.stage = 'IDLE';
  }

  togglePauseGame(hostId) {
    if (this.hostId !== hostId) return { success: false, msg: '只有房主可操作' };
    if (this.isPaused) {
      this.isPaused = false;
      this.log('▶️ 房主开启/恢复了牌局！');
      const active = this.getActiveSeats();
      if (active.length === 1) {
        const emptySeatIdx = this.seats.findIndex(s => s === null);
        if (emptySeatIdx !== -1) {
          const botIdx = Math.floor(Math.random() * BOT_NAMES.length);
          this.sitDown(emptySeatIdx, { id: `bot_${Date.now()}`, name: BOT_NAMES[botIdx] || '高手AI', isBot: true, chips: 1000 });
          this.log(`🤖 系统已自动安排 1 名 AI 陪练 [${BOT_NAMES[botIdx] || '高手AI'}] 入座，立即发牌！`);
        }
      }
      this.notify();
      this.checkAutoStart();
    } else {
      this.isPaused = true;
      this.log('⏸️ 房主暂停了牌局');
      this.notify();
    }
    return { success: true, isPaused: this.isPaused };
  }

  endGameSession(hostId) {
    if (this.hostId !== hostId) return { success: false, msg: '只有房主可操作' };
    this.isGameEnded = true;
    this.endTime = new Date();
    this.stage = 'GAME_OVER';
    clearInterval(this.timerInterval);
    if (this.autoDealTimer) clearTimeout(this.autoDealTimer);
    if (this.blindTimerInterval) clearInterval(this.blindTimerInterval);

    const playerList = Object.values(this.playerStatsMap).map(p => {
      const liveSeat = this.seats.find(s => s && s.id === p.id);
      const currentChips = liveSeat ? liveSeat.chips : (p.chips || 0);
      const netProfit = currentChips - p.totalBuyIn;
      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${p.name}`,
        totalBuyIn: p.totalBuyIn,
        finalChips: currentChips,
        netProfit: netProfit,
        played: p.played,
        wins: p.wins,
        winRate: p.played > 0 ? ((p.wins / p.played) * 100).toFixed(1) + '%' : '0.0%'
      };
    }).sort((a, b) => b.netProfit - a.netProfit);

    let mvpPlayer = playerList[0] || null;
    let bossPlayer = [...playerList].sort((a, b) => a.netProfit - b.netProfit)[0] || null;
    let hardWorkerPlayer = [...playerList].sort((a, b) => b.played - a.played)[0] || null;

    const durationMs = this.endTime - this.startTime;
    const durationHours = Math.floor(durationMs / 3600000);
    const durationMinutes = Math.floor((durationMs % 3600000) / 60000);
    const durationStr = durationHours > 0 ? `${durationHours}h ${durationMinutes}m` : `${durationMinutes}m`;

    const summaryReport = {
      roomName: this.name,
      hostName: this.hostName,
      blindInfo: `${this.smallBlind}/${this.bigBlind}(0)`,
      handCount: this.handCount,
      startTimeStr: this.startTime.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      endTimeStr: this.endTime.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      durationStr: durationStr,
      mvp: mvpPlayer,
      boss: bossPlayer,
      hardWorker: hardWorkerPlayer,
      players: playerList
    };

    this.log(`🏁 房主已正式解散/结束整场比赛，生成高保真比赛详情报表！`);
    this.notify();
    return { success: true, summary: summaryReport };
  }

  getActiveSeats() {
    return this.seats.map((p, i) => ({ p, i })).filter(item => item.p !== null && item.p.chips > 0 && !item.p.sittingOut);
  }
  getInHandSeats() {
    return this.seats.map((p, i) => ({ p, i })).filter(item => item.p !== null && !item.p.folded && item.p.holeCards.length > 0);
  }

  checkAutoStart() {
    if (this.stage !== 'IDLE' || this.isPaused || this.isGameEnded) return;
    const active = this.getActiveSeats();
    if (active.length >= 2) {
      if (this.autoDealTimer) clearTimeout(this.autoDealTimer);
      this.log('牌桌满足开局条件，立即自动发牌...');
      this.notify();

      this.autoDealTimer = setTimeout(() => {
        if (this.stage === 'IDLE' && !this.isPaused && !this.isGameEnded && this.getActiveSeats().length >= 2) {
          this.startNewHand();
        }
      }, 800);
    }
  }

  startNewHand() {
    clearInterval(this.timerInterval);
    if (this.autoDealTimer) clearTimeout(this.autoDealTimer);
    if (this.isPaused || this.isGameEnded) return false;

    // 清理勾选了“提前离开”的玩家
    for (let i = 0; i < this.maxSeats; i++) {
      if (this.seats[i] && this.seats[i].leaveNextHand) {
        this.standUp(this.seats[i].id);
      }
    }

    const active = this.getActiveSeats();
    if (active.length < 2) {
      this.stage = 'IDLE';
      this.log('等待至少 2 名就座玩家...');
      this.notify();
      return false;
    }

    this.handCount++;
    this.stage = 'PREFLOP';
    this.communityCards = [];
    this.handWinners = [];
    this.bounty27Winners = [];
    this.rabbitCards = [];
    this.rabbitAvailable = false;
    this.lastSurvivorWinnerId = null;
    this.pot = 0;
    this.deck.reset();
    this.deck.shuffle();
    this.handActionMap = {};

    this.seats.forEach(p => {
      if (p) {
        p.holeCards = [];
        p.currentRoundBet = 0;
        p.totalBet = 0;
        p.folded = p.chips <= 0 || p.sittingOut;
        p.allIn = false;
        p.hasActed = false;
        p.lastAction = null;
        p.revealedCards = [false, false];
        p.showCardIntent = [false, false];
        p.is27Hand = false;
        if (!p.folded && this.playerStatsMap[p.id]) this.playerStatsMap[p.id].played++;
      }
    });

    this.rotateDealer();
    this.postBlinds();

    for (let r = 0; r < 2; r++) {
      for (const item of this.getActiveSeats()) {
        if (!item.p.folded) item.p.holeCards.push(this.deck.deal(1)[0]);
      }
    }

    this.seats.forEach(p => {
      if (p && p.holeCards.length === 2) {
        const ranks = [p.holeCards[0].rank, p.holeCards[1].rank].sort((a, b) => a - b);
        if (ranks[0] === 2 && ranks[1] === 7) p.is27Hand = true;
      }
    });

    this.log(`--- 第 ${this.handCount} 手牌开始 [盲注 ${this.smallBlind}/${this.bigBlind}] ---`);
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
      while (!this.seats[next] || this.seats[next].chips <= 0 || this.seats[next].sittingOut) {
        next = (next + 1) % this.maxSeats;
      }
      this.dealerSeat = next;
    }
  }

  getNextSeat(from) {
    let n = (from + 1) % this.maxSeats;
    while (!this.seats[n] || this.seats[n].folded || this.seats[n].chips <= 0 || this.seats[n].sittingOut) {
      n = (n + 1) % this.maxSeats;
    }
    return n;
  }

  recordPlayerStageAction(playerId, stage, code, label, amount) {
    if (!this.handActionMap) this.handActionMap = {};
    if (!this.handActionMap[playerId]) {
      this.handActionMap[playerId] = { preflop: [], flop: [], turn: [], river: [] };
    }
    const stageKey = (stage || 'preflop').toLowerCase();
    if (this.handActionMap[playerId][stageKey]) {
      this.handActionMap[playerId][stageKey].push({ code, label, amount: amount || 0 });
    }
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
    this.recordPlayerStageAction(sb.id, 'preflop', 'SB', `小盲 ${sbAmt}`, sbAmt);

    const bbAmt = Math.min(this.bigBlind, bb.chips);
    bb.chips -= bbAmt; bb.currentRoundBet = bbAmt; bb.totalBet = bbAmt;
    if (bb.chips === 0) bb.allIn = true;
    bb.lastAction = `大盲 ${bbAmt}`;
    this.recordPlayerStageAction(bb.id, 'preflop', 'BB', `大盲 ${bbAmt}`, bbAmt);

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
    this.actionTimeRemaining = 15; // 15秒行动时间
    this.isUsingTimeBank = false;

    this.timerInterval = setInterval(() => {
      if (this.isPaused) return;

      if (this.actionTimeRemaining > 0) {
        this.actionTimeRemaining--;
        this.notify();
      } else {
        clearInterval(this.timerInterval);
        this.handleTimeout();
      }
    }, 1000);
  }

  handleTimeout() {
    if (this.currentActorSeat === -1) return;
    const p = this.seats[this.currentActorSeat];
    if (!p) return;

    p.timeoutCount = (p.timeoutCount || 0) + 1;
    this.log(`⏳ 玩家 [${p.name}] 行动超时，系统自动处理并转为暂离`);

    // 自动操作：可过牌则过牌，否则自动弃牌
    if (p.currentRoundBet === this.currentBet) {
      this.playerAction(p.id, 'check');
    } else {
      this.playerAction(p.id, 'fold');
    }

    // 自动置为暂离状态，避免下局继续卡桌
    p.sittingOut = true;

    // 如果连续超时 2 次或玩家已离线，自动站起离座释放座位
    if (p.timeoutCount >= 2 || p.isOnline === false) {
      this.log(`🚪 玩家 [${p.name}] 连续无操作/离线，系统自动将其请离座位`);
      this.standUp(p.id);
    }
  }

  playerAction(playerId, act, amount = 0) {
    if (this.currentActorSeat === -1) return { success: false, msg: '当前不可行动' };
    const p = this.seats[this.currentActorSeat];
    if (!p) return { success: false, msg: '当前行动者不存在' };

    if (p.id !== playerId && !p.isBot) {
      return { success: false, msg: `当前正在等待 [${p.name}] 行动` };
    }

    const toCall = Math.max(0, this.currentBet - p.currentRoundBet);

    if (act === 'fold') {
      p.folded = true;
      p.lastAction = '弃牌';
      this.recordPlayerStageAction(p.id, this.stage, 'F', '弃牌', 0);
      this.log(`玩家 [${p.name}] 弃牌`);
    } else if (act === 'check') {
      if (toCall > 0) return this.playerAction(playerId, 'fold');
      p.lastAction = '过牌';
      this.recordPlayerStageAction(p.id, this.stage, 'X', '过牌', 0);
      this.log(`玩家 [${p.name}] 过牌`);
    } else if (act === 'call') {
      const callAmt = Math.min(toCall, p.chips);
      p.chips -= callAmt; p.currentRoundBet += callAmt; p.totalBet += callAmt;
      this.pot += callAmt;
      if (p.chips === 0) p.allIn = true;
      p.lastAction = p.allIn ? `全下跟注 ${callAmt}` : (toCall === 0 ? '过牌' : `跟注 ${callAmt}`);
      this.recordPlayerStageAction(p.id, this.stage, 'C', `跟注 ${callAmt}`, callAmt);
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
      this.recordPlayerStageAction(p.id, this.stage, act === 'bet' ? 'B' : 'R', `${act === 'bet' ? '下注' : '加注'} ${need}`, need);
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
      p.lastAction = `All-in (${allChips})`;
      this.recordPlayerStageAction(p.id, this.stage, 'A', `全下 ${allChips}`, allChips);
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
      if (p && !p.folded && !p.allIn && !p.sittingOut && (!p.hasActed || p.currentRoundBet < this.currentBet)) {
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
      setTimeout(() => this.nextStage(), 1000);
    } else {
      this.currentActorSeat = this.getNextSeat(this.dealerSeat);
      this.notify();
      this.startTimer();
    }
  }

  settleSurvivor(winner) {
    this.stage = 'END_HAND';
    winner.chips += this.pot;
    this.lastSurvivorWinnerId = winner.id;
    this.handWinners = [{ playerId: winner.id, name: winner.name, totalWon: this.pot, description: '对手全部弃牌' }];

    const remainingNeed = 5 - this.communityCards.length;
    if (remainingNeed > 0) {
      this.rabbitCards = this.deck.deal(remainingNeed);
      this.rabbitAvailable = true;
    }

    if (winner.is27Hand) {
      this.bounty27Winners.push(winner.id);
      this.log(`🔥 玩家 [${winner.name}] 手持 2-7 炸穿全场！可触发 2/7 绝杀炸场特效！`);
    }

    // 自动应用所有玩家预选的单张或双手牌亮牌意图
    this.seats.forEach(p => {
      if (p && p.showCardIntent) {
        if (p.showCardIntent[0]) p.revealedCards[0] = true;
        if (p.showCardIntent[1]) p.revealedCards[1] = true;
      }
    });

    this.recordHandResult();
    this.log(`🏆 玩家 [${winner.name}] 赢得底池 ${this.pot} 记分牌`);
    this.finishHand();
  }

  settleShowdown() {
    this.stage = 'SHOWDOWN';
    const inHand = this.getInHandSeats();

    const evaluated = inHand.map(it => {
      const all = [...it.p.holeCards, ...this.communityCards];
      const b = evaluateHand(all);
      it.p.bestHand = b;
      return { id: it.p.id, name: it.p.name, totalBet: it.p.totalBet, folded: it.p.folded, bestHand: b, is27Hand: it.p.is27Hand, autoMuck: it.p.autoMuck };
    });

    const payouts = PotManager.distributePots(evaluated, this.pot);
    const winningIds = new Set(payouts.map(p => p.playerId));

    this.seats.forEach(p => {
      if (p && inHand.some(h => h.p.id === p.id)) {
        if (winningIds.has(p.id)) {
          p.revealedCards = [true, true];
        } else if (!p.autoMuck) {
          p.revealedCards = [true, true];
        }
      }
    });

    this.handWinners = payouts.map(w => {
      const p = this.seats.find(s => s && s.id === w.playerId);
      if (p) p.chips += w.totalWon;
      const info = evaluated.find(e => e.id === w.playerId);

      if (info && info.is27Hand) {
        this.bounty27Winners.push(w.playerId);
        this.log(`🔥 玩家 [${info.name}] 凭 2-7 获胜！可触发 2/7 绝杀炸场特效！`);
      }

      return { playerId: w.playerId, name: info ? info.name : '未知', totalWon: w.totalWon, description: info ? info.bestHand.description : '' };
    });

    this.recordHandResult();
    this.handWinners.forEach(w => this.log(`🏆 [${w.name}] 赢得 ${w.totalWon} 记分牌 (${w.description})`));
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
        this.playerStatsMap[p.id].profit = p.chips - this.playerStatsMap[p.id].totalBuyIn;
      }
    });

    const flopCards = this.communityCards.slice(0, 3).map(c => c.toJSON());
    const turnCard = this.communityCards[3] ? this.communityCards[3].toJSON() : null;
    const riverCard = this.communityCards[4] ? this.communityCards[4].toJSON() : null;

    const handPlayers = this.seats.map((p, idx) => {
      if (!p || (!p.holeCards || p.holeCards.length === 0)) return null;
      const isWin = this.handWinners.some(w => w.playerId === p.id);
      const wonAmt = isWin ? (this.handWinners.find(w => w.playerId === p.id)?.totalWon || 0) : 0;
      const net = wonAmt - p.totalBet;
      let posLabel = 'EP';
      if (idx === this.dealerSeat) posLabel = 'D';
      else if (idx === this.smallBlindSeat) posLabel = 'SB';
      else if (idx === this.bigBlindSeat) posLabel = 'BB';

      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        position: posLabel,
        holeCards: p.holeCards.map(c => c.toJSON()),
        revealedCards: p.revealedCards || [false, false],
        folded: p.folded,
        totalBet: p.totalBet,
        netProfit: net,
        handDesc: getHandDescription(p.holeCards, this.communityCards),
        actions: (this.handActionMap && this.handActionMap[p.id]) ? this.handActionMap[p.id] : { preflop: [], flop: [], turn: [], river: [] }
      };
    }).filter(Boolean);

    this.handHistoryList.unshift({
      handNumber: this.handCount,
      pot: this.pot,
      flopCards,
      turnCard,
      riverCard,
      communityCards: this.communityCards.map(c => c.toJSON()),
      winners: this.handWinners,
      players: handPlayers,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  }

  finishHand() {
    clearInterval(this.timerInterval);
    this.notify();

    // 检查比赛时长是否已到期
    if (this.expireTimestamp && Date.now() >= this.expireTimestamp && !this.isGameEnded) {
      this.log(`⏰【比赛时间已到】本场设定的 ${this.durationMinutes} 分钟比赛已全部打完，系统正在自动结算生成战报！`);
      setTimeout(() => this.endGameSession(), 3500);
      return;
    }

    const waitTime = this.stage === 'SHOWDOWN' || (this.handWinners && this.handWinners.some(w => w.description !== '对手全部弃牌')) ? 3200 : 1800;

    setTimeout(() => {
      if (this.isPaused || this.isGameEnded) return;

      if (this.expireTimestamp && Date.now() >= this.expireTimestamp) {
        this.log(`⏰【比赛时间已到】本场设定的 ${this.durationMinutes} 分钟比赛已结束！`);
        this.endGameSession();
        return;
      }

      const active = this.getActiveSeats();
      if (active.length >= 2) {
        this.startNewHand();
      } else {
        this.stage = 'IDLE';
        this.log('等待更多玩家就绪后全自动发牌...');
        this.notify();
      }
    }, waitTime);
  }

  getPublicState(viewerId) {
    const isHost = this.hostId === viewerId;
    const inHand = this.getInHandSeats();
    const allInPlayers = inHand.filter(it => it.p.allIn || inHand.filter(h => !h.p.allIn).length <= 1).map(it => it.p);
    let equities = {};
    if (allInPlayers.length >= 2 && this.stage !== 'IDLE' && this.stage !== 'END_HAND') {
      equities = calculateAllInEquities(allInPlayers, this.communityCards, this.deck.cards);
    }

    return {
      id: this.id,
      hostId: this.hostId,
      hostName: this.hostName,
      name: this.name,
      gameMode: this.gameMode,
      durationMinutes: this.durationMinutes,
      remainingDurationSeconds: this.expireTimestamp ? Math.max(0, Math.floor((this.expireTimestamp - Date.now()) / 1000)) : -1,
      isHost: isHost,
      isPaused: this.isPaused,
      isGameEnded: this.isGameEnded,
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
      isUsingTimeBank: this.isUsingTimeBank,
      rabbitAvailable: this.rabbitAvailable,
      handWinners: this.handWinners,
      bounty27Eligible: this.bounty27Winners.includes(viewerId),
      handCount: this.handCount,
      communityCards: this.communityCards.map(c => c.toJSON()),
      seats: this.seats.map((p, idx) => {
        if (!p) return null;
        const isSelf = p.id === viewerId;
        const inHand = this.getInHandSeats();
        const noMoreAction = inHand.length >= 2 && inHand.filter(it => !it.p.allIn).length <= 1;
        const isShowdown = this.stage === 'SHOWDOWN';
        const isAllInRunout = (this.stage === 'FLOP' || this.stage === 'TURN' || this.stage === 'RIVER') && noMoreAction && inHand.some(it => it.p.id === p.id);
        const isShowdownWinner = isShowdown && this.handWinners && this.handWinners.some(w => w.playerId === p.id);
        const isPlayerRevealedLeft = p.revealedCards && p.revealedCards[0];
        const isPlayerRevealedRight = p.revealedCards && p.revealedCards[1];

        // 仅在属于本人、主动秀牌、最终比牌获胜、或全下跑马时才公开；对手全弃牌获胜默认不秀牌保密
        const canRevealLeft = isSelf || isPlayerRevealedLeft || isShowdownWinner || isAllInRunout || (isShowdown && !p.autoMuck && !p.folded);
        const canRevealRight = isSelf || isPlayerRevealedRight || isShowdownWinner || isAllInRunout || (isShowdown && !p.autoMuck && !p.folded);

        const realHandDesc = (isSelf || isShowdownWinner || isAllInRunout || (isShowdown && !p.autoMuck))
          ? getHandDescription(p.holeCards, this.communityCards)
          : '';

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
          sittingOut: p.sittingOut,
          isOnline: p.isOnline !== false,
          equity: (isAllInRunout || isShowdown) ? (equities[p.id] || null) : (isSelf ? (equities[p.id] || null) : null),
          leaveNextHand: p.leaveNextHand,
          timeBank: p.timeBank,
          autoMuck: p.autoMuck,
          lastAction: p.lastAction,
          handDescription: realHandDesc,
          is27: isSelf ? p.is27Hand : false,
          revealedCards: p.revealedCards,
          showCardIntent: isSelf ? (p.showCardIntent || [false, false]) : undefined,
          holeCards: [
            p.holeCards[0] ? (canRevealLeft ? p.holeCards[0].toJSON() : { isHidden: true }) : null,
            p.holeCards[1] ? (canRevealRight ? p.holeCards[1].toJSON() : { isHidden: true }) : null
          ].filter(Boolean)
        };
      }),
      handHistory: this.handHistoryList,
      playerStats: Object.values(this.playerStatsMap).map(p => {
        const liveSeat = this.seats.find(s => s && s.id === p.id);
        const currentChips = liveSeat ? liveSeat.chips : (p.chips || 0);
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          chips: currentChips,
          totalBuyIn: p.totalBuyIn,
          netProfit: currentChips - p.totalBuyIn,
          played: p.played,
          wins: p.wins
        };
      }).sort((a, b) => b.netProfit - a.netProfit)
    };
  }
}

// ================= Socket.io 房间管理与本地磁盘持久化系统 =================
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'active_rooms.json');

if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

const rooms = new Map();

let saveDiskTimer = null;
function saveRoomsToDisk() {
  if (saveDiskTimer) return;
  saveDiskTimer = setTimeout(() => {
    saveDiskTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const data = {};
      for (const [roomId, room] of rooms.entries()) {
        if (room && room.table && !room.table.isGameEnded) {
          data[roomId] = {
            id: room.table.id,
            hostId: room.hostId,
            hostName: room.table.hostName,
            name: room.table.name,
            gameMode: room.table.gameMode,
            smallBlind: room.table.smallBlind,
            bigBlind: room.table.bigBlind,
            defaultBuyIn: room.table.defaultBuyIn,
            durationMinutes: room.table.durationMinutes,
            expireTimestamp: room.table.expireTimestamp,
            handCount: room.table.handCount,
            playerStatsMap: room.table.playerStatsMap,
            handHistoryList: room.table.handHistoryList,
            seats: room.table.seats.map(s => s ? {
              id: s.id,
              name: s.name,
              avatar: s.avatar,
              chips: s.chips,
              isBot: s.isBot,
              sittingOut: true
            } : null)
          };
        }
      }
      fs.writeFile(STORE_FILE, JSON.stringify(data), 'utf8', () => {});
    } catch (e) {}
  }, 2000);
}

function restoreRoomsFromDisk() {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const roomId in data) {
      const r = data[roomId];
      if (!r.expireTimestamp || Date.now() < r.expireTimestamp) {
        const table = new PokerTable({
          id: r.id,
          hostId: r.hostId,
          hostName: r.hostName,
          name: r.name,
          gameMode: r.gameMode,
          smallBlind: r.smallBlind,
          bigBlind: r.bigBlind,
          defaultBuyIn: r.defaultBuyIn,
          durationMinutes: r.durationMinutes
        });
        table.expireTimestamp = r.expireTimestamp;
        table.handCount = r.handCount || 0;
        table.playerStatsMap = r.playerStatsMap || {};
        table.handHistoryList = r.handHistoryList || [];

        if (r.seats && Array.isArray(r.seats)) {
          r.seats.forEach((s, idx) => {
            if (s) {
              table.sitDown(idx, s);
              if (table.seats[idx]) {
                table.seats[idx].chips = s.chips;
                table.seats[idx].sittingOut = true;
                table.seats[idx].isOnline = false;
              }
            }
          });
        }

        table.onStateChange = () => {
          broadcastTable(roomId);
          checkBotTurn(roomId);
          saveRoomsToDisk();
        };
        table.onLog = msg => io.to(roomId).emit('game_log', { message: msg });

        rooms.set(roomId, { table, hostId: r.hostId });
        console.log(`[Storage] Successfully restored room [${roomId}] (${r.name}) from disk!`);
      }
    }
  } catch (e) {}
}

restoreRoomsFromDisk();

function generate4DigitRoomId() {
  let code = '';
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

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
  if (table.stage === 'IDLE' || table.stage === 'END_HAND' || table.isPaused) return;
  const actor = table.seats[table.currentActorSeat];
  if (actor && actor.isBot) {
    setTimeout(() => {
      if (table.seats[table.currentActorSeat] && table.seats[table.currentActorSeat].id === actor.id) {
        const dec = PokerBot.decide(table, actor);
        table.playerAction(actor.id, dec.action, dec.amount);
      }
    }, 500 + Math.random() * 400);
  }
}

io.on('connection', socket => {
  let currentRoomId = null;
  let currentPlayerId = null;

  socket.on('create_room', (options, callback) => {
    const roomId = (options.preferredRoomId && !rooms.has(options.preferredRoomId.toString().trim())) 
      ? options.preferredRoomId.toString().trim() 
      : generate4DigitRoomId();

    const table = new PokerTable({
      id: roomId,
      hostId: options.playerId,
      hostName: options.hostName || '房主',
      name: options.name || 'poker',
      gameMode: options.gameMode || 'CASH',
      smallBlind: options.smallBlind || 5,
      bigBlind: options.bigBlind || 10,
      defaultBuyIn: options.defaultBuyIn || 1000,
      durationMinutes: options.durationMinutes || 0
    });

    table.onStateChange = () => {
      broadcastTable(roomId);
      checkBotTurn(roomId);
      saveRoomsToDisk();
    };
    table.onLog = msg => io.to(roomId).emit('game_log', { message: msg });

    if (options.gameMode === 'PVE') {
      table.sitDown(8, { id: options.playerId, name: options.hostName || '菠萝无敌', chips: 1000 });
      for (let i = 0; i < 8; i++) {
        table.sitDown(i, { id: `bot_${i}`, name: BOT_NAMES[i], isBot: true, chips: 1000 });
      }
    }

    rooms.set(roomId, { table, hostId: options.playerId });
    saveRoomsToDisk();
    socket.join(roomId);
    currentRoomId = roomId;
    currentPlayerId = options.playerId;
    socket.data.playerId = options.playerId;

    callback({ success: true, roomId, roomName: table.name, gameMode: table.gameMode });
    broadcastTable(roomId);
  });

  socket.on('join_room', ({ roomId, player, autoCreateIfNotExist }, callback) => {
    const cleanRoomId = roomId.toString().trim();
    let room = rooms.get(cleanRoomId);

    if (!room && autoCreateIfNotExist) {
      // 智能无感自动拉起该私人房间
      const table = new PokerTable({
        id: cleanRoomId,
        hostId: player.id,
        hostName: player.name || '房主',
        name: 'poker',
        gameMode: 'CASH',
        smallBlind: 10,
        bigBlind: 20,
        defaultBuyIn: 1000,
        durationMinutes: 1440 // 默认 24 小时全天场
      });
      table.onStateChange = () => {
        broadcastTable(cleanRoomId);
        checkBotTurn(cleanRoomId);
        saveRoomsToDisk();
      };
      table.onLog = msg => io.to(cleanRoomId).emit('game_log', { message: msg });
      rooms.set(cleanRoomId, { table, hostId: player.id });
      saveRoomsToDisk();
      room = rooms.get(cleanRoomId);
    }

    if (!room) return callback({ success: false, msg: '4 位数字房间号不存在' });

    currentRoomId = cleanRoomId;
    currentPlayerId = player.id;
    socket.data.playerId = player.id;
    socket.join(currentRoomId);

    const existingSeat = room.table.seats.find(s => s && s.id === player.id);
    if (existingSeat) {
      existingSeat.name = player.name || existingSeat.name;
      existingSeat.isOnline = true;
      existingSeat.sittingOut = false; // 重新连接回来自动取消暂离
      existingSeat.timeoutCount = 0;
      room.table.log(`👋 玩家 [${existingSeat.name}] 重新连接回到座位！`);
    }

    callback({ success: true, roomId: currentRoomId, tableState: room.table.getPublicState(player.id) });
    broadcastTable(currentRoomId);
  });

  socket.on('sit_down', ({ seatIndex, player }, callback) => {
    if (!currentRoomId) return callback({ success: false, msg: '未加入房间' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ success: false, msg: '房间不存在' });
    
    currentPlayerId = player.id;
    socket.data.playerId = player.id;

    const res = room.table.sitDown(seatIndex, player);
    callback(res);
    broadcastTable(currentRoomId);
    checkBotTurn(currentRoomId);
  });

  // 补充/带入记分牌接口
  socket.on('buy_in_chips', ({ amount }, callback) => {
    if (!currentRoomId || !currentPlayerId) return callback({ success: false, msg: '未加入房间' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ success: false, msg: '房间不存在' });
    
    const res = room.table.addChips(currentPlayerId, amount);
    callback(res);
    broadcastTable(currentRoomId);
  });

  socket.on('toggle_leave_next_hand', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.toggleLeaveNextHand(currentPlayerId));
  });

  socket.on('stand_up', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      callback({ success: room.table.standUp(currentPlayerId) });
      broadcastTable(currentRoomId);
    }
  });

  socket.on('toggle_sit_out', ({ sittingOut }, callback) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.toggleSitOut(currentPlayerId, sittingOut));
  });

  socket.on('show_cards', ({ which }, callback) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.showCards(currentPlayerId, which));
  });

  socket.on('request_extra_time', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.requestExtraTime(currentPlayerId));
  });

  socket.on('hunt_rabbit', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.huntRabbit(currentPlayerId));
  });

  socket.on('toggle_pause', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) callback(room.table.togglePauseGame(currentPlayerId));
  });

  socket.on('end_game_session', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      const res = room.table.endGameSession(currentPlayerId);
      if (res.success) {
        io.to(currentRoomId).emit('broadcast_game_summary', { summary: res.summary });
        io.to(currentRoomId).emit('room_dissolved', { roomId: currentRoomId, summary: res.summary });
        rooms.delete(currentRoomId);
        saveRoomsToDisk();
      }
      callback(res);
    }
  });

  socket.on('filter_active_rooms', ({ roomIds }, callback) => {
    if (!Array.isArray(roomIds)) return callback({ activeIds: [] });
    const activeIds = roomIds.filter(id => {
      const r = rooms.get(id.toString().trim());
      return r && r.table && !r.table.isGameEnded && (!r.table.expireTimestamp || Date.now() < r.table.expireTimestamp);
    });
    callback({ activeIds });
  });

  socket.on('add_ai_bot', callback => {
    if (!currentRoomId || !currentPlayerId) return callback({ success: false, msg: '未在房间内' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ success: false, msg: '房间不存在' });
    const emptyIdx = room.table.seats.findIndex(s => s === null);
    if (emptyIdx === -1) return callback({ success: false, msg: '牌桌席位已满' });
    const botIdx = Math.floor(Math.random() * BOT_NAMES.length);
    const res = room.table.sitDown(emptyIdx, {
      id: `bot_${Date.now()}_${Math.floor(Math.random() * 100)}`,
      name: BOT_NAMES[botIdx] || '陪练AI',
      isBot: true,
      chips: 1000
    });
    callback(res);
    broadcastTable(currentRoomId);
    checkBotTurn(currentRoomId);
  });

  socket.on('toggle_show_card_intent', ({ cardIndex, isSelected }, callback) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const res = room.table.toggleShowCardIntent(currentPlayerId, cardIndex, isSelected);
    if (callback) callback(res);
  });

  socket.on('trigger_27_effect', callback => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const winner = room.table.seats.find(s => s && s.id === currentPlayerId);
    if (winner) {
      io.to(currentRoomId).emit('broadcast_27_effect', { winnerName: winner.name });
      callback({ success: true });
    }
  });

  socket.on('send_danmaku', ({ text, senderName }) => {
    if (!currentRoomId) return;
    io.to(currentRoomId).emit('new_danmaku', {
      id: Date.now() + Math.random(),
      text,
      sender: senderName || '玩家',
      color: ['#f59e0b', '#38bdf8', '#34d399', '#f43f5e', '#a855f7'][Math.floor(Math.random() * 5)]
    });
  });

  socket.on('update_name', ({ name }, callback) => {
    if (!currentRoomId || !currentPlayerId) {
      if (callback) callback({ success: false, msg: '未在房间中' });
      return;
    }
    const room = rooms.get(currentRoomId);
    if (!room) {
      if (callback) callback({ success: false, msg: '房间不存在' });
      return;
    }
    const res = room.table.updatePlayerName(currentPlayerId, name);
    if (callback) callback(res);
  });

  socket.on('show_cards', ({ which }, callback) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const res = room.table.showCards(currentPlayerId, which || 'both');
    if (callback) callback(res);
  });

  // 处理玩家下注行动
  socket.on('player_action', ({ action, amount }, callback) => {
    if (!currentRoomId || !currentPlayerId) {
      if (callback) callback({ success: false, msg: '未加入房间' });
      return;
    }
    const room = rooms.get(currentRoomId);
    if (!room) {
      if (callback) callback({ success: false, msg: '房间不存在' });
      return;
    }

    const res = room.table.playerAction(currentPlayerId, action, amount);
    if (callback) callback(res);
    checkBotTurn(currentRoomId);
  });

  socket.on('send_interactive_prop', ({ fromSeat, toSeat, propType }, callback) => {
    if (!currentRoomId) return;
    io.to(currentRoomId).emit('play_interactive_prop', {
      fromSeat,
      toSeat,
      propType,
      senderId: currentPlayerId
    });
    if (callback) callback({ success: true });
  });

  socket.on('disconnect', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const { table } = room;
    const seatIdx = table.seats.findIndex(s => s && s.id === currentPlayerId);
    if (seatIdx === -1) return;

    const p = table.seats[seatIdx];
    p.isOnline = false;
    p.sittingOut = true;
    table.log(`🔌 玩家 [${p.name}] 离线/离开网页，已自动设为暂离`);

    // 如果当前正轮到该玩家行动，立即自动替其弃牌推进牌局！
    if (table.currentActorSeat === seatIdx && table.stage !== 'IDLE' && table.stage !== 'END_HAND') {
      table.log(`⚡ 离线玩家 [${p.name}] 正在行动中，系统立即替其自动弃牌并推进牌局`);
      table.playerAction(p.id, 'fold');
    } else {
      table.notify();
    }

    // 检查桌上真人玩家状态：如果所有真人都离线，立即自动暂停挂起对局，停止消耗CPU
    const realPlayers = table.seats.filter(s => s && !s.isBot);
    const onlineRealPlayers = realPlayers.filter(s => s.isOnline);
    if (onlineRealPlayers.length === 0) {
      table.isPaused = true;
      if (table.timerInterval) {
        clearInterval(table.timerInterval);
        table.timerInterval = null;
      }
      table.log('⏸️ 所有玩家均已离开，牌局已自动挂起暂停');
      table.notify();
    }

    // 延迟 45 秒：如果玩家 45 秒内未重连回来，将其标记为暂离保位，座位与筹码完整保留！
    setTimeout(() => {
      const currentRoom = rooms.get(currentRoomId);
      if (currentRoom) {
        const liveP = currentRoom.table.seats[seatIdx];
        if (liveP && liveP.id === currentPlayerId && liveP.isOnline === false) {
          currentRoom.table.log(`💤 玩家 [${liveP.name}] 处于离线暂离保位状态（房间在有效时间内持续保活，随时可回桌继续）`);
          currentRoom.table.notify();
        }
      }
    }, 45000);
  });

  socket.on('get_stats', callback => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const list = Object.values(room.table.playerStatsMap).map(p => {
      const liveSeat = room.table.seats.find(s => s && s.id === p.id);
      const currentChips = liveSeat ? liveSeat.chips : (p.chips || 0);
      const netProfit = currentChips - p.totalBuyIn;
      return {
        ...p,
        chips: currentChips,
        netProfit: netProfit,
        winRate: p.played > 0 ? ((p.wins / p.played) * 100).toFixed(1) + '%' : '0.0%'
      };
    }).sort((a, b) => b.netProfit - a.netProfit);

    callback({
      handCount: room.table.handCount,
      roomName: room.table.name,
      leaderboard: list,
      recentHands: room.table.handHistoryList
    });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Texas Hold'em Server running on port ${PORT}`);
});
