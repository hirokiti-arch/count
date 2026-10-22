// 流入元別申込数集計（月次）
// 使い方:
//   node scripts/aggregate.js <年> <月> <何日目まで> [--input input] [--output output] [--master master/流入元マスター.csv] [--elme-total 3581]
//   マスターは、master/流入元マスター_YYYYMM.csv（その月の分）があれば、それを使う。なければ master/流入元マスター.csv（2026年9月）。
//   エルメの友だち追加総数は、--elme-total か、環境変数 LMESSAGE_FRIEND_ADD_TOTAL で渡す（期間内、bot_id=23ZloW）。
// 入力（input/ の中の、いちばん新しいファイル）:
//   フォーム回答CSV（ファイル名の末尾が フォームID.csv）：176252, 178808, 202523, 205225（cp932）
//   Product_selling*.csv（成約状況）
// 出力:
//   output/流入元別申込数集計_YYYY年M月.xlsx、output/summary_YYYYMM.json
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const L = require('./lib');

const FORM_IDS = ['176252', '178808', '202523', '205225'];

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; } else pos.push(argv[i]);
  }
  return { pos, opt };
}

function findColumn(header, word) {
  return header.findIndex((h) => L.nfkc(h).includes(word));
}

const GENDERS = ['男性', '女性', 'その他', 'LGBTQ'];
const ID_RE = /^U[0-9a-f]{32}$/i;

// フォーム回答CSVから、期間内の回答を取り出す
function readFormResponses(file, formId, startIso, endIso) {
  const rows = L.readCsv(file);
  if (!rows.length) return [];
  let header = null;
  let body = rows;
  if (!ID_RE.test(String(rows[0][0] || '').trim())) { header = rows[0]; body = rows.slice(1); }
  const ageCol = header ? findColumn(header, '年齢') : -1;
  const jobCol = header ? findColumn(header, '職業') : -1;
  const out = [];
  for (const row of body) {
    const userId = String(row[0] || '').trim();
    if (!userId) continue;
    const date = L.parseDate(row[2]) || L.parseDate(row[1]) || L.parseDate(row[3]);
    if (!date || date < startIso || date > endIso) continue;
    let age = ageCol >= 0 ? L.parseAge(row[ageCol]) : null;
    let job = jobCol >= 0 ? String(row[jobCol] || '').trim() : '';
    if (age == null) {
      // 列の位置がずれている回答：性別の回答を目印に、その近くの年齢欄を探す
      const g = row.findIndex((v, i) => i >= 5 && GENDERS.some((x) => L.nfkc(v).includes(x)));
      if (g >= 0) {
        for (let k = g + 1; k <= g + 4 && k < row.length; k++) {
          const a = L.parseAge(row[k]);
          if (a != null && String(row[k]).length <= 8) { age = a; break; }
        }
      }
    }
    out.push({ formId, userId, date, name: String(row[4] || ''), age, job, time: String(row[2] || '') });
  }
  return out;
}

// Product_selling を読む
function readProductSelling(file) {
  const rows = L.readCsv(file);
  const header = rows[0];
  const ci = {
    user: findColumn(header, 'ユーザーID'),
    date: findColumn(header, '成約日時'),
    cond: findColumn(header, '報酬条件'),
    aff: findColumn(header, 'アフィリエイター'),
  };
  for (const k of Object.keys(ci)) if (ci[k] < 0) throw new Error(`Product_selling の列が見つかりません: ${k}（ヘッダー: ${header.join(',')}）`);
  return { header, ci, rows: rows.slice(1).map((r) => ({
    userId: String(r[ci.user] || '').trim(),
    date: L.parseDate(r[ci.date]),
    cond: L.nfkc(r[ci.cond] || ''),
    aff: String(r[ci.aff] || '').trim(),
  })) };
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos.length < 3) { console.error('使い方: node scripts/aggregate.js <年> <月> <何日目まで> [--elme-total N]'); process.exit(1); }
  const year = parseInt(pos[0], 10);
  const month = parseInt(pos[1], 10);
  const endDay = parseInt(pos[2], 10);
  const inputDir = path.resolve(L.ROOT, opt.input || 'input');
  const outputDir = path.resolve(L.ROOT, opt.output || 'output');
  // マスター：--master で指定。なければ master/流入元マスター_YYYYMM.csv（その月のもの）、それも無ければ master/流入元マスター.csv（2026年9月）
  const monthMaster = path.resolve(L.ROOT, `master/流入元マスター_${year}${String(month).padStart(2, '0')}.csv`);
  const masterFile = path.resolve(L.ROOT, opt.master || (fs.existsSync(monthMaster) ? monthMaster : 'master/流入元マスター.csv'));
  const elmeTotalRaw = opt['elme-total'] || process.env.LMESSAGE_FRIEND_ADD_TOTAL;
  const elmeTotal = elmeTotalRaw != null && elmeTotalRaw !== '' ? parseInt(elmeTotalRaw, 10) : null;

  const master = L.loadMaster(masterFile);
  const resolver = L.buildResolver(master);
  const dim = L.daysInMonth(year, month);
  const nDays = dim;
  const startIso = L.isoDate(year, month, 1);
  const endIso = L.isoDate(year, month, Math.min(endDay, dim));

  // --- 入力ファイル
  const files = {};
  const warnings = [];
  for (const id of FORM_IDS) {
    files[id] = L.latestFile(inputDir, new RegExp(`${id}\\.csv$`, 'i'));
    if (!files[id]) warnings.push(`フォーム ${id} のCSVが input/ にありません`);
  }
  const psFile = L.latestFile(inputDir, /^Product_selling.*\.csv$/i);
  if (!psFile) throw new Error('Product_selling のCSVが input/ にありません');

  // --- Product_selling
  const ps = readProductSelling(psFile);
  const formAnsSameDay = new Map(); // user|date → 流入元
  const formAnsAnyDay = new Map(); // user → 流入元
  const friendAddByUser = new Map(); // user → 流入元
  const affsByUser = new Map();
  const leadsByIdx = master.map(() => new Array(nDays).fill(0));
  const psDailyTotal = new Array(nDays).fill(0);
  const newNames = new Map();
  for (const r of ps.rows) {
    if (!r.userId) continue;
    if (!affsByUser.has(r.userId)) affsByUser.set(r.userId, new Set());
    affsByUser.get(r.userId).add(r.aff);
    if (r.cond.includes('フォーム回答')) {
      if (r.date) { const k = `${r.userId}|${r.date}`; if (!formAnsSameDay.has(k)) formAnsSameDay.set(k, r.aff); }
      if (!formAnsAnyDay.has(r.userId)) formAnsAnyDay.set(r.userId, r.aff);
    } else if (r.cond.includes('友だち追加')) {
      if (!friendAddByUser.has(r.userId)) friendAddByUser.set(r.userId, r.aff);
      if (r.date && r.date >= startIso && r.date <= endIso) {
        const day = parseInt(r.date.slice(8, 10), 10);
        let idx = resolver.resolve(r.aff);
        if (idx < 0) { newNames.set(r.aff, (newNames.get(r.aff) || 0) + 1); idx = resolver.dashIdx; }
        leadsByIdx[idx][day - 1]++;
        psDailyTotal[day - 1]++;
      }
    }
  }
  const conflicts = [...affsByUser.entries()].filter(([, s]) => s.size > 1).length;

  // --- フォーム回答
  const responses = [];
  for (const id of FORM_IDS) if (files[id]) responses.push(...readFormResponses(files[id], id, startIso, endIso));
  const groups = new Map(); // user|date → 回答の一覧
  for (const r of responses) {
    const k = `${r.userId}|${r.date}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const appsByIdx = master.map(() => ({ '19+': new Array(nDays).fill(0), '18': new Array(nDays).fill(0), '17-': new Array(nDays).fill(0) }));
  const unknownByDay = new Array(nDays).fill(0);
  const unknownList = [];
  for (const [k, list] of groups) {
    const [userId, date] = k.split('|');
    const day = parseInt(date.slice(8, 10), 10);
    // 年齢：読める年齢のある回答を優先。なければ、職業が「学生」以外なら19歳以上。
    let age = null;
    for (const r of list) if (r.age != null) { age = r.age; break; }
    let cat = null;
    if (age != null) cat = L.ageCategory(age);
    else if (list.some((r) => r.job && r.job !== '学生')) cat = '19+';
    // 流入元：(1)同じ日のフォーム回答 (2)他の日のフォーム回答 (3)友だち追加
    let aff = formAnsSameDay.get(k);
    if (aff === undefined) aff = formAnsAnyDay.get(userId);
    if (aff === undefined) aff = friendAddByUser.get(userId);
    let idx = aff === undefined ? resolver.dashIdx : resolver.resolve(aff);
    if (idx < 0) { newNames.set(aff, (newNames.get(aff) || 0) + 1); idx = resolver.dashIdx; }
    if (cat == null) {
      unknownByDay[day - 1]++;
      unknownList.push({ userId, name: list[0].name, time: list[0].time, source: master[idx] });
      continue;
    }
    appsByIdx[idx][cat][day - 1]++;
  }

  // --- リード：エルメの友だち追加総数との差を ー に計上
  const psLeadTotal = psDailyTotal.reduce((a, b) => a + b, 0);
  let diff = 0;
  if (elmeTotal == null) warnings.push('エルメの友だち追加総数（--elme-total / LMESSAGE_FRIEND_ADD_TOTAL）が渡されていません。差分は0にしています。');
  else if (elmeTotal > psLeadTotal) diff = elmeTotal - psLeadTotal;
  else if (elmeTotal < psLeadTotal) warnings.push(`Product_selling の合計(${psLeadTotal})が、エルメの友だち追加総数(${elmeTotal})より多いです。`);

  // --- Excel
  fs.mkdirSync(outputDir, { recursive: true });
  const xlsxName = `流入元別申込数集計_${year}年${month}月.xlsx`;
  const xlsxPath = path.join(outputDir, xlsxName);
  if (fs.existsSync(xlsxPath)) {
    const bdir = path.join(outputDir, 'backup');
    fs.mkdirSync(bdir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    fs.copyFileSync(xlsxPath, path.join(bdir, `${xlsxName.replace('.xlsx', '')}_${stamp}.xlsx`));
    const olds = fs.readdirSync(bdir).filter((f) => f.endsWith('.xlsx')).map((f) => ({ f, t: fs.statSync(path.join(bdir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const o of olds.slice(7)) fs.unlinkSync(path.join(bdir, o.f));
  }
  buildWorkbook({ master, appsByIdx, leadsByIdx, unknownByDay, unknownList, diff, nDays, year, month }).then((wb) => wb.xlsx.writeFile(xlsxPath)).then(() => {
    const sumOf = (arr) => arr.reduce((a, b) => a + b, 0);
    const totals = { '19+': 0, '18': 0, '17-': 0, unknown: sumOf(unknownByDay) };
    for (const a of appsByIdx) for (const c of L.CATS) totals[c] += sumOf(a[c]);
    const perDay = [];
    for (let d = 0; d < nDays; d++) {
      const o = { day: d + 1, '19+': 0, '18': 0, '17-': 0, unknown: unknownByDay[d], psLeads: psDailyTotal[d] };
      for (const a of appsByIdx) for (const c of L.CATS) o[c] += a[c][d];
      perDay.push(o);
    }
    const summary = {
      year, month, endDay: Math.min(endDay, dim), generatedAt: new Date().toISOString(), master,
      files: Object.fromEntries(Object.entries({ ...files, productSelling: psFile }).map(([k, v]) => [k, v ? path.basename(v) : null])),
      totals, perDay, appsByIdx, leadsByIdx, psLeadTotal, elmeTotal, diff,
      newAffiliateNames: Object.fromEntries(newNames), unknownAgeCount: unknownList.length, conflictUsers: conflicts, warnings,
    };
    fs.writeFileSync(path.join(outputDir, `summary_${year}${String(month).padStart(2, '0')}.json`), JSON.stringify(summary));
    console.log(JSON.stringify({
      period: `${startIso}〜${endIso}`, totals, grand: totals['19+'] + totals['18'] + totals['17-'] + totals.unknown,
      psLeadTotal, elmeTotal, diff, newAffiliateNames: Object.fromEntries(newNames), unknownAgeCount: unknownList.length,
      conflictUsers: conflicts, warnings, excel: xlsxPath,
    }, null, 2));
  }).catch((e) => { console.error(e); process.exit(1); });
}

// 数式つきの値（結果も入れておく）
function F(formula, result) { return { formula, result }; }

async function buildWorkbook({ master, appsByIdx, leadsByIdx, unknownByDay, unknownList, diff, nDays, year, month }) {
  const wb = new ExcelJS.Workbook();
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const dayCol = (d) => L.colLetter(2 + d); // d=1 → C（A=流入元、B=年齢区分、C=1日）
  const totCol = L.colLetter(3 + nDays); // 合計の列
  const N = master.length;

  // 1) 流入別申込数
  const s1 = wb.addWorksheet('流入別申込数');
  s1.addRow(['流入元', '年齢区分', ...Array.from({ length: nDays }, (_, i) => `${i + 1}日`), '合計']);
  const firstRow = 2;
  const lastRow = firstRow + N * 3 - 1;
  for (let i = 0; i < N; i++) {
    L.CATS.forEach((c, k) => {
      const r = firstRow + i * 3 + k;
      const vals = appsByIdx[i][c];
      s1.addRow([k === 0 ? master[i] : null, L.CAT_LABEL[c], ...vals, F(`SUM(C${r}:${L.colLetter(2 + nDays)}${r})`, sum(vals))]);
    });
  }
  const catRows = {};
  L.CATS.forEach((c) => {
    const r = s1.rowCount + 1;
    catRows[c] = r;
    const row = [`合計(${L.CAT_LABEL[c]})`, L.CAT_LABEL[c]];
    for (let d = 1; d <= nDays; d++) {
      const col = dayCol(d);
      const v = appsByIdx.reduce((a, x) => a + x[c][d - 1], 0);
      row.push(F(`SUMIF($B$${firstRow}:$B$${lastRow},"${L.CAT_LABEL[c]}",${col}$${firstRow}:${col}$${lastRow})`, v));
    }
    row.push(F(`SUM(C${r}:${L.colLetter(2 + nDays)}${r})`, appsByIdx.reduce((a, x) => a + sum(x[c]), 0)));
    s1.addRow(row);
  });
  const unkRow = s1.rowCount + 1;
  s1.addRow(['年齢不明', null, ...unknownByDay, F(`SUM(C${unkRow}:${L.colLetter(2 + nDays)}${unkRow})`, sum(unknownByDay))]);
  const grandRow = s1.rowCount + 1;
  const grand = ['総合計', null];
  for (let d = 1; d <= nDays + 1; d++) {
    const col = L.colLetter(2 + d);
    const v = d <= nDays
      ? L.CATS.reduce((a, c) => a + appsByIdx.reduce((x, y) => x + y[c][d - 1], 0), 0) + unknownByDay[d - 1]
      : L.CATS.reduce((a, c) => a + appsByIdx.reduce((x, y) => x + sum(y[c]), 0), 0) + sum(unknownByDay);
    grand.push(F(`${col}${catRows['19+']}+${col}${catRows['18']}+${col}${catRows['17-']}+${col}${unkRow}`, v));
  }
  s1.addRow(grand);
  s1.getRow(1).font = { bold: true };
  s1.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

  // 2) 流入元別_年齢構成比
  const s2 = wb.addWorksheet('流入元別_年齢構成比');
  s2.addRow(['流入元', '19歳以上', '18歳', '17歳以下', '合計', '19歳以上の割合', '18歳の割合', '17歳以下の割合']);
  for (let i = 0; i < N; i++) {
    const r = i + 2;
    const base = firstRow + i * 3;
    const t = L.CATS.map((c) => sum(appsByIdx[i][c]));
    const tot = t[0] + t[1] + t[2];
    const pct = (n) => (tot === 0 ? '' : n / tot);
    s2.addRow([
      master[i],
      F(`'流入別申込数'!${totCol}${base}`, t[0]), F(`'流入別申込数'!${totCol}${base + 1}`, t[1]), F(`'流入別申込数'!${totCol}${base + 2}`, t[2]),
      F(`SUM(B${r}:D${r})`, tot),
      F(`IF(E${r}=0,"",B${r}/E${r})`, pct(t[0])), F(`IF(E${r}=0,"",C${r}/E${r})`, pct(t[1])), F(`IF(E${r}=0,"",D${r}/E${r})`, pct(t[2])),
    ]);
  }
  for (let r = 2; r <= N + 1; r++) ['F', 'G', 'H'].forEach((c) => { s2.getCell(`${c}${r}`).numFmt = '0.0%'; });
  s2.getRow(1).font = { bold: true };

  // 3) 流入元別_リード数_申込率
  const s3 = wb.addWorksheet('流入元別_リード数_申込率');
  const dashIdx = master.indexOf(L.DASH);
  const lastDay = L.colLetter(1 + nDays); // B=1日
  s3.addRow(['流入元', ...Array.from({ length: nDays }, (_, i) => `${i + 1}日`), 'リード合計', '差分(ブロック→解除等)', 'リード合計(差分込み)', '申込み合計', '申込率']);
  const cRe = L.colLetter(2 + nDays), cDiff = L.colLetter(3 + nDays), cLead = L.colLetter(4 + nDays), cApp = L.colLetter(5 + nDays), cRate = L.colLetter(6 + nDays);
  for (let i = 0; i < N; i++) {
    const r = i + 2;
    const vals = leadsByIdx[i];
    const d = i === dashIdx ? diff : 0;
    const base = firstRow + i * 3;
    const appTot = L.CATS.reduce((a, c) => a + sum(appsByIdx[i][c]), 0);
    const leadTot = sum(vals) + d;
    s3.addRow([
      master[i], ...vals,
      F(`SUM(B${r}:${lastDay}${r})`, sum(vals)), d,
      F(`${cRe}${r}+${cDiff}${r}`, leadTot),
      F(`SUM('流入別申込数'!${totCol}${base}:${totCol}${base + 2})`, appTot),
      F(`IF(${cLead}${r}=0,"",${cApp}${r}/${cLead}${r})`, leadTot === 0 ? '' : appTot / leadTot),
    ]);
  }
  const tr = N + 2;
  const allApp = appsByIdx.reduce((a, x) => a + L.CATS.reduce((b, c) => b + sum(x[c]), 0), 0);
  const allLead = leadsByIdx.reduce((a, x) => a + sum(x), 0) + diff;
  const totalRow = ['合計'];
  for (let d = 1; d <= nDays; d++) totalRow.push(F(`SUM(${L.colLetter(1 + d)}2:${L.colLetter(1 + d)}${N + 1})`, leadsByIdx.reduce((a, x) => a + x[d - 1], 0)));
  totalRow.push(F(`SUM(${cRe}2:${cRe}${N + 1})`, allLead - diff), F(`SUM(${cDiff}2:${cDiff}${N + 1})`, diff), F(`SUM(${cLead}2:${cLead}${N + 1})`, allLead), F(`SUM(${cApp}2:${cApp}${N + 1})`, allApp), F(`IF(${cLead}${tr}=0,"",${cApp}${tr}/${cLead}${tr})`, allLead === 0 ? '' : allApp / allLead));
  s3.addRow(totalRow);
  for (let r = 2; r <= tr; r++) s3.getCell(`${cRate}${r}`).numFmt = '0.0%';
  s3.getRow(1).font = { bold: true };

  // 4) 年齢不明_詳細
  const s4 = wb.addWorksheet('年齢不明_詳細');
  s4.addRow(['LINEユーザーID', 'LINE名', '申込日時', '流入元']);
  for (const u of unknownList) s4.addRow([u.userId, u.name, u.time, u.source]);
  s4.getRow(1).font = { bold: true };
  return wb;
}

if (require.main === module) main();
module.exports = { readFormResponses, readProductSelling, buildWorkbook };
