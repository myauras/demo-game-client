# 空投爭奪｜HTML Demo

一句話說明：選一個落點（綠／藍／紫／金）跳傘，只有你一個人落在那裡才拿得到物資、開箱再乘一次倍率；跟機器人撞在同一點就歸零。RTP 96%（不靠暗改機率）。

## 怎麼開

零依賴、零建置、無 ES Modules、無 Web Worker、無 fetch，普通 `<script>` 串接。

- 雙擊 `index.html`（`file://` 直開）即可玩，資料存在瀏覽器 localStorage。
- 手機直式 375×812；桌面瀏覽器開會等比顯示成一個手機大小。
- 數值自測：`node test/mc-test.js [N]`（Node 20+，無需套件；預設每項 200000 局，約 20 秒，現為 PASS 52／FAIL 0）。

## 網址參數

| 參數 | 作用 |
|---|---|
| `?dev=1` | 導演台（頁面上方一列）：結果「照機率／強制獨佔／強制撞車」、箱子「照機率／軍用×1／精良×1.5／稀有×2／傳說×5」（兩個下拉持續生效，直到切回照機率）、**🏆 大獎**（一鍵：金點獨佔＋傳說箱，立刻開一局看爆金幣）、爆金幣 開／關、重置錢包、＋1,000。只包亂數、不動核心；不帶 `?dev=1` 時頁面上完全看不到，`DEMO.dev` 是 `undefined` |
| `?shot=<名>` | 截圖自動駕駛，跑 `DEMO.shots[名]`，完成設 `window.__shotReady`；此模式不讀寫 localStorage、亂數固定種子。名單：`idle`／`lock`／`reveal`／`win`／`bigwin`／`crash`／`auto-modal`／`auto-run`／`log-list`／`log-detail`／`log-detail-crash`／`tut-1`／`tut-2`／`tut-3`／`recent` |
| `?vw=375` | 鎖 app 寬 375 並靠左（桌面瀏覽器檢視用） |
| `?lang=<code>` | 介面語言；`?lang=xx` 為偽語系（每字串加長 30%，版面壓力測試），其他代號會記進 localStorage |
| `?tut=1｜0` | 強制重播／關閉首次引導 |

頁面對外訊號（工具靠這些判斷）：`window.__demoReady`（可操作）、`window.__shotReady`（可截圖；沒帶 `?shot` 時等於 `__demoReady`）、`window.DEMO`（`game`／`shots`／`t`／`ui`／`q`／`ls`；`dev` 只在 `?dev=1`）。

截圖與驗證：`node <demo-kit>/tools/shot.mjs --root game --out <資料夾> --timeout 40000 --shots <上面名單>`（`log-list` 等要先連玩幾局，用 `--timeout 40000` 留餘裕；偽語系加 `--query "lang=xx"`）。

## script 載入順序（固定）

`values.js → js/env.js → js/strings.js → js/toast.js → js/core.js → js/drag-scroll.js → js/log-ui.js → js/autobet.js → js/onboard.js → js/ui-main.js → js/dev.js → js/recent.js`

- `values.js` 最先（只有 `EV`、`DEMO_KEY`，零依賴）；`env.js` 建 `DEMO` 命名空間與 `DEMO.ls`，之後每支都靠它。
- `strings.js` 必須早於所有 UI 檔（它在載入當下把骨架的 `data-t` 填好，其餘 UI 檔取字時字典要先在）。
- `core.js` 只依賴 `values.js`（Node 測試即 eval 這兩支）。
- `log-ui`／`autobet`／`onboard` 彼此不認識玩法，由 `ui-main.js` 接線；`dev.js` 在 `ui-main.js` 之後（要拿到 `DEMO.game`／`DEMO.ui`）；`recent.js` 最後，`ui-main` 會等它出現再掛近況列。
- 樣式：`css/base.css` 最先（變數與疊層順序表），其餘模組樣式在後。

## 檔案分界（轉引擎時的所有權約定）

「可移植」層是邏輯資產，「拋棄式」層是畫面。

| 檔案 | 定位 | 轉引擎時 |
|---|---|---|
| `values.js` | **可移植・凍結**：數值單點（CFG→賠率全表由程式導出、禁手改單點） | 常數與公式即規格，照搬 |
| `js/core.js` | **可移植・凍結**：零 DOM 核心——盤面先公告、結果先抽定、錢包、下注契約（bet→emit result→ack 才結算）、注單號、存檔與重整接回、可注入 rng | 邏輯照搬；rng 與持久化換成後台 |
| `js/strings.js` | **可移植**：字串字典＋`t()`（含 autobet／log／onboard／導演台的字）、偽語系 | 文案整包照搬，只換取字介面 |
| `js/env.js` | 半可移植：`DEMO` 命名空間、網址參數、`DEMO.ls` 存檔 helper | 換成引擎的環境與存檔層 |
| `test/mc-test.js` | 半可移植：Node 無頭蒙地卡羅＋端到端單元回歸（52 項） | 改寫為 CI 腳本 |
| `js/autobet.js`＋`css/autobet.css` | 拋棄式（**不認識玩法**，吃 adapter）：入口→設定彈窗→進行中狀態條；停止條件與設定項可沿用 | 畫面重做；流程規則（局數／停利／停損／餘額不足／重整中止）照搬 |
| `js/log-ui.js`＋`css/log-ui.css` | 拋棄式（**公司定死規格，勿改設計**）：總覽＋詳細頁＋回報鈕＋錢包重置，封頂 50 筆 | 畫面重做，資料接後台 |
| `js/onboard.js`＋`css/onboard.css` | 拋棄式：常駐一句提示＋首次三步聚光引導＋log 頁「重看教學」 | 畫面重做，步驟與文案可沿用 |
| `js/recent.js`＋`css/recent.css` | 拋棄式：近況列（每局最高獨佔落點，一排 12 顆、最新在右） | 畫面重做，資料讀注單的 `topSoloPoint` |
| `js/drag-scroll.js`、`js/toast.js` | 拋棄式（通用工具） | 引擎元件取代 |
| `js/ui-main.js`＋`css/base.css` | 拋棄式：主畫面與演出（地圖、落點、封盤倒數、跳傘、揭曉、結果彈窗、大獎爆金幣）＋模組接線（autobet adapter、log 列、引導步驟、`DEMO.ui`／`DEMO.shots`） | 畫面重做（接線方式與演出時序常數可參考） |
| `js/dev.js` | 拋棄式：導演台（只包亂數，不動核心與 RTP）＋`?shot=` 分派 | 不進產品 |
| `index.html` | 拋棄式：骨架與掛點 | 重做 |

## 疊層順序（z-index，定死）

引導 50 ＞ toast 45 ＞ log 頁 36 ＞ 設定彈窗 35 ＞ 暗幕 34 ＞ 自動下注槽 33 ＞ 導演台 32 ＞ 遊戲主體（地圖內 ≤ 13）。

## localStorage key 表

所有 key 一律 `hotdrop.<名>`（避免多個 demo／多面板互相汙染）；`?shot=` 模式一律不讀不寫。

| key | 內容 |
|---|---|
| `hotdrop.core` | 核心狀態：錢包、目前公告的盤面、注單（留 200 筆）、進行中一單（演出中重整＝直接結算） |
| `hotdrop.log` | 勝負紀錄（UI 層，封頂 50 筆） |
| `hotdrop.autocfg` | 自動下注上次的設定 |
| `hotdrop.auto` | 自動下注進行中旗標（重整即中止並 toast 提示） |
| `hotdrop.tut` | 首次引導看完或跳過的旗標（`'done'`）；清掉即恢復首次進場引導，或在 log 頁按「重看教學」 |
| `hotdrop.lang` | 介面語言代號（預設 `zh-TW`；`?lang=` 會覆蓋並記住） |
| `hotdrop.stake` | 上次選的單注 |

錢包重置在勝負紀錄頁底列，二段確認；`?dev=1` 導演台也有一顆。

## 數值紀律（改東西前先讀）

- **禁手改單點**：賠率、獨佔率、箱子機率都由 `values.js` 的 `CFG` 推導；其他檔案嚴禁硬編碼。
- **嚴禁暗改機率 p**；要調 RTP 只准動賠率表（`CFG.RTP`）。
- 結果先由核心抽定，UI 只負責演；彈窗出現時 `ack()` 才結算。氛圍亂數（喊話、金幣、跳傘順序）與核心亂數完全分離，導演台只包亂數、`bet` 後立刻還原。
- 顯示值 2 位無條件捨去、結算取整一次，實付恆 ≥ 顯示值。
- 防套利：任意押注組合 EV ≤ 1、無保證獲利（`mc-test` D 區窮舉驗）。
- 效能紅線：所有 transition／animation 只動 `transform`／`opacity`；禁 `filter`；陰影靜態。目標裝置含舊手機。
- 零捲軸：#app 任何狀態 `scrollWidth/Height` 都不得大於 `clientWidth/Height`——待命的彈窗／頁面不可用 translate 推到 #app 外，改用 `opacity`＋小幅 `scale` 淡入。
- 所有面向玩家的字串走 `t()`，做新字串後跑一次 `?lang=xx` 看有沒有破版。
- 大獎爆金幣是獨立效果：門檻 `BIGWIN_MULT`（結果倍率 ≥ 5x）與開關 `BIGWIN_COINS` 在 `js/ui-main.js` 檔頭 [0] 區段；效果不好時把 `BIGWIN_COINS` 改成 `false`，金色彈窗與其他流程不變。

## Demo 補充假設（正式版不能照搬）

- **對手是本機機器人**，照固定公式（納許均衡混合策略）出手；結果在瀏覽器抽定（`Math.random`）。正式版必須由後台抽定並回傳整局結果；若改成真人對戰，賠率公式與整套數值都要重做。
- **對手喊話只是氛圍**：三個機器人各一句、與實際出手無關，封盤後隱藏，不代表任何真實意圖。
- **錢包、注單號、時間是本地模擬**：存瀏覽器 localStorage，清除瀏覽器資料即歸零；注單號由前綴＋時間＋流水號組成，不是真後端單號；「回報」鈕只 toast，不會真的送出。
- **取整**：派彩取整到整數，小注額有 1～3 個百分點的取整損失（用戶裁決 Demo 不處理，正式版錢由後台精度決定）。
- **單注輸入**：正式版是「輸入框＋自訂鍵盤」，Demo 只用四顆固定面額鈕（10／50／100／500）；自動下注的單注也只能選這四個面額。
- **自動下注**：只做「固定落點（或輪流）＋固定金額」，每局照新盤賠率；自動時省略封盤倒數、演出縮時、結果彈窗自動收起，但結算不跳過；進行中不接手動開局。
- **美術全為佔位，無音效**（畫面上有「佔位美術」小字）。佔位清單：
  - 落點圖示：🌿 綠、⚓ 藍、🔮 紫、👑 金；封盤中選中的落點換成 🪂。
  - 角色與道具：✈️ 飛機、🪂 傘兵、📦／🎁 箱子、🐺🦊🐻 三個機器人頭像、🧑「你」標籤、💥✨ 揭曉特效。
  - 地圖：自繪 SVG 俯視島嶼＋格線（`index.html` 內嵌）。
  - 大獎：CSS 畫的金幣與金光（約 20 顆小圓，只動 transform／opacity）。
  - 頂欄與按鈕：🪂 logo、📜 紀錄鈕、「⟳ 自動」鈕；箱子等級色與落點色為暫定。
- **物資候選與箱子機率／倍率、單注面額、大獎門檻 5x 是暫用建議值**，數值全在 `values.js`／`ui-main.js` 檔頭，可單點調整。
