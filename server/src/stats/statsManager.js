/**
 * 德州扑克战绩与手牌历史统计管理器
 */
export class StatsManager {
  constructor() {
    this.playerStats = new Map(); // playerId -> stats object
    this.handHistories = []; // 最近手牌对局回顾列表 (保留最近 50 局)
  }

  getOrCreatePlayer(playerId, name) {
    if (!this.playerStats.has(playerId)) {
      this.playerStats.set(playerId, {
        id: playerId,
        name: name,
        handsPlayed: 0,
        handsWon: 0,
        totalBuyIn: 0,
        currentChips: 0,
        netProfit: 0,
        maxPotWon: 0,
        bestHandName: '无',
        vpipCount: 0 // 主动入池次数
      });
    }
    const p = this.playerStats.get(playerId);
    p.name = name; // 更新最新昵称
    return p;
  }

  /**
   * 记录一局完成后的数据结算
   */
  recordHandEnd(table) {
    const handRecord = {
      handNumber: table.handCount,
      timestamp: Date.now(),
      gameMode: table.gameMode,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      pot: table.pot,
      communityCards: table.communityCards.map(c => c.toString()),
      winners: table.handWinners,
      players: []
    };

    // 记录在座玩家
    for (const seat of table.seats) {
      if (!seat) continue;
      const stats = this.getOrCreatePlayer(seat.id, seat.name);
      stats.handsPlayed += 1;

      const isWinner = table.handWinners.some(w => w.playerId === seat.id);
      if (isWinner) {
        stats.handsWon += 1;
      }

      if (seat.totalBet > table.bigBlind) {
        stats.vpipCount += 1;
      }

      const winnerInfo = table.handWinners.find(w => w.playerId === seat.id);
      if (winnerInfo && winnerInfo.totalWon > stats.maxPotWon) {
        stats.maxPotWon = winnerInfo.totalWon;
      }

      if (seat.bestHand) {
        stats.bestHandName = seat.bestHand.description;
      }

      // 计算净盈亏 (筹码增减)
      const wonAmount = winnerInfo ? winnerInfo.totalWon : 0;
      const netChange = wonAmount - seat.totalBet;
      stats.netProfit += netChange;
      stats.currentChips = seat.chips;

      handRecord.players.push({
        id: seat.id,
        name: seat.name,
        holeCards: seat.holeCards.map(c => c.toString()),
        totalBet: seat.totalBet,
        wonAmount: wonAmount,
        folded: seat.folded,
        handDescription: seat.bestHand ? seat.bestHand.description : ''
      });
    }

    this.handHistories.unshift(handRecord);
    if (this.handHistories.length > 50) {
      this.handHistories.pop();
    }
  }

  /**
   * 获取排行榜与所有玩家战绩
   */
  getLeaderboard() {
    const list = Array.from(this.playerStats.values()).map(p => {
      const winRate = p.handsPlayed > 0 ? ((p.handsWon / p.handsPlayed) * 100).toFixed(1) + '%' : '0.0%';
      const vpip = p.handsPlayed > 0 ? ((p.vpipCount / p.handsPlayed) * 100).toFixed(1) + '%' : '0.0%';
      return {
        ...p,
        winRate,
        vpip
      };
    });

    // 按净盈利降序排序
    return list.sort((a, b) => b.netProfit - a.netProfit);
  }

  /**
   * 获取最近对局回顾
   */
  getRecentHands(limit = 10) {
    return this.handHistories.slice(0, limit);
  }
}
