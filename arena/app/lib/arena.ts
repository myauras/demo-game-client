export type FighterConfig = {
  id: string;
  name: string;
  color: string;
};

export const DEFAULT_FIGHTERS: FighterConfig[] = [
  { id: "zed", name: "Zed", color: "#ff5d73" },
  { id: "jinx", name: "Jinx", color: "#41b8ff" },
  { id: "darius", name: "Darius", color: "#ffbd45" },
  { id: "lee-sin", name: "Lee Sin", color: "#a77bff" },
  { id: "janna", name: "Janna", color: "#45e0b7" },
];
