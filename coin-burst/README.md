# 爆金連鎖｜HTML Demo

點一格丟一枚幣，疊到 4 枚就炸開、往四邊各噴 1 枚，隔壁滿了跟著炸；**噴出盤面的都是你的**。每丟一枚＝一注（注額＝面額 100／500／1,000），盤面會留著、每個面額各一張；天降幣、鑽石、皇冠是加料。RTP 96.91%（`node test/mc-test.js` 驗過）。手機直式 375×812。

## 運行方式

零依賴、零建置、無 ES Modules、無 Web Worker、無 fetch，普通 `<script>` 串接。

- 雙擊 `index.html`（`file://` 直開）即可遊玩，資料存在瀏覽器 localStorage。
- 數值自測：`node test/mc-test.js [N]`（Node 20+，無需套件）；核心單元回歸：`node test/core-test.js`（PASS 72／FAIL 0）。
- 起始盤面：`node test/find-start.js`（固定種子搜尋，`--write` 才寫回 `values.js`）。

## 玩法與介面

| 東西 | 說明 |
|---|---|
| 點格子 | 丟一枚（＝下注）；第一次進場只有一格發光可點，其他變暗 |
| 疊 3 枚的格子 | 金色底＝快滿；相鄰兩格都快滿＝中間連起來、會一起炸 |
| 寶物（鑽石／皇冠） | 停在盤上時有箭頭指它下次往哪邊走；被擠出盤面才兌現 |
| 天降 | 每注 1/7 機率，玩家那一枚結算完再掉一枚免費普通幣到隨機一格（玫紅色） |
| 面額分頁 | 換面額＝換一張盤面 |
| 速度鈕（雙箭頭） | 普通／高速（約 0.6 倍時間），存 `burst.speed` |
| 自動 | 局數／停利／停損三項。每局自動選格：有疊 3 枚的格子就從中隨機挑一格，沒有就 25 格隨機一格（固定規則，不給選）；沿用目前面額與速度；到局數、達停利或停損、餘額不足會停；重整頁面也會中止；進行中手點格子與換面額會被擋 |
| 紀錄 | 一注一筆、最近 50 筆；詳細頁有丟在哪格、丟的是什麼、連爆幾格、噴出什麼、有沒有天降；底列「重置錢包」二段確認（錢包 10,000、三張盤面回起始、紀錄清空） |

## 網址參數

| 參數 | 作用 |
|---|---|
| `?dev=1` | 導演台（頂欄中間的小鈕展開）：下一枚是金幣／鑽石／皇冠、下一注有無天降（可指定落點）、＋1,000、重置錢包、填滿盤面、取消預約。預設網址不出現，`DEMO.dev`／`DEMO.game`／`DEMO.shots` 都是空的 |
| `?shot=<名>` | 截圖自動駕駛，跑 `DEMO.shots[名]`，完成設 `window.__shotReady`；此模式不讀寫 localStorage。主畫面：`idle`／`first`／`chain`／`win`／`big`／`huge`／`sky`／`gem`／`denom`（另有 `gem-mid`、`seq-press`、`seq-exit`、`seq-1…6`）；接線：`auto-modal`／`auto-run`／`log-list`／`log-detail` |
| `?vw=375` | 鎖 app 寬 375 並靠左（桌面瀏覽器檢視用） |
| `?lang=<code>` | 介面語言；`?lang=xx` 為偽語系（每字串加長 30%，版面壓力測試），其他代號會記進 localStorage |

頁面對外訊號（工具靠這些判斷）：`window.__demoReady`（可操作）、`window.__shotReady`（可截圖；沒帶 `?shot` 時等於 `__demoReady`）、`window.DEMO`（`shots`／`t`／`ui`／`wire`／`ls`；`game`／`dev` 只在 `?dev=1`／`?shot=` 才有）。契約全文見 `demo-kit/CONTRACT.md`。

連爆類截圖與探針要用 `--jobs 1`（無頭瀏覽器的背景分頁會把 setTimeout 壓慢，平行跑會逾時）；要用 `DEMO.game` 的探針得帶 `--query dev=1`。

## script 載入順序（固定）

`values.js → js/env.js → js/strings.js → js/toast.js → js/core.js → js/drag-scroll.js → js/log-ui.js → js/autobet.js → js/art.js → js/fx.js → js/ui-main.js → js/wire.js → js/dev.js`

- `values.js` 最先（只有 `EV`、`DEMO_KEY`，零依賴）；`env.js` 建 `DEMO` 命名空間與 `DEMO.ls`，之後每支都靠它。
- `strings.js` 必須早於所有 UI 檔（它在載入當下把骨架的 `data-t` 填好）。
- `core.js` 只依賴 `values.js`（Node 測試即 eval 這兩支）。
- `log-ui`／`autobet` 彼此不認識玩法；`ui-main.js` 建主畫面與 `DEMO.ui`，`wire.js` 把兩個模組接到 `DEMO.ui`／核心，`dev.js` 最後載入（導演台、截圖駕駛、預設網址收尾）。
- 樣式：`css/base.css` 最先（變數與疊層順序表），其餘模組樣式在後；`css/wire.css` 蓋過這款需要的差異。`onboard.js`／`onboard.css` 這款不用（不做教學），檔案保留、不引用。

## 檔案分界（轉引擎時的所有權約定）

「可移植」層是邏輯資產，「拋棄式」層是畫面。

| 檔案 | 定位 | 轉引擎時 |
|---|---|---|
| `values.js` | **可移植・凍結**：數值單點（CFG→賠率全表由程式導出、禁手改單點） | 常數與公式即規格，照搬 |
| `js/core.js` | **可移植・凍結**：零 DOM 核心——錢包、每個面額一張盤面、下注契約（先抽定→emit result→ack 才結算）、注單號、存檔與重整接回、可注入 rng。規則全部呼叫 `values.js` | 邏輯照搬；rng 與持久化換成後台 |
| `js/strings.js` | **可移植**：字串字典＋`t()`（含自動／紀錄／導演台的字）、偽語系 | 文案整包照搬，只換取字介面 |
| `js/env.js` | 半可移植：`DEMO` 命名空間、網址參數、`DEMO.ls` 存檔 helper | 換成引擎的環境與存檔層 |
| `test/*` | 半可移植：mc-test（Node 無頭蒙地卡羅）、core-test（核心單元回歸）、find-start（起始盤面搜尋） | 改寫為 CI 腳本 |
| `js/drag-scroll.js` | 拋棄式（通用工具）：滑鼠拖曳滾動 | 引擎的 ScrollView 取代 |
| `js/autobet.js`＋`css/autobet.css` | 拋棄式（**不認識玩法**，吃 adapter）：入口→設定彈窗→進行中浮條；停止條件可沿用 | 畫面重做；流程規則（局數／停利／停損／餘額不足／重整中止）照搬 |
| `js/log-ui.js`＋`css/log-ui.css` | 拋棄式（**公司定死規格，勿改設計**）：總覽＋詳細頁＋回報鈕＋錢包重置，封頂 50 筆 | 畫面重做，資料接後台 |
| `js/wire.js`＋`css/wire.css` | 拋棄式：自動下注 adapter（**自動選格規則在這裡**）、紀錄詳細頁內容與補記 | 選格規則與詳細頁欄位照搬；畫面重做 |
| `js/art.js`／`js/fx.js` | 拋棄式：金幣、鑽石、皇冠、盤面的程式畫（SVG→CSS 背景圖）；演出用的虛擬時間軸 | 換成正式美術與引擎動畫 |
| `js/ui-main.js`＋`css/base.css` | 拋棄式：主畫面與演出（壓→彈→飛→落、收集槽、分級回饋）、`DEMO.ui` | 畫面重做（節拍與分級門檻照搬） |
| `js/toast.js` | 拋棄式：toast | 重做 |
| `js/dev.js` | 拋棄式：導演台（只走核心的 `armNext`、`addMoney`）＋`DEMO.shots` 自動駕駛表 | 不進產品 |
| `index.html` | 拋棄式：骨架與掛點 | 重做 |

## 疊層順序（z-index，定死）

引導 50（這款不用）＞ toast 45 ＞ log 頁 36 ＞ 設定彈窗 35 ＞ 暗幕 34 ＞ 自動下注槽 33 ＞ 導演台 32 ＞ 遊戲主體。

## localStorage key 表

所有 key 一律 `burst.<名>`（避免多個 demo／多面板互相汙染）；`?shot=` 模式一律不讀不寫。

| key | 內容 |
|---|---|
| `burst.core` | 核心狀態：錢包、每個面額的盤面與「丟過了」旗標、注單（留 200 筆）、進行中一單（演出中重整＝直接結算） |
| `burst.log` | 勝負紀錄（UI 層，封頂 50 筆） |
| `burst.autocfg` | 自動下注上次的設定 |
| `burst.auto` | 自動下注進行中旗標（重整即中止並 toast 提示） |
| `burst.first` | 第一次進場的發光格丟過了（重置錢包會清掉，發光格之後會再出現一次） |
| `burst.speed` | 速度：`normal`／`fast` |
| `burst.lang` | 介面語言代號（預設 `zh-TW`；`?lang=` 會覆蓋並記住） |

## 數值紀律（改東西前先讀）

- **禁手改單點**：所有賠率、上限都由 `values.js` 的 `CFG` 推導；其他檔案嚴禁硬編碼賠率或機率。
- **嚴禁暗改機率 p**（抽獎與賠率都吃它）；要調 RTP 只准動賠率表。
- 結果先由核心抽定，UI 只負責演；演完 `ack()` 才結算。導演台只包 rng／指定下一注，不動核心。
- 自動選格只看盤面上每格幾枚，不預看結果、不用核心 rng。
- 金額全部整數（Demo）。
- 效能紅線：所有 transition／animation 只動 `transform`／`opacity`；禁 `filter`；陰影靜態。目標裝置含舊手機。
- 零捲軸：#app 任何狀態 `scrollWidth/Height` 都不得大於 `clientWidth/Height`——待命的彈窗／頁面不可用 translate 推到 #app 外，改用 `opacity`＋小幅 `scale` 淡入。
- 所有面向玩家的字串走 `t()`，做新字串後跑一次 `?lang=xx` 看有沒有破版。

## Demo 補充假設

- 後台、錢包、注單號、時間皆為本地模擬：注單號由前綴＋時間＋流水號組成，不是真後端單號；亂數用瀏覽器的 `Math.random`，不是後台抽獎。
- 「回報」鈕只 toast，不會真的送出。
- 錢包與 log 存在瀏覽器 localStorage，清除瀏覽器資料即歸零。
- 金額全部整數；正式版要讓玩家輸入金額、支援小數。
- 面額 100／500／1,000 為暫定；起始錢包 10,000 是假的。
- 美術（金幣、鑽石、皇冠、盤面）全部程式畫的佔位，沒有外部圖；沒有音效。
- 自動下注的停利／停損／局數選項是 Demo 暫定值；自動選格規則是用戶定案（有疊 3 枚的格子就丟其中一格、沒有就隨機）。
- 導演台（`?dev=1`）與 `?shot=` 只為了測試與截圖，不進正式版。
