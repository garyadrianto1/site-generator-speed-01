// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Written fresh in this session: a fused single-pass pipeline (no plugin chain, no
// token arrays, flat template ops, range-based inline rendering, table-driven
// escapes, memoized slugs). It returns exactly makefun-site's answer for every
// input; the vendor README + reference code define the contract, this file is my
// own reimplementation of it.
//
// Part 1: text rules, front matter, Markdown.

// ---------------------------------------------------------------- text rules

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_BY_CODE = [];
ESC_BY_CODE[38] = '&amp;';
ESC_BY_CODE[60] = '&lt;';
ESC_BY_CODE[62] = '&gt;';
ESC_BY_CODE[34] = '&quot;';
ESC_BY_CODE[39] = '&#39;';
const ESCAPABLE_CODE = [];
for (const ch of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESCAPABLE_CODE[ch.charCodeAt(0)] = true;

/** `s` with & < > " ' escaped; the input itself when nothing needs it. */
function escapeHtml(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const e = ESC_BY_CODE[s.charCodeAt(i)];
    if (e !== undefined) {
      out += s.slice(start, i);
      out += e;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

const SLUG_MAX = 64;

/** The slug of `text` (NFKD, marks dropped, A-Z lowered, runs of other chars one `-`, cut to 64, `untitled` when empty). */
function slugify(text) {
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  }
  const plain = ascii ? text : text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const c = plain[i];
    let keep = null;
    if (c >= 'A' && c <= 'Z') keep = c.toLowerCase();
    else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) keep = c;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX);
  let e = out.length;
  while (e > 0 && out[e - 1] === '-') e--;
  out = out.slice(0, e);
  return out === '' ? 'untitled' : out;
}

/** `slug` made unique against `taken` (and added to it). */
function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let n = 2;
  let out;
  do {
    out = `${slug}-${n++}`;
  } while (taken.has(out));
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone. */
function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const WS_ASCII = new Uint8Array(128);
for (const c of [32, 9, 10, 11, 12, 13]) WS_ASCII[c] = 1;

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let ws;
    if (c < 128) ws = WS_ASCII[c] === 1;
    else {
      ws =
        c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    }
    if (ws) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(raw) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) if (t === '' || !TAG_RE.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

/** Parse one FM line: [key, raw] or null when it is not "key: value". */
function fmLine(line) {
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if ((c >= 'a' && c <= 'z') || c === '_') i++;
    else break;
  }
  if (i === 0 || line[i] !== ':') return null;
  if (i + 1 === line.length) return [line.slice(0, i), ''];
  if (line[i + 1] !== ' ') return null;
  let raw = line.slice(i + 2);
  let e = raw.length;
  while (e > 0 && (raw[e - 1] === ' ' || raw[e - 1] === '\t')) e--;
  return [line.slice(0, i), raw.slice(0, e)];
}

/**
 * A source's front matter over its lines: { data, bodyLines }, or { error }.
 * `lines` is the source text split on '\n'; the body is returned as its lines.
 */
function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlankLine(line) || line[0] === '#') continue;
    const kv = fmLine(line);
    if (kv === null) return { error: `line ${i + 1} is not "key: value"` };
    const key = kv[0];
    const raw = kv[1];
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyLines: lines.slice(close + 1) };
}

// ---------------------------------------------------------------- Markdown

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return line.slice(a, b);
}

function fenceLang(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let i = 3;
  while (i < line.length) {
    const c = line[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-') i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i === line.length ? lang : null;
}

function fenceClose(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return false;
  for (let i = 3; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
}

/** A heading line's [depth, text], or null (a heading's text is never empty). */
function headingOf(line) {
  let n = 0;
  while (n < line.length && line[n] === '#' && n < 6) n++;
  if (n === 0 || n === 6 + 1) return null;
  if (n >= line.length || (line[n] !== ' ' && line[n] !== '\t')) return null;
  let a = n;
  while (a < line.length && (line[a] === ' ' || line[a] === '\t')) a++;
  let b = line.length;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  if (b === a) return null;
  return [n, line.slice(a, b)];
}

function isHr(line) {
  if (line !== '---' && line !== '***' && !line.startsWith('---') && !line.startsWith('***')) return false;
  const head = line.startsWith('---') ? '---' : '***';
  if (!line.startsWith(head)) return false;
  for (let i = 3; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
}

/** Whether `line` ends a paragraph: blank, fence, heading or thematic break. */
function endsParagraph(line) {
  return isBlankLine(line) || fenceLang(line) !== null || headingOf(line) !== null || isHr(line);
}

/** First index from `from` where `s` holds `what` outside a backslash escape, or -1. Search stays inside [from, end). */
function findUnescaped(s, what, from, end) {
  const last = end - what.length;
  for (let j = from; j <= last; j++) {
    if (s.charCodeAt(j) === 92 && j + 1 < end && ESCAPABLE_CODE[s.charCodeAt(j + 1)]) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** First single * from `from` (one whose run is not **), outside an escape, or -1. Search stays inside [from, end). */
function findSingleStar(s, from, end) {
  for (let j = from; j < end; j++) {
    if (s.charCodeAt(j) === 92 && j + 1 < end && ESCAPABLE_CODE[s.charCodeAt(j + 1)]) {
      j++;
      continue;
    }
    if (s.charCodeAt(j) !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** The next inline-special character at or after `i`, or -1. (Shared regex: lastIndex is set before every exec.) */
const INLINE_RE = /[\\`*\[&<>"']/g;

/** `s[a..b)` rendered inline into `out`; `link(target)` resolves a link's href. */
function inlineInto(s, a, b, link, out) {
  let i = a;
  while (i < b) {
    const code = s.charCodeAt(i);
    if (code === 92) {
      // Backslash: before an escapable char it writes that character (escaped).
      if (i + 1 < b && ESCAPABLE_CODE[s.charCodeAt(i + 1)]) {
        const e = ESC_BY_CODE[s.charCodeAt(i + 1)];
        out.push(e === undefined ? s[i + 1] : e);
        i += 2;
      } else {
        out.push('\\');
        i++;
      }
      continue;
    }
    if (code === 96) {
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j < b && j > i + 1) {
        out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        i = j + 1;
      } else {
        out.push('`');
        i++;
      }
      continue;
    }
    if (code === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2, b);
        if (j > i + 2) {
          out.push('<strong>');
          inlineInto(s, i + 2, j, link, out);
          out.push('</strong>');
          i = j + 2;
        } else {
          out.push('**');
          i += 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1, b);
      if (j > i + 1) {
        out.push('<em>');
        inlineInto(s, i + 1, j, link, out);
        out.push('</em>');
        i = j + 1;
      } else {
        out.push('*');
        i++;
      }
      continue;
    }
    if (code === 91) {
      const k = findUnescaped(s, ']', i + 1, b);
      const m = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      if (m !== -1 && m < b) {
        const target = s.slice(k + 2, m);
        if (target !== '' && !/\s/.test(target)) {
          out.push('<a href="', escapeHtml(link(target)), '">');
          inlineInto(s, i + 1, k, link, out);
          out.push('</a>');
          i = m + 1;
          continue;
        }
      }
      out.push('[');
      i++;
      continue;
    }
    // A run of plain characters: copy it whole, escaping only & < > " '.
    // The scan for the next special character runs in the regexp engine.
    INLINE_RE.lastIndex = i;
    const m = INLINE_RE.exec(s);
    let j = m === null || m.index >= b ? b : m.index;
    if (j === i) {
      out.push(ESC_BY_CODE[code]);
      i++;
    } else {
      out.push(s.slice(i, j));
      i = j;
    }
  }
}

/** `s` rendered inline as one string. */
function inlineStr(s, link) {
  const out = [];
  inlineInto(s, 0, s.length, link, out);
  return out.join('');
}

/**
 * `bodyLines` rendered: { html, toc, excerpt }.
 * `link(target)` resolves a link's href; broken links are recorded by it.
 * Fragments go straight into one output array, joined once at the end.
 */
function renderMarkdown(bodyLines, link) {
  const ids = new Set();
  const out = [];
  const toc = [];
  let excerpt = null;
  const n = bodyLines.length;
  let i = 0;
  while (i < n) {
    const line = bodyLines[i];
    if (isBlankLine(line)) {
      i++;
      continue;
    }
    const lang = fenceLang(line);
    if (lang !== null) {
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      out.push(`<pre><code${cls}>`);
      i++;
      while (i < n && !fenceClose(bodyLines[i])) {
        out.push(escapeHtml(bodyLines[i++]));
        out.push('\n');
      }
      i++;
      out.push('</code></pre>', '\n');
      continue;
    }
    const h = headingOf(line);
    if (h !== null) {
      const id = uniqueSlug(slugify(h[1]), ids);
      const html = inlineStr(h[1], link);
      out.push(`<h${h[0]} id="${id}">`, html, `</h${h[0]}>`, '\n');
      if (h[0] === 2 || h[0] === 3) toc.push({ level: h[0], id, html });
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push('<hr>', '\n');
      i++;
      continue;
    }
    if (line[0] === '>') {
      const body = [];
      while (i < n && bodyLines[i][0] === '>') {
        let l = bodyLines[i++];
        l = l.slice(1);
        if (l[0] === ' ') l = l.slice(1);
        body.push(trimLine(l));
      }
      const kept = body.filter((l) => l !== '');
      out.push('<blockquote>\n');
      if (kept.length !== 0) {
        const joined = kept.join('\n');
        out.push('<p>');
        inlineInto(joined, 0, joined.length, link, out);
        out.push('</p>\n');
      }
      out.push('</blockquote>', '\n');
      continue;
    }
    const bullet = line[0] === '-' || line[0] === '*' ? (line[1] === ' ' ? line[0] : null) : null;
    let ordered = null;
    if (bullet === null) {
      let d = 0;
      while (d < line.length && line[d] >= '0' && line[d] <= '9' && d < 9) d++;
      if (d > 0 && line[d] === '.' && line[d + 1] === ' ') ordered = [line.slice(0, d), d];
    }
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = [];
      while (i < n) {
        const l = bodyLines[i];
        if (isOrdered) {
          let d = 0;
          while (d < l.length && l[d] >= '0' && l[d] <= '9' && d < 9) d++;
          if (d > 0 && l[d] === '.' && l[d + 1] === ' ') {
            items.push([trimLine(l.slice(d + 2))]);
            i++;
            continue;
          }
        } else if ((l[0] === '-' || l[0] === '*') && l[1] === ' ') {
          items.push([trimLine(l.slice(2))]);
          i++;
          continue;
        }
        if (l[0] === ' ' && l[1] === ' ') {
          // CONTINUED: two or more spaces then a non-space.
          let k = 0;
          while (k < l.length && l[k] === ' ') k++;
          const ch = l[k];
          if (k >= 2 && ch !== undefined && ch !== ' ' && ch !== '\t' && ch !== '\v' && ch !== '\f' && ch !== '\r') {
            items[items.length - 1].push(trimLine(l));
            i++;
            continue;
          }
        }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const start = isOrdered ? Number(ordered[0]) : 1;
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      out.push(`${open}\n`);
      for (const item of items) {
        const text = item.join('\n');
        out.push('<li>');
        inlineInto(text, 0, text.length, link, out);
        out.push('</li>\n');
      }
      out.push(`</${tag}>`, '\n');
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(bodyLines[i])) body.push(trimLine(bodyLines[i++]));
    const text = body.join('\n');
    if (excerpt === null) {
      // The first paragraph's inline HTML, rendered once and reused for both the block and the excerpt.
      const ex = [];
      inlineInto(text, 0, text.length, link, ex);
      excerpt = ex.join('');
      out.push('<p>', excerpt, '</p>', '\n');
    } else {
      out.push('<p>');
      inlineInto(text, 0, text.length, link, out);
      out.push('</p>', '\n');
    }
  }
  return { html: out.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;
const INCLUDE_DEPTH = 8;

// Op codes for the flat instruction list a template compiles to.
const OP_TEXT = 0;
const OP_VAR = 1;
const OP_RAW = 2;
const OP_IF = 3; // [3, not, path, elsePc, endPc]
const OP_JMP = 4; // [4, targetPc]
const OP_FOR = 5; // [5, name, path, endPc]
const OP_END = 6; // [6, forPc]
const OP_INC = 7; // [7, name]

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function isBlankText(s) {
  for (let i = 0; i < s.length; i++) if (s[i] !== ' ' && s[i] !== '\t') return false;
  return true;
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === len - 1) {
      text += src.slice(i);
      break;
    }
    const nx = src[open + 1];
    if (nx !== '{' && nx !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (nx === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? len : nl;
    const standalone = isBlankText(src.slice(lineStart, open)) && isBlankText(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? len : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` compiled into its flat op list (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const ops = [];
  const stack = [];
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') {
      ops.push([OP_TEXT, tok.text]);
      continue;
    }
    if (tok.t === 'var') {
      ops.push([OP_VAR, tok.path]);
      continue;
    }
    if (tok.t === 'raw') {
      ops.push([OP_RAW, tok.path]);
      continue;
    }
    const tag = tok.tag;
    let m;
    if ((m = FOR_RE.exec(tag)) !== null) {
      const op = [OP_FOR, m[1], pathOf(name, m[2]), 0];
      stack.push({ kind: 'for', op, opIdx: ops.length });
      ops.push(op);
    } else if ((m = IF_RE.exec(tag)) !== null) {
      const op = [OP_IF, m[1] !== undefined, pathOf(name, m[2]), 0, 0];
      stack.push({ kind: 'if', op, opIdx: ops.length, jmp: null });
      ops.push(op);
    } else if (tag === 'else') {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== 'if' || top.op[3] !== 0) throw new TemplateError(`template "${name}": an else outside an if`);
      top.op[3] = ops.length + 1;
      const jmp = [OP_JMP, 0];
      top.jmp = jmp;
      ops.push(jmp);
    } else if (tag === 'endfor' || tag === 'endif') {
      const top = stack[stack.length - 1];
      const want = tag === 'endfor' ? 'for' : 'if';
      if (!top || top.kind !== want) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
      stack.pop();
      if (want === 'for') {
        ops.push([OP_END, top.opIdx]);
        top.op[3] = ops.length;
      } else {
        if (top.jmp !== null) top.jmp[1] = ops.length;
        top.op[4] = ops.length;
      }
    } else if ((m = INCLUDE_RE.exec(tag)) !== null) {
      ops.push([OP_INC, m[1]]);
    } else {
      throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 0) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return ops;
}

/** Walk `path` from `v` onward (index `k`): an own property each step, or undefined. */
function walkProps(v, path, k) {
  for (; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/**
 * The value at `path` in the scope stack: its first name from the innermost
 * frame holding it (`loop` before the element in a for frame), else undefined.
 * Frames are plain vars objects or for-frames { n, v, loop }.
 */
function lookup(frames, path) {
  const first = path[0];
  for (let f = frames.length - 1; f >= 0; f--) {
    const fr = frames[f];
    if (fr.n !== undefined) {
      if (first === 'loop') return walkProps(fr.loop, path, 1);
      if (first === fr.n) return walkProps(fr.v, path, 1);
    } else if (Object.hasOwn(fr, first)) {
      return walkProps(fr[first], path, 1);
    }
  }
  return undefined;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** `ops` rendered into `out` (an array of strings, joined by the caller). */
function renderOps(ops, frames, templates, depth, out) {
  let pc = 0;
  const loopStack = [];
  while (pc < ops.length) {
    const op = ops[pc];
    switch (op[0]) {
      case OP_TEXT:
        out.push(op[1]);
        pc++;
        break;
      case OP_VAR:
        out.push(escapeHtml(textOf(lookup(frames, op[1]))));
        pc++;
        break;
      case OP_RAW:
        out.push(textOf(lookup(frames, op[1])));
        pc++;
        break;
      case OP_IF: {
        const v = truthy(lookup(frames, op[2]));
        if (v !== op[1]) pc++;
        else pc = op[3] !== 0 ? op[3] : op[4];
        break;
      }
      case OP_JMP:
        pc = op[1];
        break;
      case OP_FOR: {
        const xs = lookup(frames, op[2]);
        if (!Array.isArray(xs) || xs.length === 0) {
          pc = op[3];
          break;
        }
        const frame = { n: op[1], v: xs[0], loop: { index: 1, first: true, last: xs.length === 1, length: xs.length } };
        frames.push(frame);
        loopStack.push({ forPc: pc, arr: xs, idx: 0, frame });
        pc++;
        break;
      }
      case OP_END: {
        const L = loopStack[loopStack.length - 1];
        if (L.idx + 1 < L.arr.length) {
          L.idx++;
          L.frame.v = L.arr[L.idx];
          L.frame.loop.index = L.idx + 1;
          L.frame.loop.first = false;
          L.frame.loop.last = L.idx === L.arr.length - 1;
          pc = L.forPc + 1;
        } else {
          loopStack.pop();
          frames.pop();
          pc++;
        }
        break;
      }
      case OP_INC: {
        const t = templates.get(op[1]);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderOps(t, frames, templates, depth + 1, out);
        pc++;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- the build

const RESERVED = ['posts', 'tags', 'page'];

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** `rel` from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** A page's link record as templates read it. */
function linkOf(s) {
  if (s === null) return null;
  return { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) };
}

/** A post's card, as lists show it. */
function cardOf(s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.bodyText) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

/** A page as its layout reads it. */
function pageOf(s) {
  const c = cardOf(s);
  c.slug = s.slug;
  c.content = s.html;
  c.toc = s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html }));
  c.newer = linkOf(s.newer ?? null);
  c.older = linkOf(s.older ?? null);
  c.is_post = s.post;
  return c;
}

/** One site's output tree: path -> text. */
export function run(input) {
  const site = input.site;
  const base = site.base_url.replace(/\/+$/, '');
  const output = {};

  // Templates, parsed in code-unit order of name; one that does not parse is reported and left out.
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of names) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  // Sources in code-unit order of path; .md is a source, anything else static.
  const files = [...input.files].sort((a, b) => byCodeUnits(a.path, b.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, lines: text.split('\n') });
    } else statics.push(f);
  }

  // Front matter: a refused source is reported and dropped, and so is a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.lines);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.bodyLines = fm.bodyLines;
    s.bodyText = fm.bodyLines.join('\n');
    s.post = s.path.startsWith('posts/');
    let own = null;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== null) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // Permalinks: each page's slug made unique in its directory, in source order.
  const taken = new Map();
  const slugCache = new Map();
  const slugOf = (text) => {
    let s = slugCache.get(text);
    if (s === undefined) {
      s = slugify(text);
      slugCache.set(text, s);
    }
    return s;
  };
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugOf(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // Markdown: each body's HTML, its links resolved, its toc and excerpt.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const link = (target) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target[0] === '/' || target[0] === '#') return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.bodyLines, link);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // Collections: posts newest first, equal dates by slug; each post's neighbours.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // Tags: grouped by slug, each named as first met in the posts' order, ordered by count then slug.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugOf(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugOf(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugOf(name)) ?? { name, slug: slugOf(name), url: '', posts: [] });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // Layouts: every page through its layout, the index pages, the tag pages, the tags page, then statics.
  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const rootVars = {
    site: { title: site.title, base_url: base },
    tags: tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length })),
    recent: posts.slice(0, site.recent).map((p) => cards.get(p)),
  };
  const frames = [rootVars, null];
  const render = (name, extra) => {
    const ops = templates.get(name);
    if (ops === undefined) return null;
    const out = [];
    frames[1] = extra;
    renderOps(ops, frames, templates, 0, out);
    frames[1] = null;
    return out.join('');
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // The report: every line reported above, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
