export type FighterConfig = {
  id: string;
  name: string;
  color: string;
  weight: number;
};

export type ArenaRules = {
  heal: boolean;
  power: boolean;
  shield: boolean;
  haste: boolean;
  giant: boolean;
  bombs: boolean;
};

export type ItemKind = "heal" | "power" | "shield" | "haste" | "giant" | "bomb";

export const DEFAULT_FIGHTERS: FighterConfig[] = [
  { id: "fox", name: "霓虹狐", color: "#ff5d73", weight: 1 },
  { id: "whale", name: "深海鯨", color: "#41b8ff", weight: 1 },
  { id: "lion", name: "沙暴獅", color: "#ffbd45", weight: 1 },
  { id: "lynx", name: "電光貓", color: "#a77bff", weight: 1 },
  { id: "bear", name: "苔原熊", color: "#45e0b7", weight: 1 },
];

export const DEFAULT_RULES: ArenaRules = {
  heal: true,
  power: true,
  shield: true,
  haste: true,
  giant: true,
  bombs: false,
};

export const RULE_COPY: Array<{
  key: keyof ArenaRules;
  icon: string;
  title: string;
  description: string;
}> = [
  { key: "heal", icon: "+", title: "修復核心", description: "降低累積傷害，延長存活時間" },
  { key: "power", icon: "×", title: "超載晶片", description: "短時間大幅提升撞擊力量" },
  { key: "shield", icon: "◈", title: "脈衝護盾", description: "產生排斥力場並抵銷部分傷害" },
  { key: "haste", icon: "»", title: "疾速模組", description: "提升移動速度與追擊能力" },
  { key: "giant", icon: "⬡", title: "巨像核心", description: "體型與質量提升，更不易被擊飛" },
  { key: "bombs", icon: "●", title: "不穩定炸彈", description: "場上會出現倒數後爆炸的危險物" },
];

export function uid(prefix = "fighter") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function contrastText(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return "#07131c";
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#07131c" : "#ffffff";
}
