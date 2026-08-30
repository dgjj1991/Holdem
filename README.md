# 🃏 德州聚会 (Texas Hold'em Online)

> **极简免登 · 密码学真随机发牌 · 2~10人好友联机 & 单人AI对战 · 常规桌/锦标赛双赛制**

---

## 🌟 核心特性

1. **🔐 密码学级绝对真随机发牌**
   * 采用 Node.js 原生 `crypto.randomInt` 驱动的标准 Fisher-Yates 洗牌算法，杜绝任何伪随机周期与预测漏洞，保证绝对公平。

2. **👥 支持 2~10 人全环桌 (Full-Ring)**
   * 经典拟物绿呢绒牌桌与椭圆座位环形排布。
   * 支持房主随时一键添加/移除不同性格风格（紧凶 TAG、松凶 LAG、稳健 Passive）的 AI 陪练。

3. **🏆 双赛制自由切换**
   * **常规桌 (Cash Game)**：默认 1000 筹码带入，输光可随时一键补充重买（Rebuy）。
   * **锦标赛 (SNG 淘汰赛)**：固定起手筹码，定时升盲（盲注随时间递增），淘汰至决出冠亚军。

4. **🧮 德州扑克裁判与边池算法**
   * 完整 7 选 5 手牌评级（皇家同花顺至高牌，精确到踢脚牌比对）。
   * 精确支持多玩家不同深度 All-in 下的多重边池（Side Pots）分配与平局均分。

5. **📊 战绩与历史回顾系统**
   * 实时记录总手牌数、胜率、入池率 (VPIP)、净盈亏排行榜与大底池记录。

6. **🎵 Web Audio 拟真音效**
   * 内置合成洗牌、发牌、推筹码、All-in 与胜利庆祝特效（支持撒花动画）。

---

## 🚀 极速开始使用

### 方式 1：单人离线对战（0 配置，双击即玩）
直接用 Chrome / Edge / Safari 等任意现代浏览器打开：
```bash
open /Users/junjiehuang/Documents/Ai专用/texas-holdem/index.html
```
点击 **「进入单人 AI 训练局」** 即可立即与 9 名智能电脑打牌！

---

### 方式 2：启动多人联机服务端
```bash
cd /Users/junjiehuang/Documents/Ai专用/texas-holdem/server
npm install
npm start
```
服务启动在 `http://localhost:4000`。
* 朋友在同一局域网下访问 `http://<你的电脑局域网IP>:4000`
* 房主点击「创建专属私人房间」，将 6 位房间码或链接分享给朋友即可同台对战！

---

## ☁️ 免费零成本公网部署指南 (让朋友不在同个局域网也能玩)

你不需要购买任何付费 VPS，推荐使用以下免费托管平台：

### 推荐平台：Render (https://render.com)
1. 注册 Render.com 免费账号。
2. 将本项目代码推送到你自己的 GitHub 仓库。
3. 在 Render 控制台点击 **New +** -> **Web Service**，关联此仓库。
4. 配置信息：
   * **Root Directory**: `server`
   * **Build Command**: `npm install`
   * **Start Command**: `npm start`
5. 点击 **Create Web Service**，Render 会自动为你分配一个免费的公网 HTTPS/WSS 域名（例如 `https://my-poker.onrender.com`）。
6. 把该网址发给朋友，所有人即可在手机或电脑浏览器上畅快打牌！

---

## 📁 目录架构

```text
texas-holdem/
├── index.html                  # 现代化前端主页面 (拟物牌桌、10人座位、控制面板)
├── README.md                   # 项目使用与部署文档
└── server/                     # 后端服务
    ├── package.json            # 后端依赖与启动脚本
    ├── test/
    │   └── engine.test.js      # 算法单元测试 (洗牌随机性、比牌评级、多重边池)
    └── src/
        ├── server.js           # Express + Socket.io 实时服务器
        ├── socket/
        │   └── gameHandler.js  # 房间管理、防作弊手牌私密下发与网络事件
        ├── ai/
        │   └── bot.js          # 启发式扑克 AI 决策引擎
        ├── stats/
        │   └── statsManager.js # 战绩榜单与手牌历史
        └── engine/
            ├── deck.js         # 密码学真随机洗牌算法 (crypto.randomInt)
            ├── evaluator.js    # 7选5 手牌评级与精确踢脚算法
            ├── pot.js          # 边池计算器 (Side Pot Manager)
            └── table.js        # 10人桌状态机核心引擎
```
