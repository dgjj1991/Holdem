import crypto from 'crypto';

export const SUITS = ['s', 'h', 'd', 'c']; // 黑桃 spades, 红桃 hearts, 方块 diamonds, 草花 clubs
export const SUIT_SYMBOLS = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣'
};
export const SUIT_COLORS = {
  s: 'black',
  h: 'red',
  d: 'blue', // 四色牌显示，更清晰
  c: 'green'
};

export const RANKS = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: 'T' },
  { value: 11, label: 'J' },
  { value: 12, label: 'Q' },
  { value: 13, label: 'K' },
  { value: 14, label: 'A' }
];

export class Card {
  constructor(suit, rank, label) {
    this.suit = suit;
    this.rank = rank;
    this.label = label;
    this.symbol = SUIT_SYMBOLS[suit];
    this.id = `${label}${suit}`;
  }

  toString() {
    return `${this.label}${this.symbol}`;
  }

  toJSON() {
    return {
      id: this.id,
      suit: this.suit,
      rank: this.rank,
      label: this.label,
      symbol: this.symbol
    };
  }
}

export class Deck {
  constructor() {
    this.cards = [];
    this.reset();
  }

  /**
   * 初始化一副标准的52张扑克牌（不含大小王）
   */
  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const { value, label } of RANKS) {
        this.cards.push(new Card(suit, value, label));
      }
    }
  }

  /**
   * 采用密码学安全伪随机数发生器 (CSPRNG) 的 Fisher-Yates 洗牌算法
   * 使用 crypto.randomInt(0, i + 1)，彻底杜绝 Math.random() 的伪随机缺陷与可预测性
   */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      // crypto.randomInt(min, max) 生成 [min, max) 区间的安全随机整数
      const j = crypto.randomInt(0, i + 1);
      const temp = this.cards[i];
      this.cards[i] = this.cards[j];
      this.cards[j] = temp;
    }
  }

  /**
   * 销牌（Burn card，德州正规规则中在发 Flop/Turn/River 前各销一张牌）
   */
  burn() {
    if (this.cards.length > 0) {
      return this.cards.pop();
    }
    return null;
  }

  /**
   * 发牌
   * @param {number} count 发牌张数
   * @returns {Card[]} 发出的牌
   */
  deal(count = 1) {
    const dealt = [];
    for (let i = 0; i < count; i++) {
      if (this.cards.length === 0) {
        throw new Error('牌堆已耗尽');
      }
      dealt.push(this.cards.pop());
    }
    return dealt;
  }

  /**
   * 剩余牌数
   */
  remaining() {
    return this.cards.length;
  }
}
