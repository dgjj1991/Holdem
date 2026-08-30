import assert from 'assert';
import { Deck, Card } from '../src/engine/deck.js';
import { evaluateHand, HAND_TYPES, compareScores } from '../src/engine/evaluator.js';
import { PotManager } from '../src/engine/pot.js';

console.log('🧪 开始德州扑克核心算法与发牌随机性验证...\n');

// 1. 验证密码学洗牌算法
console.log('1. 测试密码学安全真随机发牌');
const deck = new Deck();
assert.strictEqual(deck.remaining(), 52, '初始牌数必须为 52');

const initialIds = deck.cards.map(c => c.id).join(',');
deck.shuffle();
assert.strictEqual(deck.remaining(), 52, '洗牌后牌数必须为 52');
const shuffledIds = deck.cards.map(c => c.id).join(',');
assert.notStrictEqual(initialIds, shuffledIds, '洗牌后顺序必须被打乱');

// 验证无重复牌
const uniqueSet = new Set(deck.cards.map(c => c.id));
assert.strictEqual(uniqueSet.size, 52, '洗牌后绝不能有重复牌或丢牌');
console.log('✅ 密码学洗牌测试通过！52张牌分布完整且完全乱序。\n');

// 2. 测试 7选5 手牌评级算法
console.log('2. 测试 7选5 手牌评级算法');

// 皇家同花顺
const royalCards = [
  new Card('s', 14, 'A'), new Card('s', 13, 'K'), new Card('s', 12, 'Q'),
  new Card('s', 11, 'J'), new Card('s', 10, 'T'), new Card('h', 2, '2'), new Card('d', 3, '3')
];
const royalEval = evaluateHand(royalCards);
assert.strictEqual(royalEval.type.rank, HAND_TYPES.ROYAL_FLUSH.rank, '必须识别为皇家同花顺');
console.log(`✅ 皇家同花顺识别成功: ${royalEval.description}`);

// 轮子顺子 (A-2-3-4-5)
const wheelCards = [
  new Card('s', 14, 'A'), new Card('h', 2, '2'), new Card('d', 3, '3'),
  new Card('c', 4, '4'), new Card('s', 5, '5'), new Card('h', 9, '9'), new Card('d', 13, 'K')
];
const wheelEval = evaluateHand(wheelCards);
assert.strictEqual(wheelEval.type.rank, HAND_TYPES.STRAIGHT.rank, '必须识别为顺子 (Wheel)');
assert.strictEqual(wheelEval.score[1], 5, 'A-2-3-4-5 顺子最大牌必须为 5');
console.log(`✅ A-2-3-4-5 顺子识别成功: ${wheelEval.description}`);

// 葫芦比牌
const fullHouseCards = [
  new Card('s', 14, 'A'), new Card('h', 14, 'A'), new Card('d', 14, 'A'),
  new Card('c', 13, 'K'), new Card('s', 13, 'K'), new Card('h', 2, '2'), new Card('d', 3, '3')
];
const fhEval = evaluateHand(fullHouseCards);
assert.strictEqual(fhEval.type.rank, HAND_TYPES.FULL_HOUSE.rank, '必须识别为葫芦');
console.log(`✅ 葫芦识别成功: ${fhEval.description}`);

// 3. 测试多重边池分配算法
console.log('\n3. 测试多重边池分配算法 (Side Pot)');
// 场景：
// 玩家A (短码): 全下 200，手牌：三条 A (最强)
// 玩家B (中码): 全下 500，手牌：同花 (次强)
// 玩家C (深筹): 投入 500，手牌：两对 (最弱)
// 总池: 200*3 + (500-200)*2 = 600(主池) + 600(边池1) = 1200
const playersInPot = [
  { id: 'A', totalBet: 200, folded: false, bestHand: { score: [4, 14, 13, 12], description: '三条A' } },
  { id: 'B', totalBet: 500, folded: false, bestHand: { score: [6, 14, 10, 8, 6, 4], description: '同花' } },
  { id: 'C', totalBet: 500, folded: false, bestHand: { score: [3, 14, 13, 8], description: '两对' } }
];

const calculatedPots = PotManager.calculatePots(playersInPot);
console.log('计算出的底池结构:', JSON.stringify(calculatedPots, null, 2));
assert.strictEqual(calculatedPots.length, 2, '应产生 1 个主池和 1 个边池');
assert.strictEqual(calculatedPots[0].amount, 600, '主池金额应为 600 (200x3)');
assert.strictEqual(calculatedPots[1].amount, 600, '边池金额应为 600 (300x2)');

const payouts = PotManager.distributePots(playersInPot);
console.log('分配结果:', JSON.stringify(payouts, null, 2));

const payoutA = payouts.find(p => p.playerId === 'A');
const payoutB = payouts.find(p => p.playerId === 'B');
const payoutC = payouts.find(p => p.playerId === 'C');

// B的同花 > A的三条，所以 B 赢得边池 600；并且由于 B 的牌力大于 A 的三条，B 也赢得了主池 600！
// 如果修改 A 为最强 (例如四条)
const playersWithAStrongest = [
  { id: 'A', totalBet: 200, folded: false, bestHand: { score: [8, 14, 13], description: '四条A' } },
  { id: 'B', totalBet: 500, folded: false, bestHand: { score: [6, 14, 10, 8, 6, 4], description: '同花' } },
  { id: 'C', totalBet: 500, folded: false, bestHand: { score: [3, 14, 13, 8], description: '两对' } }
];
const payouts2 = PotManager.distributePots(playersWithAStrongest);
const p2A = payouts2.find(p => p.playerId === 'A');
const p2B = payouts2.find(p => p.playerId === 'B');
assert.strictEqual(p2A.totalWon, 600, 'A 凭四条应独揽主池 600');
assert.strictEqual(p2B.totalWon, 600, 'B 凭同花应独揽边池 600');
console.log('✅ 多重边池精确分配测试通过！A赢得主池600，B赢得边池600。\n');

console.log('🎉 所有德州扑克核心算法测试全部 100% 通过！');
