// 疑似データで、集計・貼り付けファイル・日報が、期待どおりに動くかを確かめる。
// 実行: npm test （または node test/run_tests.js）
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const iconv = require('iconv-lite');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moushikomi-'));
const inDir = path.join(tmp, 'input');
const outDir = path.join(tmp, 'output');
fs.mkdirSync(inDir, { recursive: true });

const uid = (n) => 'U' + String(n).padStart(32, '0');
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
const writeCp932 = (name, text) => fs.writeFileSync(path.join(inDir, name), iconv.encode(text, 'cp932'));

// フォーム176252（cp932、設問の文言は「④ご年齢をご記入ください」）
const H1 = ['LINE ユーザーID', 'a', '回答日時', 'b', 'LINE名', 'システム表示名', 'お別れ', '②ご自身の性別をお選びください', '④ご年齢をご記入ください', '⑤ご職業をお選びください'];
const row = (n, date, gender, age, job, name = 'みゆ') => [uid(n), '', `${date} 10:00:00`, '', name, name, 'x', gender, age, job];
writeCp932('20260929220000176252.csv', csv([
  H1,
  row(1, '2026-09-28', '女性', '25', '会社員'),
  row(1, '2026-09-28', '女性', '1', '会社員'), // 同じ人・同じ日：1件にまとめる（まともなほうを優先）
  row(2, '2026-09-28', '男性', '18歳', '学生'),
  row(3, '2026-09-28', '女性', '１６', '学生'), // 全角
  row(4, '2026-09-28', '男性', 'ああ', '会社員'), // 年齢が読めない→職業で19歳以上
  row(5, '2026-09-28', '男性', 'ああ', '学生'), // 年齢不明
  row(1, '2026-09-29', '女性', '25', '会社員'),
  row(7, '2026-09-29', '男性', '20', '会社員'),
  row(9, '2026-10-02', '男性', '30', '会社員'), // 期間の外
  ['U' + 'a'.repeat(32), '', '2026-09-29 12:00:00', '', 'ずれ', 'ずれ', '', '', '', '', '女性', '40', '会社員'], // 列がずれている回答
]));
// フォーム205225（設問の文言が違う）
writeCp932('20260929220000205225.csv', csv([
  ['LINE ユーザーID', 'a', '回答日時', 'b', 'LINE名', 'システム表示名', '２、男性　女性', '４、ご年齢', '５、ご職業'],
  [uid(8), '', '2026-09-29 09:00:00', '', 'めぐ', 'めぐ', '女性　', '30', '会社員'],
]));
// Product_selling（UTF-8）
fs.writeFileSync(path.join(inDir, 'Product_selling__1_.csv'), csv([
  ['LINE ユーザーID', '成約日時', '報酬条件', 'アフィリエイター名', '報酬額', 'ステータス'],
  [uid(1), '2026-09-28 10:00', 'フォーム回答', 'ZEAR6', 0, ''],
  [uid(2), '2026-09-28 10:00', 'フォーム回答', 'ZERA デマンド', 0, ''],
  [uid(3), '2026-09-27 10:00', '友だち追加', 'なんばTikTok', 0, ''],
  [uid(7), '2026-09-29 10:00', 'フォーム回答', 'Aviaf18', 0, ''],
  [uid(8), '2026-09-29 10:00', 'フォーム回答', '未知の流入元', 0, ''],
  [uid(11), '2026-09-28 10:00', '友だち追加', 'ZERA6', 0, ''],
  [uid(12), '2026-09-28 10:00', '友だち追加', 'ZERA6', 0, ''],
  [uid(13), '2026-09-28 10:00', '友だち追加', 'ZERAデマンド', 0, ''],
  [uid(14), '2026-09-29 10:00', '友だち追加', 'ZERA デマンド', 0, ''],
  [uid(15), '2026-09-29 10:00', '友だち追加', 'X社', 0, ''],
]));

const run = (script, args, env = {}) => execFileSync('node', [path.join(ROOT, 'scripts', script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

// --- 集計
const res = JSON.parse(run('aggregate.js', ['2026', '9', '29', '--input', inDir, '--output', outDir, '--elme-total', '10']));
assert.deepStrictEqual(res.totals, { '19+': 6, '18': 1, '17-': 1, unknown: 1 }, '年齢区分ごとの件数');
assert.strictEqual(res.psLeadTotal, 6, 'Product_sellingのリード合計');
assert.strictEqual(res.diff, 4, 'エルメとの差分');
assert.deepStrictEqual(res.newAffiliateNames, { '未知の流入元': 1, 'X社': 1 }, '新しい流入元');
assert.strictEqual(res.unknownAgeCount, 1, '年齢不明');

const S = JSON.parse(fs.readFileSync(path.join(outDir, 'summary_202609.json'), 'utf8'));
const idxOf = (n) => S.master.indexOf(n);
assert.strictEqual(S.appsByIdx[idxOf('ZERA6')]['19+'][27], 1, 'ZEAR6 は ZERA6 に集計');
assert.strictEqual(S.appsByIdx[idxOf('ZERA デマンド')]['18'][27], 1, '完全一致（スペースあり）を優先');
assert.strictEqual(S.appsByIdx[idxOf('なんばTikTok')]['17-'][27], 1, 'フォーム回答の記録が無い人は、友だち追加の流入元');
assert.strictEqual(S.appsByIdx[idxOf('Aviaf18')]['19+'][28], 1);
assert.strictEqual(S.appsByIdx[S.master.indexOf('ー')]['19+'][27], 1, '職業で19歳以上、流入元不明は ー');
assert.strictEqual(S.appsByIdx[S.master.indexOf('ー')]['19+'][28], 2, '未知の流入元と、ずれた回答は ー');
const dup = S.master.lastIndexOf('カルテットYahoo2 video');
assert.notStrictEqual(dup, S.master.indexOf('カルテットYahoo2 video'), '重複行がある');
assert.ok(S.appsByIdx[dup]['19+'].every((x) => x === 0), '同名の2行目は0のまま');

// --- Excel
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(outDir, '流入元別申込数集計_2026年9月.xlsx'));
  assert.deepStrictEqual(wb.worksheets.map((w) => w.name), ['流入別申込数', '流入元別_年齢構成比', '流入元別_リード数_申込率', '年齢不明_詳細']);
  const s1 = wb.getWorksheet('流入別申込数');
  const grand = s1.getRow(s1.rowCount);
  assert.strictEqual(grand.getCell(1).value, '総合計');
  const gc = grand.getCell(s1.columnCount).value;
  assert.ok(gc && gc.formula, '総合計は数式');
  assert.strictEqual(gc.result, 9, '総合計（年齢不明を含む）');
  const s3 = wb.getWorksheet('流入元別_リード数_申込率');
  assert.strictEqual(s3.getRow(S.master.indexOf('ー') + 2).getCell(3 + 29 + 1).value, 4, 'ー の差分');
  assert.strictEqual(wb.getWorksheet('年齢不明_詳細').rowCount, 2);

  // --- 貼り付けファイル
  fs.mkdirSync(path.join(tmp, 'in2'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'in2', 'elme.json'), JSON.stringify({ '2026-09-28': 5, '2026-09-29': 4 }));
  const pr = JSON.parse(run('generate_paste_files.js', ['--date', '2026-09-29', '--summary', path.join(outDir, 'summary_202609.json'), '--elme-daily', path.join(tmp, 'in2', 'elme.json'), '--row-map', path.join(tmp, 'none.json'), '--output', outDir]));
  assert.deepStrictEqual(pr.days, [28, 29]);
  assert.strictEqual(pr.list.rows, 126, 'リストは126行');
  assert.strictEqual(pr.app.rows, 375, '申込数は375行（125組×3）');
  assert.strictEqual(pr.list.range, 'AC2:AD127');
  assert.strictEqual(pr.app.range, 'AC18:AD392');
  const L1 = fs.readFileSync(path.join(outDir, 'paste_20260929_リスト.tsv'), 'utf8').trim().split('\n');
  const A1 = fs.readFileSync(path.join(outDir, 'paste_20260929_申込数.tsv'), 'utf8').trim().split('\n');
  assert.strictEqual(L1[idxOf('ZERA6')], '2\t0', 'ZERA6 のリード（リストの行=idx+2）');
  assert.strictEqual(L1[S.master.indexOf('ー')], '2\t3', 'ー のリード＝エルメ − 名前の分かる流入元');
  const zr = 3 * (idxOf('ZERA6') + 2) + 12; // 192
  assert.strictEqual(A1[zr - 18], '1\t1', 'ZERA6 の19歳以上');
  const nanba = 390;
  assert.strictEqual(A1[nanba + 2 - 18], '1\t0', 'なんばTikTok の17歳以下（あつしThreadsの3行が無いぶん、ずれる）');
  assert.ok(A1.every((l) => /^\d+\t\d+$/.test(l)), '空白は0');

  // --- 日報
  const rp = run('daily_report.js', ['--date', '2026-09-29', '--summary', path.join(outDir, 'summary_202609.json'), '--elme-daily', path.join(tmp, 'in2', 'elme.json'), '--output', outDir]).trim();
  const rt = fs.readFileSync(rp, 'utf8');
  assert.ok(rt.includes('直近7日分') && rt.includes('マスターに無い流入元'));
  // --- 10月（134流入元、あつしThreadsの3行あり）の行対応
  const octMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'master', 'sheet_row_map_202610.json'), 'utf8'));
  const octMaster = fs.readFileSync(path.join(ROOT, 'master', '流入元_並び順_202610.txt'), 'utf8').split('\n').filter((x) => x !== '');
  assert.strictEqual(octMap.length, 134);
  assert.strictEqual(octMaster.length, 134);
  assert.strictEqual(octMap[0].appRow, 18);
  assert.strictEqual(octMap[133].listRow, 135, '10月のリストは2〜135行');
  assert.strictEqual(octMap[133].appRow, 417, '10月の申込数の最後の組は417〜419行');
  console.log('すべてのテストに成功しました');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('テスト失敗:', e.message); console.error(e.stack); process.exit(1); });
