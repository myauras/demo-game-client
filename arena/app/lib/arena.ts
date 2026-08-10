export type FighterConfig = {
  id: string;
  name: string;
  color: string;
  weight: number;
  profileUrl: string;
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
  { id: "zed", name: "Zed", color: "#ff5d73", weight: 1, profileUrl: "https://op.gg/lol/champions/zed/build/mid" },
  { id: "jinx", name: "Jinx", color: "#41b8ff", weight: 1, profileUrl: "https://op.gg/lol/champions/jinx/build/adc" },
  { id: "darius", name: "Darius", color: "#ffbd45", weight: 1, profileUrl: "https://op.gg/lol/champions/darius/build/top" },
  { id: "lee-sin", name: "Lee Sin", color: "#a77bff", weight: 1, profileUrl: "https://op.gg/lol/champions/leesin/build/jungle" },
  { id: "janna", name: "Janna", color: "#45e0b7", weight: 1, profileUrl: "https://op.gg/lol/champions/janna/build/support" },
];

export const DEFAULT_RULES: ArenaRules = {
  heal: true,
  power: true,
  shield: true,
  haste: true,
  giant: true,
  bombs: false,
};
