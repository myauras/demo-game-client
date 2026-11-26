/* =========================================================================
 * 挑起始盤面的種子（不手排）。
 * 做法：固定種子從空盤隨機丟 400 枚，再用「挑最會爆」一枚一枚丟瘦；每丟一枚就檢查一次，
 * 第一次符合 EV.checkStart 的條件就記下（總枚數＝最低＋3、穩定循環盤面、發光格第一下噴 4 枚、
 * 連爆 ≥7 格、發光格不在邊上），另加偏好條件：連爆至少 4 波、爆完後有 ≥5 格疊 3 枚（給首次引導好看）。
 * 再從候選挑出 3 張（連爆格數多者優先、盤面互不相同、發光格盡量不同），對應 3 個面額。
 *
 * 用法：node game/test/find-start.js            列出候選與挑中的 3 張
 *       node game/test/find-start.js --write    並把種子寫回 values.js 的 CFG.START
 *       --seeds 20000                           掃描的種子數（預設 20000）
 * ========================================================================= */
const fs = require('fs'), path = require('path');
const { loadEV } = require('./sim-lib.js');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const EV = loadEV({ skipStartCheck: true });
const N = EV.N, DROPS = 400, MAXTHIN = 160, SEEDS = +arg('--seeds', 20000);

const found = [];
for(let seed = 1; seed <= SEEDS; seed++){
  const r = EV.rng(seed), b = EV.emptyBoard();
  for(let n = 0; n < DROPS; n++) EV.drop(b, Math.floor(r() * N), 'coin');
  for(let thin = 0; thin <= MAXTHIN; thin++){
    const c = EV.bestCell(b);
    if(c < 0) break;
    if(EV.total(b) === EV.START_TOTAL){
      const cs = EV.checkStart(b);
      if(cs.ok && cs.waves >= 4){
        const after = EV.cloneBoard(b); EV.drop(after, c, 'coin');
        const threes = after.h.filter(x => x === 3).length;
        if(threes >= 5){
          found.push({ seed, drops: DROPS, thin, cell: c, topples: cs.topples, waves: cs.waves, exits: cs.exitCount, threesAfter: threes, key: b.h.join('') });
          break;
        }
      }
    }
    EV.drop(b, c, 'coin');
  }
}
found.sort((a, b) => b.topples - a.topples || b.waves - a.waves || a.seed - b.seed);
console.log(`掃描 ${SEEDS} 個種子，符合條件的候選 ${found.length} 個；連爆格數前 12：`);
console.log(found.slice(0, 12).map(f => JSON.stringify(Object.assign({}, f, { key: undefined }))).join('\n'));

const need = EV.CFG.DENOMS.length, pickd = [];
for(const strict of [true, false]){            // 先要求「盤面不同＋發光格不同」，不夠再放寬到只要盤面不同
  for(const f of found){
    if(pickd.length >= need) break;
    if(pickd.some(p => p.key === f.key || (strict && p.cell === f.cell))) continue;
    pickd.push(f);
  }
}
if(pickd.length < need){ console.error('候選不足 ' + need + ' 張'); process.exit(1); }
console.log('\n挑中（依面額順序 ' + EV.CFG.DENOMS.join('／') + '）：');
pickd.forEach((f, i) => console.log(`面額 ${EV.CFG.DENOMS[i]}：seed ${f.seed}、thin ${f.thin}｜發光格 ${f.cell}（第 ${((f.cell / 5) | 0) + 1} 列第 ${f.cell % 5 + 1} 欄）｜第一下連爆 ${f.topples} 格 ${f.waves} 波、噴 ${f.exits} 枚｜爆完 ${f.threesAfter} 格疊 3`));

const block = '[\n' + pickd.map(f => `    { seed: ${f.seed}, drops: ${f.drops}, thin: ${f.thin} }`).join(',\n') + '\n  ]';
if(argv.includes('--write')){
  const file = path.join(__dirname, '..', 'values.js');
  const src = fs.readFileSync(file, 'utf8');
  const re = /\/\*START-BEGIN\*\/[\s\S]*?\/\*START-END\*\//;
  if(!re.test(src)){ console.error('values.js 找不到 START-BEGIN／START-END 標記'); process.exit(1); }
  fs.writeFileSync(file, src.replace(re, () => '/*START-BEGIN*/' + block + '/*START-END*/'));
  console.log('\n已寫入 values.js 的 CFG.START');
} else console.log('\nCFG.START ＝ ' + block + '\n（加 --write 寫回 values.js）');
