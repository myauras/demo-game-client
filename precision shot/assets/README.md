# 持槍素材

`rifle-olive.png` 使用內建 image_gen 編輯使用者提供的持槍圖，保留第一人稱步槍、手套與迷彩袖口，調整為靶場一致的深綠／橄欖色。圖片採深綠背景，介面以頂部遮罩銜接；不是透明 PNG。

初次提示：保留原圖持槍姿勢、構圖、比例與寫實細節；使用 #17221c、#303b2b、#48533a 深綠橄欖色調與克制的 #d5f580 反光，降低膚色橘感；背景去除，無文字。

最終修正提示：Precise edit: preserve the rifle, hands, sleeves, composition and olive color grading unchanged. Replace ALL the white gray checkerboard background with a smooth solid dark forest green color exactly #263426, also every gap between arms and rifle. Absolutely no checkerboard, no white areas, no transparency simulation. Output same landscape framing. This is a foreground game image on a dark green range; use solid dark forest green background.

新版 rifle-transparent.png：內建 imagegen 提示為保留槍、雙手與袖口，只移除全部背景。工具輸出仍含棋盤格，因此以連通背景辨識轉為透明 Alpha；已驗證 Format32bppArgb、背景及雙手空隙 Alpha=0。共移除 816515 個背景像素。

