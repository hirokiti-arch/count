// スプレッドシート貼り付け用のファイル（TSV）を作る。空白になる場所は0にする。
// 使い方:
//   node scripts/generate_paste_files.js --date 2026-09-30 [--days 2] [--summary output/summary_202609.json]
//        [--elme-daily input/elme_daily.json] [--row-map master/sheet_row_map.json] [--output output]
//   --date の日（当日）と、その前日の2日分（同じ月の範囲で）を、作る。
//   elme_daily.json の形: {"2026-09-29":108,"2026-09-30":134}（エルメのその日の友だち追加数）
//   「ー」行のリード数 ＝ エルメのその日の友だち追加数 − 名前の分かる流入元のリード数の合計
// 出力: output/paste_YYYYMMDD_リスト.tsv、output/paste_YYYYMMDD_申込数.tsv（YYYYMMDD は当日）
const fs = require('fs');
const path = require('path');
const L = require('./lib');

function parseArgs(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  return opt;
}

// 既定の行の対応（2026年9月の「2026_09売上管理表」）
//  リスト：マスターの i 番目（0始まり）→ i+2 行目
//  申し込み数・配信スケジュール：19歳以上 = 3×(リストの行)+12、18歳 = +1、17歳以下 = +2。
//    ただし、あつしThreads の3行は無いので、それ以降は3行ずれる。
function defaultRowMap(master) {
  const atsushi = master.indexOf('あつしThreads');
  const map = [];
  master.forEach((name, i) => {
    const listRow = i + 2;
    let appRow = null;
    if (i !== atsushi) appRow = 3 * listRow + 12 - (atsushi >= 0 && i > atsushi ? 3 : 0);
    map.push({ idx: i, name, listRow, appRow });
  });
  return map;
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.date) { console.error('--date YYYY-MM-DD が必要です'); process.exit(1); }
  const [y, m, d] = opt.date.split('-').map((x) => parseInt(x, 10));
  const nDaysWanted = parseInt(opt.days || '2', 10);
  const summaryPath = path.resolve(L.ROOT, opt.summary || `output/summary_${y}${String(m).padStart(2, '0')}.json`);
  const outDir = path.resolve(L.ROOT, opt.output || 'output');
  const S = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (S.year !== y || S.month !== m) throw new Error('summary の年月と --date が合いません');
  const master = S.master;
  const warnings = [];

  const days = [];
  for (let k = nDaysWanted - 1; k >= 0; k--) {
    const dd = d - k;
    if (dd >= 1) days.push(dd);
    else warnings.push(`${y}年${m}月の外の日（前月の最終日など）は、この月の貼り付けファイルに含めません。前月のファイルで、別に作ってください。`);
  }
  if (days.some((x) => x > S.endDay)) warnings.push(`summary の集計は ${S.endDay}日 までです。--date の日が、それより後です。`);

  let elme = {};
  const elmePath = path.resolve(L.ROOT, opt['elme-daily'] || 'input/elme_daily.json');
  if (fs.existsSync(elmePath)) elme = JSON.parse(fs.readFileSync(elmePath, 'utf8'));

  let rowMap;
  // 行の対応表：--row-map、なければ master/sheet_row_map_YYYYMM.json（その月のスプレッドシート用）、それも無ければ、2026年9月の既定
  const monthMap = path.resolve(L.ROOT, `master/sheet_row_map_${y}${String(m).padStart(2, '0')}.json`);
  const rmPath = path.resolve(L.ROOT, opt['row-map'] || (fs.existsSync(monthMap) ? monthMap : 'master/sheet_row_map.json'));
  if (fs.existsSync(rmPath)) {
    rowMap = JSON.parse(fs.readFileSync(rmPath, 'utf8'));
    if (rowMap.length !== master.length) warnings.push(`行の対応表(${rowMap.length}行)と、集計のマスター(${master.length}行)の数が違います。`);
  } else rowMap = defaultRowMap(master);

  const dash = master.indexOf(L.DASH);
  const leadOf = (idx, day) => {
    if (idx === dash) {
      const e = elme[L.isoDate(y, m, day)];
      if (e == null) { warnings.push(`${day}日: エルメの友だち追加数が無いので、「ー」のリードは、Product_selling の分だけです。`); return S.leadsByIdx[idx][day - 1]; }
      const named = S.leadsByIdx.reduce((a, x, i) => a + (i === dash ? 0 : x[day - 1]), 0);
      return Math.max(0, e - named);
    }
    return S.leadsByIdx[idx][day - 1];
  };

  // リード（「リスト」シート）
  const byListRow = new Map(rowMap.map((r) => [r.listRow, r]));
  const listRows = rowMap.map((r) => r.listRow);
  const listFirst = Math.min(...listRows), listLast = Math.max(...listRows);
  const listLines = [];
  for (let r = listFirst; r <= listLast; r++) {
    const e = byListRow.get(r);
    listLines.push(e ? days.map((day) => leadOf(e.idx, day)).join('\t') : days.map(() => '').join('\t'));
  }
  // 申込数（「申し込み数・配信スケジュール」シート）
  const byAppRow = new Map();
  for (const r of rowMap) if (r.appRow != null) { byAppRow.set(r.appRow, { idx: r.idx, cat: '19+' }); byAppRow.set(r.appRow + 1, { idx: r.idx, cat: '18' }); byAppRow.set(r.appRow + 2, { idx: r.idx, cat: '17-' }); }
  const appRows = [...byAppRow.keys()];
  const appFirst = Math.min(...appRows), appLast = Math.max(...appRows);
  const appLines = [];
  for (let r = appFirst; r <= appLast; r++) {
    const e = byAppRow.get(r);
    appLines.push(e ? days.map((day) => S.appsByIdx[e.idx][e.cat][day - 1]).join('\t') : days.map(() => '').join('\t'));
  }
  if (appLines.length !== byAppRow.size) warnings.push('申込数の行に、飛びがあります（対応表を確認してください）。');

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  const f1 = path.join(outDir, `paste_${stamp}_リスト.tsv`);
  const f2 = path.join(outDir, `paste_${stamp}_申込数.tsv`);
  fs.writeFileSync(f1, listLines.join('\n') + '\n');
  fs.writeFileSync(f2, appLines.join('\n') + '\n');
  const firstCol = L.colLetter(days[0] + 1), lastCol = L.colLetter(days[days.length - 1] + 1);
  console.log(JSON.stringify({
    days, columns: `${firstCol}〜${lastCol}`,
    list: { file: f1, paste_at: `「リスト」シートの ${firstCol}${listFirst}`, range: `${firstCol}${listFirst}:${lastCol}${listLast}`, rows: listLines.length },
    app: { file: f2, paste_at: `「申し込み数・配信スケジュール」シートの ${firstCol}${appFirst}`, range: `${firstCol}${appFirst}:${lastCol}${appLast}`, rows: appLines.length },
    note: '貼り付けは Ctrl+Shift+V（値のみ貼り付け）。当日の列は、途中の数字。',
    warnings: [...new Set(warnings)],
  }, null, 2));
}

if (require.main === module) main();
module.exports = { defaultRowMap };
