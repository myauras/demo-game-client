# 三選一冒煙｜HTML Demo

> 這是 demo-kit 的空白底板。新建 demo 時由 `tools/new-demo.mjs` 複製本資料夾並替換記號 `三選一冒煙`（顯示名）、`kitsmoke`（localStorage 前綴與命名空間短名）。
> 底板自帶一個最小範例玩法「三選一押注」（押 A／B／C，各有機率 p，賠率＝RTP÷p）讓它能玩、能測；**新 demo 會把範例整個換掉**（檔頭、字典、測試都標了「範例，換掉」）。

一句話說明：押 A／B／C 其中一個，開中就拿「押額×賠率」（A 1.92x／B 3.2x／C 4.8x），RTP 0.96。demo-kit 流程測試用。

## 運行方式

零依賴、零建置、無 ES Modules、無 Web Worker、無 fetch，普通 `<script>` 串接。

- 雙擊 `index.html`（`file://` 直開）即可遊玩，資料存在瀏覽器 localStorage。
- 數值自測：`node test/mc-test.js [N]`（Node 20+，無需套件；預設每項 200000 局，約 5 秒）。記號沒替換也能跑。

## 網址參數

| 參數 | 作用 |
|---|---|
| `?dev=1` | 導演台（強制下一局結果、重置錢包、加錢）。預設網址不出現 |
| `?shot=<名>` | 截圖自動駕駛，跑 `DEMO.shots[名]`，完成設 `window.__shotReady`；此模式不讀寫 localStorage。內建：`idle`／`result`／`auto-modal`／`auto-run`／`log-list`／`log-detail`／`tut-1` |
| `?vw=375` | 鎖 app 寬 375 並靠左（桌面瀏覽器檢視用） |
| `?lang=<code>` | 介面語言；`?lang=xx` 為偽語系（每字串加長 30%，版面壓力測試），其他代號會記進 localStorage |
| `?tut=1｜0` | 強制重播／關閉首次引導 |

頁面對外訊號（工具靠這些判斷）：`window.__demoReady`（可操作）、`window.__shotReady`（可截圖；沒帶 `?shot` 時等於 `__demoReady`）、`window.DEMO`（`game`／`shots`／`t`／`ui`／`dev`／`q`／`ls`）。契約全文見 `demo-kit/CONTRACT.md`。

## script 載入順序（固定）

`values.js → js/env.js → js/strings.js → js/toast.js → js/core.js → js/drag-scroll.js → js/log-ui.js → js/autobet.js → js/onboard.js → js/ui-main.js → js/dev.js`

- `values.js` 最先（只有 `EV`、`DEMO_KEY`，零依賴）；`env.js` 建 `DEMO` 命名空間與 `DEMO.ls`，之後每支都靠它。
- `strings.js` 必須早於所有 UI 檔（它在載入當下把骨架的 `data-t` 填好，其餘 UI 檔取字時字典要先在）。
- `core.js` 只依賴 `values.js`（Node 測試即 eval 這兩支）。
- `log-ui`／`autobet`／`onboard` 彼此不認識玩法，由 `ui-main.js` 接線；`dev.js` 最後載入（要拿到 `DEMO.game`／`DEMO.ui`）。
- 樣式：`css/base.css` 最先（變數與疊層順序表），其餘模組樣式在後。

## 檔案分界（轉引擎時的所有權約定）

「可移植」層是邏輯資產，「拋棄式」層是畫面。

| 檔案 | 定位 | 轉引擎時 |
|---|---|---|
| `values.js` | **可移植・凍結**：數值單點（CFG→賠率全表由程式導出、禁手改單點） | 常數與公式即規格，照搬 |
| `js/core.js` | **可移植・凍結**：零 DOM 核心——錢包、下注契約（先抽定→emit result→ack 才結算）、注單號、存檔與重整接回、可注入 rng。換玩法只改檔內 `RULES` | 邏輯照搬；rng 與持久化換成後台 |
| `js/strings.js` | **可移植**：字串字典＋`t()`（含 autobet／log／onboard／導演台的字）、偽語系 | 文案整包照搬，只換取字介面 |
| `js/env.js` | 半可移植：`DEMO` 命名空間、網址參數、`DEMO.ls` 存檔 helper | 換成引擎的環境與存檔層 |
| `test/mc-test.js` | 半可移植：Node 無頭蒙地卡羅＋單元回歸 | 改寫為 CI 腳本 |
| `js/drag-scroll.js` | 拋棄式（通用工具）：滑鼠拖曳滾動 | 引擎的 ScrollView 取代 |
| `js/autobet.js`＋`css/autobet.css` | 拋棄式（**不認識玩法**，吃 adapter）：⟳ 入口→設定彈窗→進行中浮條；停止條件與設定項可沿用 | 畫面重做；流程規則（局數／停利／停損／餘額不足／重整中止）照搬 |
| `js/log-ui.js`＋`css/log-ui.css` | 拋棄式（**公司定死規格，勿改設計**）：總覽＋詳細頁＋回報鈕＋錢包重置，封頂 50 筆 | 畫面重做，資料接後台 |
| `js/onboard.js`＋`css/onboard.css` | 拋棄式：常駐一句提示＋首次多步聚光引導＋log 頁重看入口；步驟與文案可沿用 | 畫面重做 |
| `js/toast.js` | 拋棄式：toast | 重做 |
| `js/ui-main.js`＋`css/base.css` | 拋棄式（**範例，換掉**）：範例玩法畫面與演出、模組接線（autobet adapter、log record、引導步驟） | 畫面重做（接線方式可參考） |
| `js/dev.js` | 拋棄式：導演台（只包 rng，不動核心與 RTP）＋`DEMO.shots` 自動駕駛表 | 不進產品 |
| `index.html` | 拋棄式：骨架與掛點 | 重做 |

## 疊層順序（z-index，定死）

引導 50 ＞ toast 45 ＞ log 頁 36 ＞ 設定彈窗 35 ＞ 暗幕 34 ＞ 自動下注槽 33 ＞ 導演台 32 ＞ 遊戲主體。

## localStorage key 表

所有 key 一律 `kitsmoke.<名>`（避免多個 demo／多面板互相汙染）；`?shot=` 模式一律不讀不寫。

| key | 內容 |
|---|---|
| `kitsmoke.core` | 核心狀態：錢包、注單（留 200 筆）、進行中一單（演出中重整＝直接結算） |
| `kitsmoke.log` | 勝負紀錄（UI 層，封頂 50 筆） |
| `kitsmoke.autocfg` | 自動下注上次的設定 |
| `kitsmoke.auto` | 自動下注進行中旗標（重整即中止並 toast 提示） |
| `kitsmoke.tut` | 首次引導看完或跳過的旗標（`'done'`）；清掉即恢復首次進場引導，或在 log 頁按「重看教學」 |
| `kitsmoke.lang` | 介面語言代號（預設 `zh-TW`；`?lang=` 會覆蓋並記住） |
| `kitsmoke.stake` | （範例玩法）上次選的單注 |

錢包重置在勝負紀錄頁底列，二段確認；`?dev=1` 導演台也有一顆。

## 數值紀律（改東西前先讀）

- **禁手改單點**：所有賠率、上限都由 `values.js` 的 `CFG` 推導；其他檔案嚴禁硬編碼賠率或機率。
- **嚴禁暗改機率 p**（抽獎與賠率都吃它）；要調 RTP 只准動賠率表（`CFG.RTP`）。
- 結果先由核心抽定，UI 只負責演；演完 `ack()` 才結算。導演台只包 rng，不動核心。
- 顯示值 2 位無條件捨去、結算取整一次（先四捨到 1e-6 吃浮點雜訊再捨去），實付恆 ≥ 顯示值。
- 防套利：任意押注組合 EV ≤ 1、無保證獲利（`mc-test` D 區窮舉驗）。
- 效能紅線：所有 transition／animation 只動 `transform`／`opacity`；禁 `filter`；陰影靜態。
- 零捲軸：#app 任何狀態 `scrollWidth/Height` 都不得大於 `clientWidth/Height`——**待命的彈窗／頁面不可用 translate 推到 #app 外**（會撐大 scrollWidth，檢查會誤報），改用 `opacity`＋小幅 `scale` 淡入（`visibility` 隨淡出延遲切換）。
- 所有面向玩家的字串走 `t()`，做新字串後跑一次 `?lang=xx` 看有沒有破版。

## Demo 補充假設


- 後台、錢包、注單號、時間皆為本地模擬：注單號由前綴＋時間＋流水號組成，不是真後端單號。
- 「回報」鈕只 toast，不會真的送出。
- 錢包與 log 存在瀏覽器 localStorage，清除瀏覽器資料即歸零。
- 範例玩法的選項、機率、賠率、演出都是示意，新 demo 整個換掉。
- 沒有任何美術圖檔與音效：卡片、底色、圖示全是 CSS 與文字。
