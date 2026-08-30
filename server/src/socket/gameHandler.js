import { PokerTable, GAME_MODES, TABLE_STAGES } from '../engine/table.js';
import { PokerBot, BOT_NAMES, BOT_PERSONALITIES } from '../ai/bot.js';
import { StatsManager } from '../stats/statsManager.js';

// 房间内存存储
const rooms = new Map(); // roomId -> { table: PokerTable, stats: StatsManager, hostSocketId: string, sockets: Set }

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function setupGameSocket(io) {
  io.on('connection', socket => {
    let currentRoomId = null;
    let currentPlayerId = null;

    function broadcastTableState(roomId) {
      const room = rooms.get(roomId);
      if (!room) return;

      const { table, sockets } = room;

      // 向房间内每个连接发送其专属的安全视图
      io.in(roomId).fetchSockets().then(connectedSockets => {
        for (const s of connectedSockets) {
          const pid = s.data.playerId;
          const publicState = table.getPublicState(pid);
          s.emit('table_update', publicState);
        }
      });
    }

    function checkAndTriggerBotAction(roomId) {
      const room = rooms.get(roomId);
      if (!room) return;

      const { table } = room;
      if (table.stage === TABLE_STAGES.IDLE || table.stage === TABLE_STAGES.END_HAND) return;

      const currentActor = table.seats[table.currentActorSeat];
      if (currentActor && currentActor.isBot) {
        const delay = 800 + Math.random() * 1000;
        setTimeout(() => {
          // 再次检查是否依然是该机器人行动
          if (table.seats[table.currentActorSeat] && table.seats[table.currentActorSeat].id === currentActor.id) {
            const decision = PokerBot.decide(table, currentActor);
            table.playerAction(currentActor.id, decision.action, decision.amount);
          }
        }, delay);
      }
    }

    // 1. 创建房间
    socket.on('create_room', (options, callback) => {
      const roomId = generateRoomId();
      const table = new PokerTable({
        id: roomId,
        name: options.name || `德州房间 ${roomId}`,
        maxSeats: 10,
        gameMode: options.gameMode || GAME_MODES.CASH,
        smallBlind: options.smallBlind || 10,
        bigBlind: options.bigBlind || 20,
        defaultBuyIn: 1000,
        actionTimeoutSeconds: options.actionTimeout || 15
      });

      const stats = new StatsManager();

      table.onStateChange = () => {
        broadcastTableState(roomId);
        checkAndTriggerBotAction(roomId);
      };

      table.onLog = msg => {
        io.to(roomId).emit('game_log', {
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: msg
        });
      };

      // 监听手牌结束以记录战绩
      const originalFinish = table.finishHand.bind(table);
      table.finishHand = function() {
        stats.recordHandEnd(table);
        originalFinish();
      };

      rooms.set(roomId, {
        table,
        stats,
        hostId: options.playerId,
        createdAt: Date.now()
      });

      socket.join(roomId);
      currentRoomId = roomId;
      currentPlayerId = options.playerId;
      socket.data.playerId = options.playerId;

      callback({ success: true, roomId, isHost: true });
    });

    // 2. 加入房间
    socket.on('join_room', ({ roomId, player }, callback) => {
      const room = rooms.get(roomId.toUpperCase());
      if (!room) {
        return callback({ success: false, msg: '房间号不存在' });
      }

      currentRoomId = roomId.toUpperCase();
      currentPlayerId = player.id;
      socket.data.playerId = player.id;
      socket.join(currentRoomId);

      const isHost = room.hostId === player.id;
      callback({
        success: true,
        roomId: currentRoomId,
        isHost,
        tableState: room.table.getPublicState(player.id)
      });

      broadcastTableState(currentRoomId);
    });

    // 3. 入座
    socket.on('sit_down', ({ seatIndex, player }, callback) => {
      if (!currentRoomId) return callback({ success: false, msg: '未加入房间' });
      const room = rooms.get(currentRoomId);
      if (!room) return callback({ success: false, msg: '房间已解散' });

      const res = room.table.sitDown(seatIndex, player);
      callback(res);
    });

    // 4. 离座/切换观战
    socket.on('stand_up', callback => {
      if (!currentRoomId || !currentPlayerId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        room.table.standUp(currentPlayerId);
        if (callback) callback({ success: true });
      }
    });

    // 5. 房主添加 AI 机器人
    socket.on('add_bot', ({ personality = 'balanced' }, callback) => {
      if (!currentRoomId) return callback({ success: false, msg: '未加入房间' });
      const room = rooms.get(currentRoomId);
      if (!room) return callback({ success: false, msg: '房间不存在' });

      // 寻找第一个空座位
      const emptyIndex = room.table.seats.findIndex(s => s === null);
      if (emptyIndex === -1) {
        return callback({ success: false, msg: '牌桌座位已满' });
      }

      // 挑选一个未被占用的名字
      const usedNames = room.table.seats.filter(Boolean).map(s => s.name);
      const availableNames = BOT_NAMES.filter(name => !usedNames.includes(name));
      const botName = availableNames.length > 0 ? availableNames[0] : `AI玩家 ${Math.floor(Math.random() * 100)}`;

      const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const res = room.table.sitDown(emptyIndex, {
        id: botId,
        name: botName,
        isBot: true,
        botPersonality: personality,
        chips: room.table.defaultBuyIn
      });

      callback(res);
    });

    // 6. 房主移除 AI 机器人
    socket.on('remove_bot', ({ botId }, callback) => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        room.table.standUp(botId);
        if (callback) callback({ success: true });
      }
    });

    // 7. 开始游戏
    socket.on('start_game', callback => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      const started = room.table.startNewHand();
      if (callback) callback({ success: started });
    });

    // 8. 玩家行动 (Fold, Check, Call, Bet, Raise, All-in)
    socket.on('player_action', ({ action, amount }, callback) => {
      if (!currentRoomId || !currentPlayerId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      const res = room.table.playerAction(currentPlayerId, action, amount);
      if (callback) callback(res);
    });

    // 9. 重新买入 (Rebuy)
    socket.on('rebuy', callback => {
      if (!currentRoomId || !currentPlayerId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      const res = room.table.rebuy(currentPlayerId, 1000);
      if (callback) callback(res);
    });

    // 10. 获取战绩榜单与手牌历史
    socket.on('get_stats', callback => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      callback({
        leaderboard: room.stats.getLeaderboard(),
        recentHands: room.stats.getRecentHands(10)
      });
    });

    // 11. 牌桌聊天与互动
    socket.on('send_chat', ({ message, senderName }) => {
      if (!currentRoomId) return;
      io.to(currentRoomId).emit('chat_message', {
        id: Date.now(),
        sender: senderName || '玩家',
        message: message,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      });
    });

    // 12. 断开连接
    socket.on('disconnect', () => {
      // 玩家若在游戏中，保留其座位但标记离线，超时由托管机制 Fold/Check
      if (currentRoomId && currentPlayerId) {
        const room = rooms.get(currentRoomId);
        if (room) {
          const player = room.table.seats.find(p => p && p.id === currentPlayerId);
          if (player) {
            room.table.log(`玩家 [${player.name}] 断开连接`);
          }
        }
      }
    });
  });
}
