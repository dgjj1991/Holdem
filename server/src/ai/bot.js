import { evaluateHand, HAND_TYPES } from '../engine/evaluator.js';

export const BOT_NAMES = [
  '赌圣·周星星', '高进·赌神', '陈刀仔', '老谋深算·沃伦',
  '激进狂徒·杰克', '数学家·冯诺依曼', '锦鲤·小美', '稳健大师·老王',
  '扑克AI·AlphaPoker', '萌新·小小白'
];

export const BOT_PERSONALITIES = {
  TAG: 'tag', // Tight-Aggressive
  LAG: 'lag', // Loose-Aggressive
  PASSIVE: 'passive', // Calling Station
  BALANCED: 'balanced'
};

/**
 * 评估起手牌 (翻牌前) 评分 0 ~ 100
 */
function scoreHoleCards(cards) {
  if (!cards || cards.length < 2) return 20;
  const c1 = cards[0];
  const c2 = cards[1];
  const r1 = Math.max(c1.rank, c2.rank);
  const r2 = Math.min(c1.rank, c2.rank);
  const isPair = r1 === r2;
  const isSuited = c1.suit === c2.suit;
  const isConnected = r1 - r2 === 1;

  if (isPair) {
    if (r1 >= 11) return 95; // JJ, QQ, KK, AA
    if (r1 >= 8) return 80;  // 88, 99, TT
    return 65;               // 小对子
  }

  if (r1 === 14) { // 含 A
    if (r2 >= 12) return isSuited ? 90 : 85; // AK, AQ
    if (r2 >= 10) return isSuited ? 78 : 70; // AJ, AT
    if (isSuited) return 68; // Axs 同花听牌潜力
    return 50;
  }

  if (r1 >= 12 && r2 >= 10) { // KQ, KJ, QJ
    return isSuited ? 75 : 65;
  }

  if (isSuited && isConnected && r1 >= 7) { // 89s, 9Ts, TJs 连张同花
    return 65;
  }

  return 35;
}

export class PokerBot {
  /**
   * AI 作出行动决策
   * @param {Object} table 牌桌实例
   * @param {Object} botPlayer 机器人玩家对象
   * @returns {{ action: string, amount: number }}
   */
  static decide(table, botPlayer) {
    const toCall = table.currentBet - botPlayer.currentRoundBet;
    const canCheck = toCall === 0;
    const chips = botPlayer.chips;
    const personality = botPlayer.botPersonality || 'balanced';

    // 1. 翻牌前决策
    if (table.stage === 'PREFLOP') {
      const handScore = scoreHoleCards(botPlayer.holeCards);

      if (canCheck) {
        if (handScore >= 75 && Math.random() < 0.7) {
          // 加注 3BB
          const targetBet = table.bigBlind * 3;
          return { action: 'raise', amount: targetBet };
        }
        return { action: 'check', amount: 0 };
      }

      // 需要跟注
      const callCostRatio = toCall / chips;

      if (handScore >= 85) {
        // 顶级起手牌：加注或全下
        if (toCall > chips * 0.4 || Math.random() < 0.3) {
          return { action: 'allIn', amount: chips };
        }
        const raiseTarget = Math.max(table.currentBet * 2.5, table.currentBet + table.minRaise);
        return { action: 'raise', amount: raiseTarget };
      } else if (handScore >= 60) {
        if (callCostRatio < 0.25 || personality === 'lag') {
          return { action: 'call', amount: toCall };
        }
        return { action: 'fold', amount: 0 };
      } else {
        if (callCostRatio < 0.05 && (personality === 'passive' || personality === 'lag')) {
          return { action: 'call', amount: toCall };
        }
        return { action: 'fold', amount: 0 };
      }
    }

    // 2. 翻牌后决策 (Flop / Turn / River)
    const allCards = [...botPlayer.holeCards, ...table.communityCards];
    const handEval = evaluateHand(allCards);
    const handRank = handEval.type.rank; // 1 ~ 10

    // 强牌 (三条及以上：3 of a Kind, Straight, Flush, Fullhouse, Quads, Straight Flush)
    if (handRank >= HAND_TYPES.THREE_OF_A_KIND.rank) {
      if (canCheck) {
        // 慢打设陷阱或下注 2/3 底池
        if (Math.random() < 0.35) {
          return { action: 'check', amount: 0 };
        }
        const betAmount = Math.max(Math.floor(table.pot * 0.65), table.minRaise);
        return { action: 'bet', amount: betAmount };
      } else {
        if (toCall >= chips * 0.6 || Math.random() < 0.4) {
          return { action: 'allIn', amount: chips };
        }
        const raiseTarget = Math.max(table.currentBet * 2.2, table.currentBet + table.minRaise);
        return { action: 'raise', amount: raiseTarget };
      }
    }

    // 中等牌 (两对、一对)
    if (handRank >= HAND_TYPES.ONE_PAIR.rank) {
      if (canCheck) {
        if (handRank === HAND_TYPES.TWO_PAIR.rank && Math.random() < 0.6) {
          const betAmount = Math.max(Math.floor(table.pot * 0.5), table.minRaise);
          return { action: 'bet', amount: betAmount };
        }
        return { action: 'check', amount: 0 };
      } else {
        if (toCall <= chips * 0.2 || (personality === 'passive' && toCall <= chips * 0.35)) {
          return { action: 'call', amount: toCall };
        }
        return { action: 'fold', amount: 0 };
      }
    }

    // 弱牌/空气牌 (高牌)
    if (canCheck) {
      // 偶发小额诈唬 (Bluff)
      if (personality === 'lag' && Math.random() < 0.25) {
        const betAmount = Math.max(Math.floor(table.pot * 0.4), table.minRaise);
        return { action: 'bet', amount: betAmount };
      }
      return { action: 'check', amount: 0 };
    }

    // 弱牌面临下注，直接弃牌
    return { action: 'fold', amount: 0 };
  }
}
