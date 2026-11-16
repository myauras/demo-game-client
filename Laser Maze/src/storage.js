import { INITIAL_BALANCE } from "./config.js";

const KEY = "laser-maze-demo-v2";

export function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed && Number.isFinite(parsed.balance)) {
      return {
        balance: parsed.balance,
        activeRound: parsed.activeRound || null,
        history: Array.isArray(parsed.history) ? parsed.history.slice(-20) : []
      };
    }
  } catch {
    // Invalid demo data is safely replaced with a fresh local wallet.
  }
  return { balance: INITIAL_BALANCE, activeRound: null, history: [] };
}

export function saveStore(store) {
  localStorage.setItem(KEY, JSON.stringify({
    balance: store.balance,
    activeRound: store.activeRound,
    history: store.history.slice(-20)
  }));
}
