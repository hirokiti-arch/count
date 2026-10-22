// 共通の関数（文字コード、CSV読み込み、流入元名の照合、年齢の判定）
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { parse } = require('csv-parse/sync');

const ROOT = path.resolve(__dirname, '..');
const DASH = 'ー'; // 流入元が分からないものの行の名前

// ファイルを文字列で読む。UTF-8として読めなければ cp932（Shift_JIS）として読む。
function readText(file) {
  const buf = fs.readFileSync(file);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    text = iconv.decode(buf, 'cp932');
  }
  return text.replace(/^﻿/, '');
}

function readCsv(file) {
  return parse(readText(file), {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    bom: true,
  });
}

function readLines(file) {
  return readText(file).split(/\r?\n/).map((s) => s.replace(/\r$/, '')).filter((s, i, a) => !(i === a.length - 1 && s === ''));
}

// マスター（流入元_並び順.txt と同じ内容）を、行の順に配列で返す
function loadMaster(file) {
  return readLines(file);
}

function nfkc(s) {
  return String(s == null ? '' : s).normalize('NFKC');
}

// 照合用の名前：全角・半角のスペースを除去、NFKC、小文字。別名 ZEAR6 は ZERA6 と同じ。
function normName(s) {
  let t = nfkc(s).replace(/[\s　]+/g, '').toLowerCase();
  if (t === 'zear6') t = 'zera6';
  return t;
}

// 流入元名 → マスターの行番号（0始まり）。見つからなければ -1。
// 完全一致（スペースを残したまま）を優先し、次に正規化した名前で照合。同名が複数あれば、最初の行。
function buildResolver(master) {
  const exact = new Map();
  const norm = new Map();
  master.forEach((name, i) => {
    if (!exact.has(name)) exact.set(name, i);
    const k = normName(name);
    if (!norm.has(k)) norm.set(k, i);
  });
  const dashIdx = master.indexOf(DASH);
  return {
    dashIdx,
    resolve(name) {
      const raw = String(name == null ? '' : name).trim();
      if (raw === '' || raw === DASH) return dashIdx;
      if (exact.has(raw)) return exact.get(raw);
      const k = normName(raw);
      if (norm.has(k)) return norm.get(k);
      return -1;
    },
  };
}

// 日付（YYYY-MM-DD）を取り出す。見つからなければ null。
function parseDate(s) {
  const m = nfkc(s).match(/(\d{4})\s*[\/\-年.]\s*(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

// 年齢を数字で返す（16 / 16歳 / 16才 / 全角）。読めない、または、ありえない数字は null。
function parseAge(s) {
  const t = nfkc(s);
  const m = t.match(/\d{1,3}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (n < 5 || n > 100) return null;
  return n;
}

function ageCategory(age) {
  if (age >= 19) return '19+';
  if (age === 18) return '18';
  return '17-';
}

const CAT_LABEL = { '19+': '19歳以上', '18': '18歳', '17-': '17歳以下' };
const CATS = ['19+', '18', '17-'];

function colLetter(n) { // 1 → A
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// フォルダの中で、パターンに合う、いちばん新しいファイル
function latestFile(dir, regex) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => regex.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
  if (!files.length) return null;
  files.sort((a, b) => b.t - a.t);
  return path.join(dir, files[0].f);
}

module.exports = {
  ROOT, DASH, CATS, CAT_LABEL,
  readText, readCsv, readLines, loadMaster, nfkc, normName, buildResolver,
  parseDate, parseAge, ageCategory, colLetter, daysInMonth, isoDate, latestFile,
};
