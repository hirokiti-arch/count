// 日報を作る。個人情報は書かない。
// 使い方: node scripts/daily_report.js --date 2026-09-30 [--summary output/summary_202609.json] [--elme-daily input/elme_daily.json] [--start "11:00"] [--notes "エラーなど"]
const fs = require('fs');
const path = require('path');
const L = require('./lib');

function parseArgs(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  return opt;
}

const opt = parseArgs(process.argv.slice(2));
const [y, m, d] = (opt.date || '').split('-').map((x) => parseInt(x, 10));
if (!y) { console.error('--date YYYY-MM-DD が必要です'); process.exit(1); }
const S = JSON.parse(fs.readFileSync(path.resolve(L.ROOT, opt.summary || `output/summary_${y}${String(m).padStart(2, '0')}.json`), 'utf8'));
let elme = {};
const ep = path.resolve(L.ROOT, opt['elme-daily'] || 'input/elme_daily.json');
if (fs.existsSync(ep)) elme = JSON.parse(fs.readFileSync(ep, 'utf8'));

const dayRow = (day) => S.perDay[day - 1];
const line = (label, r) => `${label}: 19歳以上${r['19+']}件 / 18歳${r['18']}件 / 17歳以下${r['17-']}件 / 年齢不明${r.unknown}件（計${r['19+'] + r['18'] + r['17-'] + r.unknown}件）`;
const out = [];
out.push('申込カウント 日次実行レポート');
out.push('');
out.push(`作成日時: ${new Date().toLocaleString('ja-JP')}`);
if (opt.start) out.push(`実行開始: ${opt.start}`);
out.push(`対象期間: ${y}年${m}月1日〜${m}月${S.endDay}日`);
out.push('');
out.push('--- 当日と前日の申込件数 ---');
for (const day of [d - 1, d]) {
  if (day >= 1 && day <= S.perDay.length) out.push(line(`${m}/${day}${day === d ? '（当日・途中の数字）' : '（前日）'}`, dayRow(day)));
}
out.push('');
out.push('--- 当月の累計 ---');
out.push(line(`${m}/1〜${m}/${S.endDay}`, { ...S.totals, unknown: S.totals.unknown }));
out.push('');
out.push('--- リード数 ---');
out.push(`Product_selling（友だち追加）合計: ${S.psLeadTotal}件`);
out.push(`エルメの友だち追加数（期間合計）: ${S.elmeTotal == null ? '（未取得）' : S.elmeTotal + '件'}`);
out.push(`差（ー に計上）: ${S.diff}件`);
out.push('');
out.push('--- 直近7日分の日別リード数 ---');
out.push('日付 | エルメ友だち追加数 | Product_selling合計 | 差(ー)');
for (let day = Math.max(1, d - 6); day <= d; day++) {
  const e = elme[L.isoDate(y, m, day)];
  const p = S.perDay[day - 1] ? S.perDay[day - 1].psLeads : 0;
  out.push(`${m}/${day} | ${e == null ? '-' : e} | ${p} | ${e == null ? '-' : e - p}`);
}
out.push('');
out.push('--- 気づいた点 ---');
const nn = Object.entries(S.newAffiliateNames);
out.push(`マスターに無い流入元: ${nn.length ? nn.map(([k, v]) => `${k}(${v}件)`).join('、') : 'なし'}`);
out.push(`年齢不明の人数: ${S.unknownAgeCount}人`);
out.push(`流入元が複数ある人: ${S.conflictUsers}人`);
if (S.warnings && S.warnings.length) S.warnings.forEach((w) => out.push(`注意: ${w}`));
if (opt.notes) out.push(`メモ: ${opt.notes}`);
const file = path.resolve(L.ROOT, opt.output || 'output', `daily_report_${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}.txt`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(file);
