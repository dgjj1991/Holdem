import { compareScores } from './evaluator.js';

/**
 * 边池管理与筹码分配计算器
 */
export class PotManager {
  /**
   * 根据所有玩家在当局总投入的筹码计算主池和所有边池
   * @param {Array<{ id: string, totalBet: number, folded: boolean, allIn: boolean }>} playerContributions
   * @returns {Array<{ amount: number, eligiblePlayerIds: string[] }>}
   */
  static calculatePots(playerContributions) {
    const pots = [];
    // 过滤出有投入筹码的记录
    const contributors = playerContributions
      .filter(p => p.totalBet > 0)
      .map(p => ({ ...p }));

    if (contributors.length === 0) return [];

    let processedBet = 0;

    // 提取所有不同的非零投入金额并升序排序
    const betLevels = Array.from(
      new Set(contributors.map(p => p.totalBet))
    ).sort((a, b) => a - b);

    for (const level of betLevels) {
      if (level <= processedBet) continue;

      const increment = level - processedBet;
      let potAmount = 0;
      const eligiblePlayerIds = [];

      for (const p of contributors) {
        if (p.totalBet >= level) {
          potAmount += increment;
          if (!p.folded) {
            eligiblePlayerIds.push(p.id);
          }
        }
      }

      if (potAmount > 0 && eligiblePlayerIds.length > 0) {
        pots.push({
          amount: potAmount,
          eligiblePlayerIds
        });
      }

      processedBet = level;
    }

    return pots;
  }

  /**
   * 结算所有底池与边池，返回每个玩家最终获得的筹码分配
   * @param {Array<{ id: string, totalBet: number, folded: boolean, bestHand: Object }>} players
   * @returns {Array<{ playerId: string, amount: number, handDescription: string, potType: string }>}
   */
  static distributePots(players) {
    const pots = this.calculatePots(players);
    const payouts = [];

    const activePlayersMap = new Map();
    for (const p of players) {
      activePlayersMap.set(p.id, p);
    }

    // 依次结算每个底池
    for (let i = 0; i < pots.length; i++) {
      const pot = pots[i];
      const eligible = pot.eligiblePlayerIds
        .map(id => activePlayersMap.get(id))
        .filter(Boolean);

      if (eligible.length === 0) continue;

      if (eligible.length === 1) {
        // 只有一人合资格（其他人弃牌），独揽此池
        payouts.push({
          playerId: eligible[0].id,
          amount: pot.amount,
          handDescription: eligible[0].bestHand ? eligible[0].bestHand.description : '对手全部弃牌',
          potIndex: i
        });
        continue;
      }

      // 找出合资格玩家中手牌最大的玩家集合（支持平局）
      let bestRankPlayers = [eligible[0]];

      for (let j = 1; j < eligible.length; j++) {
        const current = eligible[j];
        const leader = bestRankPlayers[0];

        const cmp = compareScores(current.bestHand.score, leader.bestHand.score);
        if (cmp > 0) {
          bestRankPlayers = [current];
        } else if (cmp === 0) {
          bestRankPlayers.push(current);
        }
      }

      // 平分该池筹码
      const share = Math.floor(pot.amount / bestRankPlayers.length);
      let remainder = pot.amount % bestRankPlayers.length;

      for (const winner of bestRankPlayers) {
        let winAmount = share;
        if (remainder > 0) {
          winAmount += 1;
          remainder -= 1;
        }
        payouts.push({
          playerId: winner.id,
          amount: winAmount,
          handDescription: winner.bestHand.description,
          potIndex: i
        });
      }
    }

    // 汇总每位玩家的总赢得筹码
    const summary = {};
    for (const p of payouts) {
      if (!summary[p.playerId]) {
        summary[p.playerId] = {
          playerId: p.playerId,
          totalWon: 0,
          details: []
        };
      }
      summary[p.playerId].totalWon += p.amount;
      summary[p.playerId].details.push(p);
    }

    return Object.values(summary);
  }
}
