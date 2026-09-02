# 動物大賽跑｜HTML Demo

遊戲 B 的純本地 Demo。**唯一規格依據：`reports/B規格書_v1.html`（v1.3 定稿）**；任務板：`TASKS-B.md`。

## 運行方式

建議以本機靜態伺服器開啟（`file://` 直開也可跑，但 MC 預跑 Worker 會自動回退主執行緒）。普通 `<script>` 串接，無 ES Modules、無建置、無依賴。

- `index.html` — 遊戲主頁（B05-R3 下注 UI＋B06 路子＋B07 演出）
- `sim.html` — 數值驗證頁（B03/B04）

## 檔案分界（重要：任務並行的所有權約定）

本 HTML 版定位為**原型**，正式版可能轉 Cocos / Unity。

| 檔案 | 定位 | 所屬任務 | 轉引擎時 |
|---|---|---|---|
| `js/round-engine.js` | 可移植：40 秒同步輪次狀態機＋牆鐘對時＋回補；內含賽果供給 STUB | B02（B05-R2 調 25s/40s 設定值） | 邏輯照搬；把牆鐘推導換成後台推送 |
| `js/adapter-b.js` | 半可移植：接口轉接層（局號牆鐘為準、種子雙流、賽果紀錄流、Worker 排程）；真後台上線時整層替換 | B05 | 換成真後台 SDK |
| `js/mc-worker.js` | 拋棄式：MC 預跑 Web Worker（importScripts 可移植層，同種子逐 bit 一致；不可用自動回退） | B07 | 後台出賠率即不需要 |
| `js/race-fx.js` | 拋棄式：10 秒賽事演出（結果反推編排、出包喜劇、頒獎）；`Q11_GAGS` 為停用存查的專屬出包提案 | B07 | 畫面重做（編排公式可參考） |
| `js/tables-b.js` | 可移植：動物資料表、數值表 | **B03（勿在 B02 動）** | 邏輯照搬 |
| `js/mock-server-b.js` | 可移植：§5.2 聯合分佈賽果生成＋蒙地卡羅賠率 | **B03（勿在 B02 動）** | 換成真後台 |
| `js/roads.js` | 可移植：二元投影＋路子演算法（精確勝率冷熱判定、大路/衍生路、換靴分段；零 DOM 純函式） | B06 | 邏輯照搬 |
| `js/roads-ui.js` | 拋棄式：路子渲染與互動（總覽嵌入/詳細頁/點珠詳情彈窗/當靴回補編排＋localStorage 持久化 `gbr_b06_roads`） | B06 | 畫面重做 |
| `js/game.js` | 拋棄式：骨架 UI 綁定＋localStorage 轉接器 | B02（B05 起重排） | 畫面重做 |
| `index.html` | 拋棄式 | B02（B05 起重排） | 重做 |

script 載入順序固定：`tables-b → adapter-b → mock-server-b → roads → round-engine → roads-ui → game`（round-engine 偵測到全域 `MockServerB` 即自動棄用內建 STUB；adapter-b 必須先於 mock-server-b，見 index.html 註）。路子歷史＝開機時由 adapter-b 賽果紀錄流以「局號種子決定性重放」補齊當靴全量（升冪重放保 stats20 時序；歷史局賠率以低 MC 重估，賽果向量逐位一致）。

## 輪次引擎設計（B02 核心）

**輪次不是「跑出來的」，是「從牆鐘算出來的」。** 全服同步輪次的本質是時刻表：以固定錨點 `EPOCH` 對 `Date.now()` 取模，隨時推導出「第幾局、什麼階段、剩幾毫秒」──

```
round_no = floor((now − EPOCH) / 40000) + 1
betting 0–25s → locked 25–27s → racing 27–37s → settled 37–40s
（B05-R2 起：下注 25s、總循環 40s；round-engine.js 頭註若仍寫 30s 屬舊文，以設定值為準）
```

由此天然成立三件事：

1. **輪次不因玩家而停**：沒人下注照樣開、照樣記錄（§2）。
2. **重整＝對時**：重新推導即接回當前局當前階段；同步輪次的重連不是還原個人狀態（§10.3）。
3. **休眠免疫**：分頁被節流、電腦睡著，醒來一次回補漏掉的局，輪次編號與歷史必然連續。

搭配**以局號為種子的決定性 RNG**（mulberry32）：同一局號永遠抽出同一場比賽，所有裝置、重整前後看到同一賽果──單機即模擬「全服同一場比賽」。B03 的 mock-server 沿用引擎注入的同款 RNG 即保有此性質。

賽果在進入 `locked` 當下一次抽定（§5.2 一次抽出完整向量），演出階段僅播放（§10.3 結算/演出分離）。結算段預生成下一局並發 `next_preview`（§2 揭示）。

## 契約接點（B03 對接處）

引擎期望供給層（全域 `MockServerB`）提供三個純函數，形狀依規格書 §10.4：

```
generateRound(round_no, rng, history) → round 封包
generateOutcome(round, rng)           → outcome 向量
settle(bets, round, outcome)          → { payouts, total_payout }
```

未就位前由 `round-engine.js` 內建 `StubProvider` 代打（含 §5.2 順序的簡化實作與 3000 次小樣本佔位賠率；**非 §6.2 要求的 ≥100 萬輪反推**，數值不可當真）。

## 持久化（localStorage `gbr_b05r2_save`＋路子 `gbr_b06_roads`）

錢包、當局注單、已結注單（近 50）、設定、輪次歷史（近 200，對應 §7.7 一靴）。同局內重整注單保留（後台記得你的注）；離線期間掛單的局於回補時照常結算。

## 功能狀態

- 完成：B02 輪次引擎（40 秒循環）、B03 賽果生成與 MC 賠率（100 萬輪）、B04 數值驗證（RTP 95/95/94/94）、B05 下注 UI（三輪修訂：25s 窗、點卡成注、Kenney CC0 素材、名冊小馬/阿猴/樹懶）、B06 路子四頁籤就地切換
- 待驗收：B07 賽事演出（結果反推編排、出包喜劇、MC Worker 化；R2 字級加大＋Q11 暫緩套 ZZZ 佔位）
- 待辦：B08 結算氛圍（派彩動畫、他人下注流、勝負 log 頁）→ B09 整合驗收與 GitHub Pages 部署
