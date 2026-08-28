export type BetType = "win" | "place" | "quinella" | "quinella-place" | "exacta";

export type BetDefinition = {
  id: BetType;
  name: string;
  displayName: string;
  instruction: string;
  pickCount: number;
  ordered: boolean;
  probability: number;
  decimalOdds: number;
};

const FIGHTER_COUNT = 5;

export const BET_DEFINITIONS: BetDefinition[] = [
  {
    id: "win",
    name: "獨贏",
    displayName: "冠軍",
    instruction: "選 1 位冠軍",
    pickCount: 1,
    ordered: false,
    probability: 1 / FIGHTER_COUNT,
    decimalOdds: FIGHTER_COUNT,
  },
  {
    id: "place",
    name: "位置",
    displayName: "前二",
    instruction: "選 1 位進入前二",
    pickCount: 1,
    ordered: false,
    probability: 2 / FIGHTER_COUNT,
    decimalOdds: FIGHTER_COUNT / 2,
  },
  {
    id: "quinella",
    name: "連贏",
    displayName: "前二組",
    instruction: "選 2 位包辦前二，順序不限",
    pickCount: 2,
    ordered: false,
    probability: 1 / 10,
    decimalOdds: 10,
  },
  {
    id: "quinella-place",
    name: "位置Q",
    displayName: "前三組",
    instruction: "選 2 位都進入前三，順序不限",
    pickCount: 2,
    ordered: false,
    probability: 3 / 10,
    decimalOdds: 10 / 3,
  },
  {
    id: "exacta",
    name: "二重彩",
    displayName: "前二順位",
    instruction: "依序選出冠、亞軍",
    pickCount: 2,
    ordered: true,
    probability: 1 / 20,
    decimalOdds: 20,
  },
];

export function getBetDefinition(type: BetType) {
  return BET_DEFINITIONS.find((bet) => bet.id === type) ?? BET_DEFINITIONS[0];
}

export function isBetComplete(type: BetType, selections: string[]) {
  return selections.length === getBetDefinition(type).pickCount;
}

export function isWinningBet(type: BetType, selections: string[], finishOrder: string[]) {
  if (!isBetComplete(type, selections) || finishOrder.length < 3) return false;

  if (type === "win") return selections[0] === finishOrder[0];
  if (type === "place") return finishOrder.slice(0, 2).includes(selections[0]);
  if (type === "quinella") {
    return selections.every((fighterId) => finishOrder.slice(0, 2).includes(fighterId));
  }
  if (type === "quinella-place") {
    return selections.every((fighterId) => finishOrder.slice(0, 3).includes(fighterId));
  }
  return type === "exacta"
    && selections.every((fighterId, index) => fighterId === finishOrder[index]);
}

export function simulatedPrize(entryAmount: number, type: BetType) {
  return Math.round(entryAmount * getBetDefinition(type).decimalOdds);
}
