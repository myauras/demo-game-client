import { assetPath } from "./assets";

export type FighterConfig = {
  id: string;
  name: string;
  color: string;
  icon: string;
  skillIcon: string;
  skillName: string;
  skillDescription: string;
};

export const DEFAULT_FIGHTERS: FighterConfig[] = [
  {
    id: "zed",
    name: "Zed",
    color: "#111318",
    icon: assetPath("/icons/zed/icon.webp"),
    skillIcon: assetPath("/icons/zed/skill.png"),
    skillName: "疾風殘影",
    skillDescription: "劫召喚一位影分身一起進行戰鬥",
  },
  {
    id: "jinx",
    name: "Jinx",
    color: "#00ade9",
    icon: assetPath("/icons/jinx/icon.webp"),
    skillIcon: assetPath("/icons/jinx/skill.png"),
    skillName: "超威能死亡火箭",
    skillDescription: "吉茵珂絲射出連發火箭對前方目標進行掃蕩。",
  },
  {
    id: "darius",
    name: "Darius",
    color: "#858b94",
    icon: assetPath("/icons/darius/icon.webp"),
    skillIcon: assetPath("/icons/darius/skill.png"),
    skillName: "毀滅風暴",
    skillDescription: "達瑞斯揮舞他的斧頭造成致命旋風，對周圍進行大範圍擊退。",
  },
  {
    id: "lee-sin",
    name: "Lee Sin",
    color: "#470305",
    icon: assetPath("/icons/lee-sin/icon.webp"),
    skillIcon: assetPath("/icons/lee-sin/skill.png"),
    skillName: "虎嘯龍吟",
    skillDescription: "李星鎖定一位目標衝刺並造成強力擊退。",
  },
  {
    id: "janna",
    name: "Janna",
    color: "#f7f9ff",
    icon: assetPath("/icons/janna/icon.webp"),
    skillIcon: assetPath("/icons/janna/skill.png"),
    skillName: "颶風呼嘯",
    skillDescription: "珍娜控制天氣，召喚一道隨時間強化的龍捲風",
  },
];
