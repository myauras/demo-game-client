# 精準射擊 / Precision Shot

依 Google 試算表「精準射擊」分頁製作的獨立 H5 遊戲 demo。

## 開啟

直接用 Chrome、Edge、Firefox 或 Safari 開啟 `index.html` 即可。無套件安裝、無後端、無網路資源依賴；支援桌機與手機。若用 HTTP 預覽，可在此資料夾執行 `node serve.cjs`，瀏覽 http://localhost:5187。

## 來源規格

https://docs.google.com/spreadsheets/d/1xUDoHdrmYn3xl0gpig5PwZveQumyH6IyaVh-klKL-KA/edit?usp=sharing

Lucky Time 規格：
https://docs.google.com/spreadsheets/d/1DKcSM26yJXYzpZuIh48iy5-mf1cACXSbudMEUS5VUc0/edit?gid=784810203#gid=784810203

- 選擇難度、子彈數與投注，開始後表演拿槍射擊人形標靶。
- 總投注 = 單發投注 × 子彈數；每發獎勵 = 單發投注 × 命中倍率。
- 簡單倍率：0.5×、2×、5×、10×。
- 中等倍率：0.2×、3×、10×、50×。
- 困難倍率：0×、10×、100×、1000×。

## Demo 補充假設

來源未指定以下內容，此 demo 自行補上，並在玩法說明中揭露：

- 四種倍率對應外圈、中圈、內圈、靶心。
- 基礎射擊 RTP 為 90%；Lucky Time 額外獎勵納入模型後，三種難度與 1、2、3、5、10、20 發的理論 RTP 均為 95%。
- 簡單命中機率約為 77.8667%、20.0333%、2%、0.1%。
- 中等命中機率約為 76.5857%、22.8943%、0.5%、0.02%。
- 困難命中機率約為 92.395%、7.5%、0.1%、0.005%。
- 每發射擊前，若沒有 Lucky Time，依難度與子彈數的固定設定判定是否觸發；同時最多一個 Lucky Zone。
- Lucky Zone 依可配置權重選擇，倍率圈內整區以淡金色高亮並顯示 ×2；LUCKY TIME 特殊字會保留到 Lucky Zone 消失。射中其他區域不會消耗；射中該區才觸發 Lucky Hit，該發倍率 ×2 並留下金色彈孔，彈孔上方只顯示本發 `+獎勵`。
- Lucky Hit 後若仍有子彈，下一發起可再次觸發 Lucky Time；未命中的 Lucky Zone 於回合結束淡出，不跨局且不提供補償。
- 下注後自動連射，瞄準與彈孔是結果演出，不是滑鼠技巧射擊。
- 所有子彈數的第一發使用約 0.45 秒準心移動瞄準並配合舉槍。2、3、5、10、20 發後續以約 0.3 秒快速連發，準心直接跳至新彈孔位置。
- Lucky Time 首次出現會先停頓 0.18 秒，再播放 0.52 秒進場；Lucky Hit 額外演出 0.5 秒，命中時 LUCKY TIME 特殊字會先放大再縮小。Lucky Zone 消失時只做透明度淡出，不縮小；未命中的 Lucky Zone 於局末以 0.3 秒淡出。
- 初始模擬點數 10,000；單發整數投注 1～1,000；子彈 1、2、3、5、10、20 發，預設 1 發。
- 開局一次扣除總投注，每發完成即派獎。回合中鎖定投注設定及重設。
- 重整頁面或右上角重設會清除記憶體內進度，恢復模擬點數。
- 無真實金流、帳號或資料儲存。音效預設關閉；目前簡潔介面隱藏音效控制。

## 檔案

- `index.html`：介面與遊戲說明。
- `style.css`、`layout.css`：基礎樣式與直式簡潔配置。
- `game-math.js`：正式遊戲與 Simulation 共用的落點、Lucky Time 與派獎模型。
- `game.js`：點數計算、逐發流程、Canvas 靶場與 Web Audio 音效。
- `rtp-simulation.cjs`：各難度與各子彈數的獨立 RTP Simulation，至少支援 1,000,000 局。
- `serve.cjs`：僅監聽本機的可選靜態預覽伺服器。

僅新增本資料夾，不引用其他遊戲的程式、依賴或資產。

UI 更新：灰底人形同心環標靶，下方集中投注控制。難度與子彈點擊後向上展開選項，支援鍵盤方向鍵與 Escape；單發投注可減半或加倍。

