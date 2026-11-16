export const TARGET_RTP = 0.95;
export const INITIAL_BALANCE = 10_000;
export const DEFAULT_BET = 100;
export const BET_STEP = 100;

export const REWARD_TYPES = [
  { id: "coin", label: "金幣", weight: 0.5 },
  { id: "coins", label: "金幣堆", weight: 0.3 },
  { id: "bars", label: "金條堆", weight: 0.15 },
  { id: "diamond", label: "鑽石", weight: 0.05 }
];

export const DIFFICULTIES = {
  normal: {
    id: "normal",
    label: "普通",
    size: 3,
    rewards: { coin: 0.2, coins: 0.5, bars: 1, diamond: 3 }
  },
  medium: {
    id: "medium",
    label: "中等",
    size: 4,
    rewards: { coin: 0.4, coins: 1, bars: 2, diamond: 6 }
  },
  hard: {
    id: "hard",
    label: "困難",
    size: 5,
    rewards: { coin: 0.6, coins: 1.5, bars: 3, diamond: 10 }
  }
};

export const formatMoney = (value) => new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
}).format(value);

export const formatMultiplier = (value) => `${Number(value).toFixed(2)}X`;
