import { Deck } from './deck.js';
import { evaluateHand } from './evaluator.js';
import { PotManager } from './pot.js';

export const TABLE_STAGES = {
  IDLE: 'IDLE',
  PREFLOP: 'PREFLOP',
  FLOP: 'FLOP',
  TURN: 'TURN',
  RIVER: 'RIVER',
  SHOWDOWN: 'SHOWDOWN',
  END_HAND: 'END_HAND'
};

export const GAME_MODES = {
  CASH: 'CASH',
  TOURNAMENT: 'TOURNAMENT'
};

export class PokerTable {
  constructor({
    id,
    name = '德州聚会桌',
    maxSeats = 10,
    gameMode = GAME_MODES.CASH,
    smallBlind = 10,
    bigBlind = 20,
    defaultBuyIn = 1000,
    actionTimeoutSeconds = 15,
    blindIncreaseIntervalMinutes = 3
  } = {}) {
    this.id = id;
    this.name = name;
    this.maxSeats = Math.min(Math.max(maxSeats, 2), 10); // 2~10 人
    this.gameMode = gameMode;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.defaultBuyIn = defaultBuyIn;
    this.actionTimeoutSeconds = actionTimeoutSeconds;
    this.blindIncreaseIntervalMinutes = blindIncreaseIntervalMinutes;

    this.seats = new Array(this.maxSeats).fill(null); // 固定 10 个座位
    this.deck = new Deck();
    this.communityCards = [];
    this.stage = TABLE_STAGES.IDLE;
    this.dealerSeat = -1;
    this.smallBlindSeat = -1;
    this.bigBlindSeat = -1;
    this.currentActorSeat = -1;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastRaiseAmount = this.bigBlind;

    this.pot = 0; // 当前底池总数
    this.pots = []; // 边池列表
    this.handCount = 0;
    this.startTime = Date.now();
    this.tournamentStartTime = Date.now();
    this.blindLevel = 1;
    this.eliminatedPlayers = []; // 锦标赛淘汰记录

    this.handWinners = []; // 结算赢家记录
    this.actionTimer = null;
    this.actionTimeRemaining = 0;
    this.timerInterval = null;

    // 回调事件
    this.onStateChange = null;
    this.onLog = null;
  }

  log(msg) {
    if (this.onLog) {
      this.onLog(msg);
    }
  }

  notifyUpdate() {
    if (this.onStateChange) {
      this.onStateChange(this);
    }
  }

  /**
   * 玩家入座
   */
  sitDown(seatIndex, player) {
    if (seatIndex < 0 || seatIndex >= this.maxSeats) return { success: false, msg: '无效座位号' };
    if (this.seats[seatIndex] !== null) return { success: false, msg: '该座位已有玩家' };

    // 检查玩家是否已经在别的座位
    const existingIndex = this.seats.findIndex(p => p && p.id === player.id);
    if (existingIndex !== -1) return { success: false, msg: '您已在牌桌中' };

    const seatPlayer = {
      id: player.id,
      name: player.name,
      avatar: player.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${player.name}`,
      isBot: Boolean(player.isBot),
      botPersonality: player.botPersonality || 'balanced',
      chips: player.chips !== undefined ? player.chips : this.defaultBuyIn,
      holeCards: [],
      currentRoundBet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      sittingOut: false,
      hasActedInRound: false,
      lastAction: null,
      showCards: false
    };

    this.seats[seatIndex] = seatPlayer;
    this.log(`玩家 [${seatPlayer.name}] 坐在了 ${seatIndex + 1} 号位`);
    this.notifyUpdate();
    return { success: true, player: seatPlayer };
  }

  /**
   * 玩家离座
   */
  standUp(playerId) {
    const seatIndex = this.seats.findIndex(p => p && p.id === playerId);
    if (seatIndex === -1) return false;

    const p = this.seats[seatIndex];
    this.log(`玩家 [${p.name}] 离开了座位`);

    // 如果处于行动中，先自动弃牌
    if (this.stage !== TABLE_STAGES.IDLE && this.stage !== TABLE_STAGES.END_HAND) {
      if (!p.folded) {
        this.playerAction(playerId, 'fold');
      }
    }

    this.seats[seatIndex] = null;
    this.notifyUpdate();
    return true;
  }

  /**
   * 玩家重买带入 (仅限常规桌)
   */
  rebuy(playerId, amount = this.defaultBuyIn) {
    if (this.gameMode === GAME_MODES.TOURNAMENT) {
      return { success: false, msg: '锦标赛模式不可重买' };
    }
    const player = this.seats.find(p => p && p.id === playerId);
    if (!player) return { success: false, msg: '未在座位中' };
    if (player.chips > 0) return { success: false, msg: '筹码未耗尽无需重买' };

    player.chips += amount;
    this.log(`玩家 [${player.name}] 重新带入了 ${amount} 筹码`);
    this.notifyUpdate();
    return { success: true };
  }

  /**
   * 获取所有有效在座且未被淘汰的玩家
   */
  getActiveSeatPlayers() {
    return this.seats.map((p, index) => ({ player: p, index })).filter(item => item.player !== null && !item.player.sittingOut && item.player.chips > 0);
  }

  /**
   * 获取牌局中仍未弃牌的存活玩家
   */
  getInHandPlayers() {
    return this.seats
      .map((p, index) => ({ player: p, index }))
      .filter(item => item.player !== null && !item.player.folded && (item.player.holeCards.length > 0));
  }

  /**
   * 获取牌局中未弃牌且未 All-in 的玩家
   */
  getBettingPlayers() {
    return this.getInHandPlayers().filter(item => !item.player.allIn);
  }

  /**
   * 锦标赛升盲检查
   */
  checkTournamentBlindIncrease() {
    if (this.gameMode !== GAME_MODES.TOURNAMENT) return;
    const elapsedMinutes = (Date.now() - this.tournamentStartTime) / (1000 * 60);
    const expectedLevel = Math.floor(elapsedMinutes / this.blindIncreaseIntervalMinutes) + 1;
    if (expectedLevel > this.blindLevel) {
      this.blindLevel = expectedLevel;
      this.smallBlind = 10 * Math.pow(2, this.blindLevel - 1);
      this.bigBlind = this.smallBlind * 2;
      this.log(`⚡ 锦标赛盲注升级！当前盲注级别 ${this.blindLevel}: ${this.smallBlind}/${this.bigBlind}`);
    }
  }

  /**
   * 开始新一局手牌
   */
  startNewHand() {
    this.clearActionTimer();
    this.checkTournamentBlindIncrease();

    const activePlayers = this.getActiveSeatPlayers();
    if (activePlayers.length < 2) {
      this.stage = TABLE_STAGES.IDLE;
      this.log('等待至少 2 名玩家就绪...');
      this.notifyUpdate();
      return false;
    }

    this.handCount += 1;
    this.stage = TABLE_STAGES.PREFLOP;
    this.communityCards = [];
    this.handWinners = [];
    this.pots = [];
    this.pot = 0;

    // 重置牌桌与玩家状态
    this.deck.reset();
    this.deck.shuffle();

    this.seats.forEach(p => {
      if (p) {
        p.holeCards = [];
        p.currentRoundBet = 0;
        p.totalBet = 0;
        p.folded = p.chips <= 0 || p.sittingOut;
        p.allIn = false;
        p.hasActedInRound = false;
        p.lastAction = null;
        p.showCards = false;
      }
    });

    // 移动庄家位 (Dealer Button)
    this.rotateDealer();

    // 确定大小盲
    this.determineBlinds();

    // 扣除大小盲注
    this.postBlinds();

    // 发底牌（每人2张）
    for (let round = 0; round < 2; round++) {
      for (const { player } of this.getActiveSeatPlayers()) {
        if (!player.folded) {
          player.holeCards.push(this.deck.deal(1)[0]);
        }
      }
    }

    this.log(`--- 第 ${this.handCount} 局开始 [盲注: ${this.smallBlind}/${this.bigBlind}] ---`);

    // 确定翻牌前第一个行动者 (UTG 枪口位 或 Heads-up 下的 SB)
    this.setInitialActorPreflop();
    this.notifyUpdate();
    this.startActionTimer();
    return true;
  }

  /**
   * 轮转庄家位
   */
  rotateDealer() {
    const active = this.getActiveSeatPlayers();
    if (this.dealerSeat === -1) {
      this.dealerSeat = active[0].index;
    } else {
      let foundNext = false;
      for (let i = 1; i <= this.maxSeats; i++) {
        const nextSeat = (this.dealerSeat + i) % this.maxSeats;
        if (this.seats[nextSeat] && !this.seats[nextSeat].sittingOut && this.seats[nextSeat].chips > 0) {
          this.dealerSeat = nextSeat;
          foundNext = true;
          break;
        }
      }
      if (!foundNext) this.dealerSeat = active[0].index;
    }
  }

  /**
   * 确定大小盲位置
   */
  determineBlinds() {
    const active = this.getActiveSeatPlayers();
    if (active.length === 2) {
      // 单挑 Heads-Up 规则：庄家是小盲位，另一位是大盲位
      this.smallBlindSeat = this.dealerSeat;
      const other = active.find(item => item.index !== this.dealerSeat);
      this.bigBlindSeat = other ? other.index : this.dealerSeat;
    } else {
      // 多人规则：庄家下一个有效位是小盲，再下一个是大盲
      this.smallBlindSeat = this.getNextActiveSeat(this.dealerSeat);
      this.bigBlindSeat = this.getNextActiveSeat(this.smallBlindSeat);
    }
  }

  getNextActiveSeat(fromSeat) {
    for (let i = 1; i <= this.maxSeats; i++) {
      const seat = (fromSeat + i) % this.maxSeats;
      if (this.seats[seat] && !this.seats[seat].folded && this.seats[seat].chips > 0 && !this.seats[seat].sittingOut) {
        return seat;
      }
    }
    return fromSeat;
  }

  /**
   * 强制下大小盲
   */
  postBlinds() {
    const sbPlayer = this.seats[this.smallBlindSeat];
    const bbPlayer = this.seats[this.bigBlindSeat];

    const sbAmount = Math.min(this.smallBlind, sbPlayer.chips);
    sbPlayer.chips -= sbAmount;
    sbPlayer.currentRoundBet = sbAmount;
    sbPlayer.totalBet = sbAmount;
    if (sbPlayer.chips === 0) sbPlayer.allIn = true;
    sbPlayer.lastAction = `小盲 ${sbAmount}`;

    const bbAmount = Math.min(this.bigBlind, bbPlayer.chips);
    bbPlayer.chips -= bbAmount;
    bbPlayer.currentRoundBet = bbAmount;
    bbPlayer.totalBet = bbAmount;
    if (bbPlayer.chips === 0) bbPlayer.allIn = true;
    bbPlayer.lastAction = `大盲 ${bbAmount}`;

    this.pot = sbAmount + bbAmount;
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.lastRaiseAmount = this.bigBlind;
  }

  /**
   * 设定翻牌前第一行动位
   */
  setInitialActorPreflop() {
    const active = this.getActiveSeatPlayers();
    if (active.length === 2) {
      // 单挑翻牌前庄家(小盲)先行动
      this.currentActorSeat = this.dealerSeat;
    } else {
      // 多人翻牌前大盲下一位 (UTG) 先行动
      this.currentActorSeat = this.getNextActiveSeat(this.bigBlindSeat);
    }
  }

  /**
   * 设定翻牌后第一行动位（庄家下一个有效位）
   */
  setInitialActorPostFlop() {
    this.currentActorSeat = this.getNextActiveSeat(this.dealerSeat);
  }

  /**
   * 启动行动倒计时
   */
  startActionTimer() {
    this.clearActionTimer();
    this.actionTimeRemaining = this.actionTimeoutSeconds;

    this.timerInterval = setInterval(() => {
      this.actionTimeRemaining -= 1;
      this.notifyUpdate();

      if (this.actionTimeRemaining <= 0) {
        this.clearActionTimer();
        this.handleTimeoutAction();
      }
    }, 1000);
  }

  clearActionTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * 玩家超时自动处理：能 Check 则 Check，否则 Fold
   */
  handleTimeoutAction() {
    if (this.currentActorSeat === -1) return;
    const player = this.seats[this.currentActorSeat];
    if (!player) return;

    if (player.currentRoundBet === this.currentBet) {
      this.playerAction(player.id, 'check');
    } else {
      this.playerAction(player.id, 'fold');
    }
  }

  /**
   * 玩家执行行动
   * action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn'
   */
  playerAction(playerId, actionType, amount = 0) {
    if (this.currentActorSeat === -1) return { success: false, msg: '当前不可行动' };
    const player = this.seats[this.currentActorSeat];
    if (!player || player.id !== playerId) return { success: false, msg: '不是您的行动回合' };

    const toCall = this.currentBet - player.currentRoundBet;

    switch (actionType) {
      case 'fold': {
        player.folded = true;
        player.lastAction = '弃牌';
        this.log(`玩家 [${player.name}] 弃牌`);
        break;
      }

      case 'check': {
        if (toCall > 0) {
          return { success: false, msg: `当前需跟注 ${toCall}，不可过牌` };
        }
        player.lastAction = '过牌';
        this.log(`玩家 [${player.name}] 过牌`);
        break;
      }

      case 'call': {
        const callAmount = Math.min(toCall, player.chips);
        player.chips -= callAmount;
        player.currentRoundBet += callAmount;
        player.totalBet += callAmount;
        this.pot += callAmount;

        if (player.chips === 0) {
          player.allIn = true;
          player.lastAction = `全下跟注 ${callAmount}`;
          this.log(`玩家 [${player.name}] 全下跟注 ${callAmount}`);
        } else {
          player.lastAction = `跟注 ${callAmount}`;
          this.log(`玩家 [${player.name}] 跟注 ${callAmount}`);
        }
        break;
      }

      case 'bet':
      case 'raise': {
        const targetBet = parseInt(amount, 10);
        if (isNaN(targetBet) || targetBet < this.currentBet + this.minRaise) {
          // 除非全下
          if (player.chips + player.currentRoundBet <= targetBet) {
            // 转化为 All-in
            return this.playerAction(playerId, 'allIn');
          }
          return { success: false, msg: `加注金额至少为 ${this.currentBet + this.minRaise}` };
        }

        const neededChips = targetBet - player.currentRoundBet;
        if (neededChips > player.chips) {
          return { success: false, msg: '筹码不足' };
        }

        player.chips -= neededChips;
        player.currentRoundBet = targetBet;
        player.totalBet += neededChips;
        this.pot += neededChips;

        const raiseDiff = targetBet - this.currentBet;
        this.minRaise = Math.max(this.minRaise, raiseDiff);
        this.currentBet = targetBet;

        if (player.chips === 0) {
          player.allIn = true;
          player.lastAction = `全下加注至 ${targetBet}`;
          this.log(`玩家 [${player.name}] 全下加注至 ${targetBet}`);
        } else {
          player.lastAction = `加注至 ${targetBet}`;
          this.log(`玩家 [${player.name}] 加注至 ${targetBet}`);
        }
        break;
      }

      case 'allIn': {
        const allInChips = player.chips;
        const targetBet = player.currentRoundBet + allInChips;

        player.chips = 0;
        player.currentRoundBet = targetBet;
        player.totalBet += allInChips;
        this.pot += allInChips;
        player.allIn = true;

        if (targetBet > this.currentBet) {
          const raiseDiff = targetBet - this.currentBet;
          if (raiseDiff >= this.minRaise) {
            this.minRaise = raiseDiff;
          }
          this.currentBet = targetBet;
        }

        player.lastAction = `All-in 全下 (${allInChips})`;
        this.log(`🔥 玩家 [${player.name}] 全下 ${allInChips} 筹码！`);
        break;
      }

      default:
        return { success: false, msg: '未知操作' };
    }

    player.hasActedInRound = true;
    this.advanceTurn();
    return { success: true };
  }

  /**
   * 推进下一个行动者或进入下一阶段
   */
  advanceTurn() {
    this.clearActionTimer();

    // 1. 检查是否只剩 1 人未弃牌
    const inHand = this.getInHandPlayers();
    if (inHand.length === 1) {
      this.settleSoleSurvivor(inHand[0].player);
      return;
    }

    // 2. 检查本轮下注是否已平衡完成
    const bettingPlayers = this.getBettingPlayers();
    const allActed = inHand.every(({ player }) => player.hasActedInRound || player.allIn);
    const allBetsEqual = inHand.every(({ player }) => player.allIn || player.currentRoundBet === this.currentBet);

    if ((bettingPlayers.length <= 1 && allBetsEqual) || (allActed && allBetsEqual)) {
      this.nextStage();
    } else {
      // 寻找下一个需要行动的玩家
      this.currentActorSeat = this.findNextActor(this.currentActorSeat);
      this.notifyUpdate();
      this.startActionTimer();
    }
  }

  /**
   * 寻找下一个需要行动的未弃牌且未全下的玩家
   */
  findNextActor(fromSeat) {
    for (let i = 1; i <= this.maxSeats; i++) {
      const seat = (fromSeat + i) % this.maxSeats;
      const p = this.seats[seat];
      if (p && !p.folded && !p.allIn && (!p.hasActedInRound || p.currentRoundBet < this.currentBet)) {
        return seat;
      }
    }
    return -1;
  }

  /**
   * 进入下一个发牌/下注阶段
   */
  nextStage() {
    // 重置每位玩家本轮下注与行动标记
    this.seats.forEach(p => {
      if (p) {
        p.currentRoundBet = 0;
        p.hasActedInRound = false;
      }
    });
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    // 检查是否所有还在牌局中的玩家均已 All-in（或仅剩1人有筹码其他人全 All-in）
    const bettingPlayers = this.getBettingPlayers();
    const isAutoRunout = bettingPlayers.length <= 1;

    switch (this.stage) {
      case TABLE_STAGES.PREFLOP:
        this.deck.burn();
        this.communityCards.push(...this.deck.deal(3)); // Flop 发 3 张
        this.stage = TABLE_STAGES.FLOP;
        this.log(`【发翻牌】公共牌: ${this.communityCards.map(c => c.toString()).join(' ')}`);
        break;

      case TABLE_STAGES.FLOP:
        this.deck.burn();
        this.communityCards.push(...this.deck.deal(1)); // Turn 发 1 张
        this.stage = TABLE_STAGES.TURN;
        this.log(`【发转牌】公共牌: ${this.communityCards.map(c => c.toString()).join(' ')}`);
        break;

      case TABLE_STAGES.TURN:
        this.deck.burn();
        this.communityCards.push(...this.deck.deal(1)); // River 发 1 张
        this.stage = TABLE_STAGES.RIVER;
        this.log(`【发河牌】公共牌: ${this.communityCards.map(c => c.toString()).join(' ')}`);
        break;

      case TABLE_STAGES.RIVER:
        this.stage = TABLE_STAGES.SHOWDOWN;
        this.settleShowdown();
        return;
    }

    if (isAutoRunout) {
      // 自动快速发完下一阶段牌
      this.notifyUpdate();
      setTimeout(() => this.nextStage(), 1200);
    } else {
      this.setInitialActorPostFlop();
      if (this.currentActorSeat === -1) {
        this.nextStage();
      } else {
        this.notifyUpdate();
        this.startActionTimer();
      }
    }
  }

  /**
   * 仅剩一人未弃牌时的结算
   */
  settleSoleSurvivor(winner) {
    this.stage = TABLE_STAGES.END_HAND;
    winner.chips += this.pot;
    this.handWinners = [{
      playerId: winner.id,
      name: winner.name,
      totalWon: this.pot,
      description: '其余玩家全部弃牌'
    }];
    this.log(`🏆 玩家 [${winner.name}] 独揽底池 ${this.pot} 筹码（对手全部弃牌）`);
    this.finishHand();
  }

  /**
   * 摊牌比牌结算 (Showdown)
   */
  settleShowdown() {
    this.stage = TABLE_STAGES.SHOWDOWN;
    const inHand = this.getInHandPlayers();

    // 计算每位玩家的 7选5 最佳手牌
    const evaluatedPlayers = inHand.map(({ player }) => {
      const allCards = [...player.holeCards, ...this.communityCards];
      const bestHand = evaluateHand(allCards);
      player.bestHand = bestHand;
      player.showCards = true; // 亮牌
      return {
        id: player.id,
        name: player.name,
        totalBet: player.totalBet,
        folded: player.folded,
        bestHand: bestHand
      };
    });

    // 多边池分配
    const payouts = PotManager.distributePots(evaluatedPlayers);

    this.handWinners = payouts.map(payout => {
      const seatP = this.seats.find(p => p && p.id === payout.playerId);
      if (seatP) {
        seatP.chips += payout.totalWon;
      }
      const pInfo = evaluatedPlayers.find(p => p.id === payout.playerId);
      return {
        playerId: payout.playerId,
        name: pInfo ? pInfo.name : '未知',
        totalWon: payout.totalWon,
        description: pInfo && pInfo.bestHand ? pInfo.bestHand.description : ''
      };
    });

    for (const w of this.handWinners) {
      this.log(`🏆 [${w.name}] 获胜赢得 ${w.totalWon} 筹码 (${w.description})`);
    }

    this.stage = TABLE_STAGES.END_HAND;
    this.finishHand();
  }

  /**
   * 局末处理与自动开启下一局
   */
  finishHand() {
    this.clearActionTimer();
    this.notifyUpdate();

    // 检查锦标赛淘汰
    if (this.gameMode === GAME_MODES.TOURNAMENT) {
      this.seats.forEach((p, idx) => {
        if (p && p.chips === 0 && !this.eliminatedPlayers.includes(p.id)) {
          this.eliminatedPlayers.unshift({ id: p.id, name: p.name, rank: this.getActiveSeatPlayers().length + 1 });
          this.log(`💀 玩家 [${p.name}] 筹码归零，被淘汰！`);
        }
      });
    }

    // 3.5秒后自动重开下一局
    setTimeout(() => {
      const active = this.getActiveSeatPlayers();
      if (active.length >= 2) {
        this.startNewHand();
      } else {
        this.stage = TABLE_STAGES.IDLE;
        this.log('等待更多玩家准备...');
        this.notifyUpdate();
      }
    }, 4000);
  }

  /**
   * 获取对指定玩家安全的牌桌公共视图 (防透视)
   */
  getPublicState(viewerPlayerId) {
    return {
      id: this.id,
      name: this.name,
      maxSeats: this.maxSeats,
      gameMode: this.gameMode,
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
      actionTimeoutSeconds: this.actionTimeoutSeconds,
      communityCards: this.communityCards.map(c => c.toJSON()),
      handWinners: this.handWinners,
      handCount: this.handCount,
      seats: this.seats.map((p, index) => {
        if (!p) return null;
        const isSelf = p.id === viewerPlayerId;
        const shouldReveal = this.stage === TABLE_STAGES.SHOWDOWN || this.stage === TABLE_STAGES.END_HAND || p.showCards;

        return {
          seatIndex: index,
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          isBot: p.isBot,
          botPersonality: p.botPersonality,
          chips: p.chips,
          currentRoundBet: p.currentRoundBet,
          totalBet: p.totalBet,
          folded: p.folded,
          allIn: p.allIn,
          lastAction: p.lastAction,
          bestHandDescription: (shouldReveal && p.bestHand) ? p.bestHand.description : null,
          holeCards: p.holeCards.map(card => {
            if (isSelf || shouldReveal) {
              return card.toJSON();
            }
            return { isHidden: true }; // 密码学隔离，非本人且未摊牌时不发送卡牌点数花色
          })
        };
      })
    };
  }
}
