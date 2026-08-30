/**
 * 德州扑克 7选5 手牌评级与比牌算法
 * 支持标准 10 种牌型分级与精确踢脚牌 (Kickers) 比对
 */

export const HAND_TYPES = {
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

const RANK_NAMES = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
};

/**
 * 获取数组中所有 5 张牌的组合 (C(n, 5))
 */
function get5CardCombinations(cards) {
  const result = [];
  const n = cards.length;

  function combine(start, chosen) {
    if (chosen.length === 5) {
      result.push([...chosen]);
      return;
    }
    for (let i = start; i < n; i++) {
      chosen.push(cards[i]);
      combine(i + 1, chosen);
      chosen.pop();
    }
  }

  combine(0, []);
  return result;
}

/**
 * 评估恰好 5 张牌的牌力
 * @param {Array} cards 5张 Card 对象
 * @returns {Object} 评级对象
 */
export function evaluate5Cards(cards) {
  // 按点数降序排列
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = sorted.map(c => c.rank);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // 顺子检测（包括 A-2-3-4-5 Wheel 顺子）
  let isStraight = false;
  let straightHigh = 0;

  // 标准顺子 (如 A-K-Q-J-10 到 6-5-4-3-2)
  if (
    ranks[0] - ranks[1] === 1 &&
    ranks[1] - ranks[2] === 1 &&
    ranks[2] - ranks[3] === 1 &&
    ranks[3] - ranks[4] === 1
  ) {
    isStraight = true;
    straightHigh = ranks[0];
  } else if (
    ranks[0] === 14 && // A
    ranks[1] === 5 &&
    ranks[2] === 4 &&
    ranks[3] === 3 &&
    ranks[4] === 2
  ) {
    // 5-4-3-2-A 顺子，最大牌视为 5
    isStraight = true;
    straightHigh = 5;
  }

  // 统计每个点数出现的频次
  const countMap = {};
  for (const r of ranks) {
    countMap[r] = (countMap[r] || 0) + 1;
  }

  // 按频次降序，频次相同时按点数降序排列
  const counts = Object.entries(countMap)
    .map(([rankStr, count]) => ({ rank: parseInt(rankStr, 10), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.rank - a.rank;
    });

  // 1. 皇家同花顺 / 同花顺
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return {
        type: HAND_TYPES.ROYAL_FLUSH,
        score: [HAND_TYPES.ROYAL_FLUSH.rank, 14],
        cards: sorted,
        description: '皇家同花顺 (Royal Flush)'
      };
    }
    return {
      type: HAND_TYPES.STRAIGHT_FLUSH,
      score: [HAND_TYPES.STRAIGHT_FLUSH.rank, straightHigh],
      cards: sorted,
      description: `同花顺 (${RANK_NAMES[straightHigh]}高)`
    };
  }

  // 2. 四条 (Four of a Kind)
  if (counts[0].count === 4) {
    const quadRank = counts[0].rank;
    const kicker = counts[1].rank;
    return {
      type: HAND_TYPES.FOUR_OF_A_KIND,
      score: [HAND_TYPES.FOUR_OF_A_KIND.rank, quadRank, kicker],
      cards: sorted,
      description: `四条 (${RANK_NAMES[quadRank]}带${RANK_NAMES[kicker]})`
    };
  }

  // 3. 葫芦 (Full House)
  if (counts[0].count === 3 && counts[1].count === 2) {
    const tripRank = counts[0].rank;
    const pairRank = counts[1].rank;
    return {
      type: HAND_TYPES.FULL_HOUSE,
      score: [HAND_TYPES.FULL_HOUSE.rank, tripRank, pairRank],
      cards: sorted,
      description: `葫芦 (${RANK_NAMES[tripRank]}带${RANK_NAMES[pairRank]})`
    };
  }

  // 4. 同花 (Flush)
  if (isFlush) {
    return {
      type: HAND_TYPES.FLUSH,
      score: [HAND_TYPES.FLUSH.rank, ...ranks],
      cards: sorted,
      description: `同花 (${RANK_NAMES[ranks[0]]}高)`
    };
  }

  // 5. 顺子 (Straight)
  if (isStraight) {
    return {
      type: HAND_TYPES.STRAIGHT,
      score: [HAND_TYPES.STRAIGHT.rank, straightHigh],
      cards: sorted,
      description: `顺子 (${RANK_NAMES[straightHigh]}高)`
    };
  }

  // 6. 三条 (Three of a Kind)
  if (counts[0].count === 3) {
    const tripRank = counts[0].rank;
    const kickers = [counts[1].rank, counts[2].rank];
    return {
      type: HAND_TYPES.THREE_OF_A_KIND,
      score: [HAND_TYPES.THREE_OF_A_KIND.rank, tripRank, ...kickers],
      cards: sorted,
      description: `三条 (${RANK_NAMES[tripRank]}带${RANK_NAMES[kickers[0]]},${RANK_NAMES[kickers[1]]})`
    };
  }

  // 7. 两对 (Two Pair)
  if (counts[0].count === 2 && counts[1].count === 2) {
    const highPair = Math.max(counts[0].rank, counts[1].rank);
    const lowPair = Math.min(counts[0].rank, counts[1].rank);
    const kicker = counts[2].rank;
    return {
      type: HAND_TYPES.TWO_PAIR,
      score: [HAND_TYPES.TWO_PAIR.rank, highPair, lowPair, kicker],
      cards: sorted,
      description: `两对 (${RANK_NAMES[highPair]}和${RANK_NAMES[lowPair]}带${RANK_NAMES[kicker]})`
    };
  }

  // 8. 一对 (One Pair)
  if (counts[0].count === 2) {
    const pairRank = counts[0].rank;
    const kickers = [counts[1].rank, counts[2].rank, counts[3].rank];
    return {
      type: HAND_TYPES.ONE_PAIR,
      score: [HAND_TYPES.ONE_PAIR.rank, pairRank, ...kickers],
      cards: sorted,
      description: `一对 (${RANK_NAMES[pairRank]}带${RANK_NAMES[kickers[0]]})`
    };
  }

  // 9. 高牌 (High Card)
  return {
    type: HAND_TYPES.HIGH_CARD,
    score: [HAND_TYPES.HIGH_CARD.rank, ...ranks],
    cards: sorted,
    description: `高牌 (${RANK_NAMES[ranks[0]]}高)`
  };
}

/**
 * 比较两副牌评分的大小
 * @param {Array} scoreA
 * @param {Array} scoreB
 * @returns {number} 1 if A > B, -1 if A < B, 0 if A == B
 */
export function compareScores(scoreA, scoreB) {
  const len = Math.max(scoreA.length, scoreB.length);
  for (let i = 0; i < len; i++) {
    const a = scoreA[i] || 0;
    const b = scoreB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * 从 5~7 张牌中计算最佳的 5 张牌牌力
 * @param {Card[]} cards 手牌 + 公共牌
 * @returns {Object} 最佳评级
 */
export function evaluateHand(cards) {
  if (!cards || cards.length < 5) {
    return {
      type: HAND_TYPES.HIGH_CARD,
      score: [0],
      cards: cards || [],
      description: '手牌不足5张'
    };
  }

  const combinations = get5CardCombinations(cards);
  let bestHand = null;

  for (const combo of combinations) {
    const evalResult = evaluate5Cards(combo);
    if (!bestHand || compareScores(evalResult.score, bestHand.score) > 0) {
      bestHand = evalResult;
    }
  }

  return bestHand;
}
