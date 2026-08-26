# 烽火連環船｜HTML Demo

遊戲 A 的純本地 Demo。規格見上層《三款博弈遊戲企畫暨規則書_v2.md》§2、《遊戲A_Demo_開發計畫.md》。

## 運行方式

**直接雙擊 `index.html`** 即可（全部使用普通 `<script>` 串接，無 ES Modules、無建置、無依賴，`file://` 直開）。

- `index.html` — 遊戲主頁（直式手機外框，桌面瀏覽時置中）
- `sim.html` — RTP 模擬驗證頁（T03 實作）

## 檔案分界（重要）

本 HTML 版定位為**原型**，正式版可能轉 Cocos / Unity。

| 檔案 | 定位 | 轉引擎時 |
|---|---|---|
| `js/tables.js` | 可移植：三套倍率階梯，S_n = 0.96/M_n 程式反推 | 邏輯照搬 |
| `js/mock-server.js` | 可移植：後台契約（§5）本地實作、RNG、結果生成 | 邏輯照搬／換成真後台 |
| `js/game.js` | 混合：狀態流轉規則可帶走，UI/演出為拋棄式 | 規則照搬、畫面重做 |
| `index.html`、`sim.html` | 拋棄式 | 重做 |

規則：`tables.js`、`mock-server.js` 禁止引用任何畫面相關程式。

script 載入順序固定：`tables → mock-server → game`。

## 狀態

- T01 骨架完成：開頁自檢（右下角顯示「骨架自檢 OK」）
- 待辦：T02 Mock 後台實作 → T03 數值驗證 → T04 狀態機 → T05 UI …（見上層 TASKS.md）
