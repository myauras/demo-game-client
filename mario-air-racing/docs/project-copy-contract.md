# mario-air-racing 的複製基準

本機版本源自[原站](https://strata-flight-atlas.scozirge.chatgpt.site/)第 15 版，來源 commit 為 `97190f3a513d46723c7ecfeeb50842e5ca96daa6`。取回時來源工作樹乾淨。目標 `demo-game-client` 當時的 HEAD 為 `97bcf072393f223b10f527dad1ee34898c3a3acd`，遊戲目錄是新增的本機副本。

## 入口與邊界

原版的作用中入口為 `dist/index.html`。畫面、Three.js、模型、字型、賽道、錢包與結算都由該檔提供。原版沒有 Cocos Prefab 或 Server adapter。此本機副本省略原站的部署識別。移植時保留來源授權文字，驗證實際 HTML 與原始檔一致。

## 可重現的驗證

以 `node tests/rtp.cjs` 驗證當前入口。來源版本 3–6 的測試在原站 checkout 與剛複製的專案均通過，每款塗裝各 95% RTP、上限 100×。第 6 版每台飛機有 1,108 / 10,240 種結果在飛行至少 10 秒後仍以 0× 結算。

調整這個遊戲的玩法時，新增規則版本以保留未完成舊局的結算。測試需涵蓋每一條賽道、每一種機位配置及所有可選飛機，使用正式入口相同的選機對應與整數倍率。瀏覽器另驗證選機、下注、倍率顯示與實際點數結算。
