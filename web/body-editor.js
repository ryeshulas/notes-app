// Line-based note body: each line is plain text, a bullet, a numbered item or a checklist item,
// optionally indented (sub-lists), with formatted text runs.
// Stored as blocks: [{ t: 'p'|'ul'|'ol'|'todo', s: 'plain text', d: done, i: indent 0-4, r: runs? }]
// Runs: [{ s: 'text', b, i, u, x (strike), c: color, h: highlight, f: font }]
'use strict';

const BodyEditor = (() => {
  const TYPES = ['p', 'ul', 'ol', 'todo', 'img'];
  const IMG_SIZES = { s: 33, m: 66, l: 100 };
  const MAX_INDENT = 4;
  const BULLETS = ['•', '◦', '▪', '•', '◦'];
  const STYLE_KEYS = ['b', 'i', 'u', 'x', 'c', 'h', 'f'];
  const FONTS = ['serif', 'mono', 'hand', 'round'];
  const ZW = '​';

  // ---------------------------------------------------------------- numbering
  function roman(n) {
    const map = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let out = '';
    for (const [v, r] of map) while (n >= v) { out += r; n -= v; }
    return out;
  }
  function letter(n) {
    let s = '';
    while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  }
  function numberLabel(n, level) {
    const style = level % 3;
    return `${style === 0 ? n : style === 1 ? letter(n) : roman(n)}.`;
  }
  function labels(blocks) {
    const counters = [];
    return blocks.map((b) => {
      const lv = b.i || 0;
      counters.length = Math.min(counters.length, lv + 1);
      if (b.t === 'ol') { counters[lv] = (counters[lv] || 0) + 1; return numberLabel(counters[lv], lv); }
      counters[lv] = 0;
      if (b.t === 'ul') return BULLETS[lv] || '•';
      if (b.t === 'todo') return b.d ? '☑' : '☐';
      return '';
    });
  }

  // ---------------------------------------------------------------- runs (formatted text)
  const styleOf = (r) => { const o = {}; for (const k of STYLE_KEYS) if (r[k]) o[k] = r[k]; return o; };
  const sameStyle = (a, b) => STYLE_KEYS.every((k) => (a[k] || null) === (b[k] || null));
  const runsText = (runs) => runs.map((r) => r.s).join('');

  function normRuns(runs) {
    const out = [];
    for (const r of runs) {
      if (!r.s) continue;
      const last = out[out.length - 1];
      if (last && sameStyle(last, r)) last.s += r.s;
      else out.push({ s: r.s, ...styleOf(r) });
    }
    return out;
  }
  function sliceRuns(runs, start, end = Infinity) {
    const out = [];
    let pos = 0;
    for (const r of runs) {
      const a = pos, b = pos + r.s.length;
      pos = b;
      const s = Math.max(start, a), e = Math.min(end, b);
      if (e > s) out.push({ ...r, s: r.s.slice(s - a, e - a) });
    }
    return out;
  }
  function runsOf(b) { return b.r && b.r.length ? b.r : (b.s ? [{ s: b.s }] : []); }
  function setRuns(b, runs) {
    const n = normRuns(runs);
    b.s = runsText(n);
    b.r = n.some((r) => Object.keys(styleOf(r)).length) ? n : null;
  }
  function styleAt(runs, offset) {
    let pos = 0;
    for (const r of runs) {
      if (offset > pos && offset <= pos + r.s.length) return styleOf(r);
      pos += r.s.length;
    }
    return runs.length && offset === 0 ? styleOf(runs[0]) : {};
  }
  function applyStyle(runs, start, end, key, value) {
    const mid = sliceRuns(runs, start, end).map((r) => {
      const n = { ...r };
      if (value) n[key] = value; else delete n[key];
      return n;
    });
    return normRuns([...sliceRuns(runs, 0, start), ...mid, ...sliceRuns(runs, end)]);
  }
  function rangeHas(runs, start, end, key, value) {
    const mid = sliceRuns(runs, start, end);
    return mid.length > 0 && mid.every((r) => r[key] === value);
  }

  // Apply a run's style to an element (also used for labels on drawings).
  function styleElement(el, st) {
    el.style.fontWeight = st.b ? '700' : '';
    el.style.fontStyle = st.i ? 'italic' : '';
    const deco = [st.u && 'underline', st.x && 'line-through'].filter(Boolean).join(' ');
    el.style.textDecoration = deco;
    el.style.color = st.c ? (window.inkColor ? window.inkColor(st.c) : st.c) : '';
    el.style.backgroundColor = st.h || '';
    el.className = st.f && FONTS.includes(st.f) ? `f-${st.f}` : '';
  }

  // ---------------------------------------------------------------- text conversion
  function textFromBlocks(blocks) {
    const lab = labels(blocks);
    return blocks.map((b, k) => {
      const pad = '  '.repeat(b.i || 0);
      if (b.t === 'img') return '[image]';
      return b.t === 'p' ? pad + b.s : `${pad}${lab[k]} ${b.s}`;
    }).join('\n').replace(/\s+$/, '');
  }
  function parseLine(line) {
    const indent = Math.min(MAX_INDENT, Math.floor((/^ */.exec(line)[0].length) / 2));
    const rest = line.replace(/^\s+/, '');
    let m;
    if ((m = /^[•◦▪\-*]\s+(.*)$/.exec(rest))) return { t: 'ul', s: m[1], d: false, i: indent, r: null };
    if ((m = /^\d+[.)]\s+(.*)$/.exec(rest))) return { t: 'ol', s: m[1], d: false, i: indent, r: null };
    if (indent > 0 && (m = /^[a-z]{1,4}[.)]\s+(.*)$/.exec(rest))) return { t: 'ol', s: m[1], d: false, i: indent, r: null };
    if ((m = /^(☐|☑|\[ ?\]|\[[xX]\])\s*(.*)$/.exec(rest))) return { t: 'todo', s: m[2], d: m[1] === '☑' || /x/i.test(m[1]), i: indent, r: null };
    return { t: 'p', s: line, d: false, i: 0, r: null };
  }
  function listLike(s) {
    let m;
    if ((m = /^\s*\d+[.)]\s*(?!\d)(\S.*)$/.exec(s))) return { t: 'ol', s: m[1] };
    if ((m = /^\s*\*\s*(\S.*)$/.exec(s))) return { t: 'ul', s: m[1] };
    if ((m = /^\s*[-•]\s+(\S.*)$/.exec(s))) return { t: 'ul', s: m[1] };
    return null;
  }
  function blocksFromText(text) { return (text || '').split('\n').map(parseLine); }
  function clean(b) {
    const out = { t: TYPES.includes(b.t) ? b.t : 'p', s: String(b.s || ''), d: !!b.d, i: Math.max(0, Math.min(MAX_INDENT, b.i | 0)), r: null };
    if (Array.isArray(b.r) && runsText(b.r) === out.s) out.r = normRuns(b.r.map((r) => ({ s: String(r.s || ''), ...styleOf(r) })));
    if (out.t === 'img') {
      if (typeof b.file !== 'string' || !b.file) return { t: 'p', s: '', d: false, i: 0, r: null };
      Object.assign(out, { s: '', r: null, i: 0, file: b.file, z: IMG_SIZES[b.z] ? b.z : 'l' });
    }
    return out;
  }
  function blocksForNote(data) {
    if (Array.isArray(data.blocks) && data.blocks.length) {
      const blocks = data.blocks.map(clean);
      if (textFromBlocks(blocks) === (data.text || '').replace(/\s+$/, '')) return blocks;
    }
    return blocksFromText(data.text || '');
  }

  // ---------------------------------------------------------------- caret helpers
  function offsetIn(el, node, off) {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    try { pre.setEnd(node, off); } catch { return 0; }
    return pre.toString().replaceAll(ZW, '').length;
  }
  function caretOffset(el) {
    const sel = getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    return { start: offsetIn(el, r.startContainer, r.startOffset), collapsed: r.collapsed };
  }
  function locate(el, offset) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, left = offset, last = null;
    while ((node = walker.nextNode())) {
      last = node;
      const len = node.data.replaceAll(ZW, '').length;
      if (left <= len) {
        // map offset ignoring zero-width chars
        let i = 0, seen = 0;
        while (i < node.data.length && (seen < left || node.data[i] === ZW)) { if (node.data[i] !== ZW) seen++; i++; }
        return { node, offset: i };
      }
      left -= len;
    }
    return last ? { node: last, offset: last.data.length } : { node: el, offset: el.childNodes.length };
  }
  function setCaret(el, offset) {
    el.focus();
    const p = locate(el, offset);
    const r = document.createRange();
    r.setStart(p.node, p.offset);
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Read formatted runs back from the DOM (our spans carry data-* style attributes).
  function readRuns(el) {
    const out = [];
    const walk = (node, st) => {
      if (node.nodeType === 3) { const s = node.data.replaceAll(ZW, '').replace(/\n/g, ' '); if (s) out.push({ s, ...st }); return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BR') return;
      const n = { ...st };
      const ds = node.dataset || {};
      for (const k of STYLE_KEYS) if (ds[k] !== undefined) n[k] = ds[k] === '1' ? 1 : ds[k];
      if (/^(B|STRONG)$/.test(node.tagName)) n.b = 1;
      if (/^(I|EM)$/.test(node.tagName)) n.i = 1;
      if (node.tagName === 'U') n.u = 1;
      if (/^(S|STRIKE|DEL)$/.test(node.tagName)) n.x = 1;
      node.childNodes.forEach((c) => walk(c, n));
    };
    el.childNodes.forEach((c) => walk(c, {}));
    return normRuns(out);
  }
  // ---- web links: text that looks like a web address is shown as a link ----
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  function hrefOf(text) { return /^www\./i.test(text) ? `https://${text}` : text; }
  function linkify(el) {
    el.querySelectorAll('a.lnk').forEach((a) => a.replaceWith(...a.childNodes));
    el.normalize();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.data;
      URL_RE.lastIndex = 0;
      let m, last = 0;
      const parts = [];
      while ((m = URL_RE.exec(text))) {
        let url = m[0].replace(/[.,;:!?)\]]+$/, '');   // leave trailing punctuation out of the link
        if (url.length < 5) continue;
        parts.push(text.slice(last, m.index));
        const a = document.createElement('a');
        a.className = 'lnk';
        a.href = hrefOf(url);
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = url;
        parts.push(a);
        last = m.index + url.length;
      }
      if (!parts.length) continue;
      parts.push(text.slice(last));
      node.replaceWith(...parts.filter((p) => p !== ''));
    }
  }
  function renderRuns(el, runs) {
    el.textContent = '';
    for (const r of runs) {
      const st = styleOf(r);
      if (!Object.keys(st).length) { el.append(document.createTextNode(r.s)); continue; }
      const span = document.createElement('span');
      for (const [k, v] of Object.entries(st)) span.dataset[k] = v === 1 ? '1' : v;
      styleElement(span, st);
      span.textContent = r.s;
      el.append(span);
    }
  }

  // ---------------------------------------------------------------- the editor
  function create(root, { onChange, onSelectionStyle, onPick, fileURL, placeholder = 'Type here…' } = {}) {
    let blocks = [clean({ t: 'p', s: '' })];
    let lastIndex = 0;
    let lastSel = null;   // {a:{line,off}, f:{line,off}} — kept so toolbar controls work after focus moves

    const lineEls = () => [...root.querySelectorAll('.line')];
    const textEl = (i) => lineEls()[i]?.querySelector('.txt');
    const indexOf = (el) => lineEls().indexOf(el.closest('.line'));
    // ---- undo / redo: snapshots of the whole body; bursts of typing are grouped ----
    let hist = [], hpos = -1, lastPush = 0, applying = false;
    const snapshot = () => ({ blocks: JSON.stringify(blocks), sel: liveSelection() || lastSel });
    function record(kind) {
      if (applying) return;
      const snap = snapshot();
      if (hpos >= 0 && hist[hpos].blocks === snap.blocks) { hist[hpos].sel = snap.sel; return; }
      const now = Date.now();
      if (kind === 'typing' && hpos > 0 && hist[hpos].kind === 'typing' && now - lastPush < 1000) {
        hist[hpos] = { ...snap, kind };
      } else {
        hist = hist.slice(0, hpos + 1);
        hist.push({ ...snap, kind });
        if (hist.length > 200) hist.shift();
        hpos = hist.length - 1;
      }
      lastPush = now;
    }
    function restoreState(st) {
      applying = true;
      blocks = JSON.parse(st.blocks).map(clean);
      render();
      try { if (st.sel) restoreSelection(st.sel); } catch { /* lines changed */ }
      applying = false;
      onChange && onChange();
    }
    function undo() { if (hpos > 0) { hpos--; restoreState(hist[hpos]); } }
    function redo() { if (hpos < hist.length - 1) { hpos++; restoreState(hist[hpos]); } }
    const changed = (kind = 'edit') => { readAll(); record(kind); onChange && onChange(); };

    function render() {
      root.textContent = '';
      const lab = labels(blocks);
      blocks.forEach((b, i) => {
        if (b.t === 'img') { root.append(renderImage(b, i)); return; }
        const line = document.createElement('div');
        line.className = `line t-${b.t}${b.t === 'todo' && b.d ? ' done' : ''}`;
        line.style.paddingLeft = `${(b.i || 0) * 1.6}em`;
        const marker = document.createElement('span');
        marker.className = 'marker';
        marker.contentEditable = 'false';
        if (b.t === 'ul' || b.t === 'ol') marker.textContent = lab[i];
        else if (b.t === 'todo') {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = b.d;
          cb.setAttribute('aria-label', 'Done');
          cb.addEventListener('change', () => { blocks[i].d = cb.checked; line.classList.toggle('done', cb.checked); changed(); });
          marker.append(cb);
        }
        const txt = document.createElement('div');
        txt.className = 'txt';
        txt.contentEditable = 'true';
        txt.spellcheck = true;
        renderRuns(txt, runsOf(b));
        linkify(txt);
        if (blocks.length === 1 && b.t === 'p') txt.dataset.placeholder = placeholder;
        line.append(marker, txt);
        root.append(line);
      });
    }

    function renderImage(b, i) {
      const line = document.createElement('div');
      line.className = 'line t-img';
      line.contentEditable = 'false';
      const fig = document.createElement('div');
      fig.className = 'body-img';
      fig.style.width = `${IMG_SIZES[b.z] || 100}%`;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      fig.append(img);
      if (fileURL) fileURL(b.file).then((u) => { if (u) img.src = u; else fig.classList.add('missing'); });
      const tools = document.createElement('div');
      tools.className = 'img-tools';
      for (const [z, label] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Full width']]) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = b.z === z ? 'on' : '';
        btn.addEventListener('click', (e) => { e.stopPropagation(); readAll(); blocks[i].z = z; render(); changed(); });
        tools.append(btn);
      }
      const del = document.createElement('button');
      del.textContent = '🗑 Remove';
      del.className = 'danger';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        readAll();
        blocks.splice(i, 1);
        if (!blocks.length) blocks.push(clean({ t: 'p', s: '' }));
        render();
        const target = Math.min(i, blocks.length - 1);
        if (blocks[target].t !== 'img') focusLine(target, 0);
        changed();
      });
      tools.append(del);
      fig.append(tools);
      fig.addEventListener('click', () => {
        root.querySelectorAll('.body-img.show').forEach((x) => { if (x !== fig) x.classList.remove('show'); });
        fig.classList.toggle('show');
      });
      line.append(fig);
      return line;
    }
    // nearest text line in a direction (skips image lines)
    function textLine(i, dir) {
      for (let j = i; j >= 0 && j < blocks.length; j += dir) if (blocks[j].t !== 'img') return j;
      return -1;
    }

    function focusLine(i, offset) {
      const el = textEl(i);
      if (!el) return;
      lastIndex = i;
      setCaret(el, offset === 'end' ? blocks[i].s.length : offset);
    }
    function readLine(i) {
      if (blocks[i]?.t === 'img') return;
      const el = textEl(i);
      if (el) setRuns(blocks[i], readRuns(el));
    }
    function readAll() { blocks.forEach((_, i) => readLine(i)); }
    function structural(i, offset) { render(); focusLine(i, offset); changed(); }

    function promoteToList(i) {
      const b = blocks[i], prev = blocks[i - 1];
      if (b.t !== 'p' || !prev) return null;
      const cur = listLike(b.s);
      if (!cur) return null;
      const prevLike = prev.t === 'p' ? listLike(prev.s) : null;
      if (prev.t === 'p' && !(prevLike && prevLike.t === cur.t)) return null;
      if (prev.t !== 'p' && prev.t !== cur.t) return null;
      if (prev.t === 'p') { const cut = prev.s.length - prevLike.s.length; setRuns(prev, sliceRuns(runsOf(prev), cut)); prev.t = cur.t; prev.d = false; }
      const removed = b.s.length - cur.s.length;
      setRuns(b, sliceRuns(runsOf(b), removed));
      Object.assign(b, { t: cur.t, d: false, i: prev.i || 0 });
      return removed;
    }

    function splitAt(i) {
      readLine(i);
      const el = textEl(i);
      let pos = caretOffset(el)?.start ?? blocks[i].s.length;
      const b = blocks[i];
      if (b.t !== 'p' && b.s === '') { if (b.i > 0) b.i--; else b.t = 'p'; return structural(i, 0); }
      const removed = promoteToList(i);
      if (removed !== null) pos = Math.max(0, pos - removed);
      const runs = runsOf(b);
      const nb = { t: b.t, s: '', d: false, i: b.i || 0, r: null };
      setRuns(nb, sliceRuns(runs, pos));
      setRuns(b, sliceRuns(runs, 0, pos));
      blocks.splice(i + 1, 0, nb);
      structural(i + 1, 0);
    }

    function backspaceAtStart(i) {
      readLine(i);
      const b = blocks[i];
      if (b.i > 0) { b.i--; return structural(i, 0); }
      if (b.t !== 'p') { b.t = 'p'; b.d = false; return structural(i, 0); }
      if (i === 0) return;
      if (blocks[i - 1].t === 'img') {
        // an empty line right after a picture is removed; otherwise just hop above the picture
        if (!b.s) { blocks.splice(i, 1); render(); const up = textLine(i - 1, -1); if (up >= 0) focusLine(up, 'end'); changed(); }
        else { const up = textLine(i - 1, -1); if (up >= 0) focusLine(up, 'end'); }
        return;
      }
      readLine(i - 1);
      const prev = blocks[i - 1];
      const len = prev.s.length;
      setRuns(prev, [...runsOf(prev), ...runsOf(b)]);
      blocks.splice(i, 1);
      structural(i - 1, len);
    }

    function deleteAtEnd(i) {
      if (i >= blocks.length - 1 || blocks[i + 1].t === 'img') return;
      readLine(i); readLine(i + 1);
      const len = blocks[i].s.length;
      setRuns(blocks[i], [...runsOf(blocks[i]), ...runsOf(blocks[i + 1])]);
      blocks.splice(i + 1, 1);
      structural(i, len);
    }

    function indent(i, delta) {
      readLine(i);
      const el = textEl(i);
      const pos = (el && caretOffset(el)?.start) ?? blocks[i].s.length;
      const b = blocks[i];
      const maxHere = i === 0 || blocks[i - 1].t === 'img' ? 0 : Math.min(MAX_INDENT, (blocks[i - 1].i || 0) + 1);
      const next = Math.max(0, Math.min(maxHere, (b.i || 0) + delta));
      if (next === b.i) return;
      b.i = next;
      structural(i, pos);
    }

    function insertLines(i, text) {
      readLine(i);
      const el = textEl(i);
      const pos = caretOffset(el)?.start ?? blocks[i].s.length;
      const b = blocks[i];
      const runs = runsOf(b);
      const before = sliceRuns(runs, 0, pos), after = sliceRuns(runs, pos);
      const parsed = text.replace(/\r\n?/g, '\n').split('\n').map(parseLine);
      if (pos === 0 && parsed[0].t !== 'p') Object.assign(b, { t: parsed[0].t, d: parsed[0].d, i: parsed[0].i });
      setRuns(b, [...before, { s: parsed[0].s }]);
      const rest = parsed.slice(1);
      blocks.splice(i + 1, 0, ...rest);
      const last = i + rest.length;
      const lastLen = blocks[last].s.length;
      setRuns(blocks[last], [...runsOf(blocks[last]), ...after]);
      structural(last, lastLen);
    }

    function autoFormat(i) {
      const b = blocks[i];
      if (b.t !== 'p') return false;
      const m = /^(\[ ?\]|\[[xX]\])\s(.*)$/.exec(b.s);
      if (!m) return false;
      setRuns(b, sliceRuns(runsOf(b), b.s.length - m[2].length));
      Object.assign(b, { t: 'todo', d: /x/i.test(m[1]) });
      structural(i, 0);
      return true;
    }

    // ---- selection tracking & formatting ----
    function liveSelection() {
      const sel = getSelection();
      if (!sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      const aEl = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest?.('.txt');
      const fEl = (r.endContainer.nodeType === 1 ? r.endContainer : r.endContainer.parentElement)?.closest?.('.txt');
      if (!aEl || !fEl || !root.contains(aEl) || !root.contains(fEl)) return null;
      return {
        a: { line: indexOf(aEl), off: offsetIn(aEl, r.startContainer, r.startOffset) },
        f: { line: indexOf(fEl), off: offsetIn(fEl, r.endContainer, r.endOffset) },
      };
    }
    function restoreSelection(s) {
      const aEl = textEl(s.a.line), fEl = textEl(s.f.line);
      if (!aEl || !fEl) return;
      aEl.focus();
      const a = locate(aEl, s.a.off), f = locate(fEl, s.f.off);
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(f.node, f.offset);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    function currentStyle() {
      const s = liveSelection() || lastSel;
      if (!s) return {};
      readLine(s.a.line);
      const runs = runsOf(blocks[s.a.line]);
      const collapsed = s.a.line === s.f.line && s.a.off === s.f.off;
      if (collapsed) {
        // a pending style span at the caret wins
        const sel = getSelection();
        const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        const span = node?.closest?.('span[data-b],span[data-i],span[data-u],span[data-x],span[data-c],span[data-h],span[data-f]');
        if (span && root.contains(span)) { const st = {}; for (const k of STYLE_KEYS) if (span.dataset[k]) st[k] = span.dataset[k] === '1' ? 1 : span.dataset[k]; return st; }
        return styleAt(runs, s.a.off);
      }
      return styleAt(runs, s.a.off + 1);
    }

    root.addEventListener('focusout', (e) => {
      const el = e.target.closest?.('.txt');
      if (el && !el.querySelector('.lnk') && !URL_RE.test(el.textContent)) { URL_RE.lastIndex = 0; return; }
      URL_RE.lastIndex = 0;
      if (el) linkify(el);
    });
    root.addEventListener('click', (e) => {
      const a = e.target.closest?.('a.lnk');
      if (!a) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) window.open(a.href, '_blank', 'noopener');
    });
    // A small "Open link" button appears when the cursor is in a link.
    const linkTip = document.createElement('a');
    linkTip.className = 'link-tip hidden';
    linkTip.target = '_blank';
    linkTip.rel = 'noopener';
    linkTip.addEventListener('pointerdown', (e) => e.preventDefault());
    linkTip.addEventListener('click', () => linkTip.classList.add('hidden'));
    document.body.append(linkTip);
    const hideTip = () => linkTip.classList.add('hidden');
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      const n = sel.rangeCount ? sel.anchorNode : null;
      const a = n && (n.nodeType === 1 ? n : n.parentElement)?.closest?.('a.lnk');
      if (!a || !root.contains(a)) { hideTip(); return; }
      linkTip.href = a.href;
      let host = a.href;
      try { host = new URL(a.href).hostname; } catch { /* keep the full address */ }
      linkTip.textContent = `↗ Open ${host}`;
      linkTip.classList.remove('hidden');
      const r = a.getBoundingClientRect();
      const w = linkTip.offsetWidth;
      linkTip.style.left = `${Math.max(6, Math.min(r.left, innerWidth - w - 6))}px`;
      linkTip.style.top = `${r.bottom + 6 + w * 0}px`;
    });
    root.closest('#editor-scroll')?.addEventListener('scroll', hideTip);
    document.addEventListener('selectionchange', () => {
      const s = liveSelection();
      if (s) { lastSel = s; lastIndex = s.f.line; onSelectionStyle && onSelectionStyle(currentStyle()); }
    });

    // key: b/i/u/x toggle (value ignored) or c/h/f set (value null = default)
    function format(key, value) {
      const s = liveSelection() || lastSel;
      if (!s) return;
      const toggle = ['b', 'i', 'u', 'x'].includes(key);
      const collapsed = s.a.line === s.f.line && s.a.off === s.f.off;
      readAll();
      if (collapsed) {
        // Nothing selected: style what you type next.
        const el = textEl(s.a.line);
        restoreSelection(s);
        const st = currentStyle();
        if (toggle) { if (st[key]) delete st[key]; else st[key] = 1; } else if (value) st[key] = value; else delete st[key];
        const span = document.createElement('span');
        for (const [k, v] of Object.entries(st)) span.dataset[k] = v === 1 ? '1' : v;
        styleElement(span, st);
        span.textContent = ZW;
        const sel = getSelection();
        const r = sel.getRangeAt(0);
        // don't nest inside an existing styled span: split out of it
        const host = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
        if (host !== el && host.tagName === 'SPAN') {
          const pos = s.a.off;
          readLine(s.a.line);
          renderRuns(el, runsOf(blocks[s.a.line]));
          linkify(el);
          const p = locate(el, pos);
          const rr = document.createRange();
          rr.setStart(p.node, p.offset);
          // place the new span after the text node split point
          if (p.node.nodeType === 3 && p.node.parentElement !== el) {
            const parentSpan = p.node.parentElement;
            const tail = p.node.splitText(p.offset);
            const tailSpan = parentSpan.cloneNode(false);
            tailSpan.append(tail, ...[...parentSpan.childNodes].slice([...parentSpan.childNodes].indexOf(tail) + 1));
            parentSpan.after(span, tailSpan);
          } else rr.insertNode(span);
        } else r.insertNode(span);
        const nr = document.createRange();
        nr.setStart(span.firstChild, 1);
        nr.collapse(true);
        sel.removeAllRanges();
        sel.addRange(nr);
        onSelectionStyle && onSelectionStyle(st);
        return;
      }
      let a = s.a, f = s.f;
      if (a.line > f.line || (a.line === f.line && a.off > f.off)) [a, f] = [f, a];
      const span = (line) => [line === a.line ? a.off : 0, line === f.line ? f.off : blocks[line].s.length];
      let v = value;
      if (toggle) {
        let all = true;
        for (let l = a.line; l <= f.line; l++) { const [x, y] = span(l); if (y > x && !rangeHas(runsOf(blocks[l]), x, y, key, 1)) all = false; }
        v = all ? null : 1;
      }
      for (let l = a.line; l <= f.line; l++) {
        const [x, y] = span(l);
        if (y > x) setRuns(blocks[l], applyStyle(runsOf(blocks[l]), x, y, key, v));
      }
      render();
      restoreSelection({ a, f });
      lastSel = { a, f };
      changed();
      onSelectionStyle && onSelectionStyle(currentStyle());
    }

    root.addEventListener('focusin', (e) => { const i = indexOf(e.target); if (i >= 0) lastIndex = i; });

    // ---- picking whole lines (drag across lines, Shift+click, Ctrl+A) to copy, cut or delete ----
    let picked = null;   // [first, last] line index
    let dragFrom = null;
    function lineOf(node) {
      let n = node && (node.nodeType === 1 ? node : node.parentElement);
      while (n && n.parentElement !== root) n = n.parentElement;
      return n ? [...root.children].indexOf(n) : null;
    }
    function showPicked() {
      [...root.children].forEach((el, k) => el.classList.toggle('picked', !!picked && k >= picked[0] && k <= picked[1]));
      onPick && onPick(picked ? picked[1] - picked[0] + 1 : 0);
    }
    function pick(a, b) {
      picked = a == null ? null : [Math.min(a, b), Math.max(a, b)];
      if (picked) getSelection().removeAllRanges();
      showPicked();
    }
    function pickedText() {
      if (!picked) return '';
      readAll();
      return textFromBlocks(blocks.slice(picked[0], picked[1] + 1).filter((b) => b.t !== 'img'));
    }
    // Remove the picked lines; with keepLine an empty line is left in their place. Returns that line's index.
    function deletePicked(keepLine) {
      if (!picked) return -1;
      readAll();
      const [a, b] = picked;
      picked = null;
      blocks.splice(a, b - a + 1, ...(keepLine ? [clean({ t: 'p', s: '' })] : []));
      if (!blocks.length) blocks = [clean({ t: 'p', s: '' })];
      let j = Math.min(a, blocks.length - 1);
      if (blocks[j].t === 'img') j = Math.max(0, textLine(j, -1));
      structural(j, 0);
      showPicked();
      return j;
    }
    root.addEventListener('pointerdown', (e) => {
      const line = lineOf(e.target);
      if (e.pointerType === 'mouse' && e.button === 0 && line != null && e.shiftKey) {
        const from = picked ? picked[0] : lastIndex;
        if (from !== line) { e.preventDefault(); pick(from, line); return; }
      }
      if (picked) pick(null);
      dragFrom = e.pointerType === 'mouse' && e.button === 0 ? line : null;
    });
    document.addEventListener('pointermove', (e) => {
      if (dragFrom == null) return;
      if (!(e.buttons & 1)) { dragFrom = null; return; }
      const l = lineOf(document.elementFromPoint(e.clientX, e.clientY));
      if (l != null && l !== dragFrom) pick(dragFrom, l);
      else if (l === dragFrom && picked) pick(null);
    });
    document.addEventListener('pointerup', () => { dragFrom = null; });
    root.addEventListener('copy', (e) => {
      if (!picked) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', pickedText());
    });
    root.addEventListener('cut', (e) => {
      if (!picked) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', pickedText());
      deletePicked(false);
    });

    root.addEventListener('keydown', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      const modKey = (e.ctrlKey || e.metaKey) && !e.altKey;
      if (modKey && e.key.toLowerCase() === 'a') { e.preventDefault(); pick(0, blocks.length - 1); return; }
      if (picked) {
        const k = e.key.toLowerCase();
        if (modKey && (k === 'c' || k === 'x' || k === 'v')) return;     // copy / cut / paste events handle these
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deletePicked(false); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pick(null); return; }
        if (e.key.length === 1 && !modKey) {      // typing replaces the picked lines
          e.preventDefault();
          deletePicked(true);
          document.execCommand('insertText', false, e.key);
          return;
        }
        if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) return;
        pick(null);
      }
      const i = indexOf(el);
      const c = caretOffset(el);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
        if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); format(k, 1); return; }
        if (e.shiftKey && k === 'x') { e.preventDefault(); format('x', 1); return; }
      }
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); splitAt(i); return; }
      if (e.key === 'Tab') { e.preventDefault(); indent(i, e.shiftKey ? -1 : 1); return; }
      if (e.key === 'Backspace' && c && c.collapsed && c.start === 0) { e.preventDefault(); backspaceAtStart(i); return; }
      if (e.key === 'Delete' && c && c.collapsed && c.start === blocks[i].s.length && el.textContent.replaceAll(ZW, '').length === c.start) { e.preventDefault(); deleteAtEnd(i); return; }
      if (e.key === 'ArrowUp' && i > 0) {
        const r = getSelection().getRangeAt(0).getBoundingClientRect();
        const top = el.getBoundingClientRect().top;
        const j = textLine(i - 1, -1);
        if (j >= 0 && (!r.height || r.top - top < 6)) { e.preventDefault(); readLine(j); focusLine(j, Math.min(c?.start ?? 0, blocks[j].s.length)); }
      }
      if (e.key === 'ArrowDown' && i < blocks.length - 1) {
        const r = getSelection().getRangeAt(0).getBoundingClientRect();
        const bottom = el.getBoundingClientRect().bottom;
        const j = textLine(i + 1, 1);
        if (j >= 0 && (!r.height || bottom - r.bottom < 6)) { e.preventDefault(); readLine(j); focusLine(j, Math.min(c?.start ?? 0, blocks[j].s.length)); }
      }
    });

    root.addEventListener('beforeinput', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      const i = indexOf(el);
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); splitAt(i); return; }
      if (e.inputType === 'insertFromDrop' || e.inputType.startsWith('format')) { e.preventDefault(); return; }
      if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
      if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); return; }
      if (e.inputType === 'deleteContentBackward') {
        const c = caretOffset(el);
        if (c && c.collapsed && c.start === 0) { e.preventDefault(); backspaceAtStart(i); }
      }
    });

    function pasteText(i, text) {
      if (text.includes('\n')) insertLines(i, text);
      else document.execCommand('insertText', false, text);
    }
    root.addEventListener('paste', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;      // e.g. a picture: the app adds it to the drawing
      e.preventDefault();
      if (picked) { pasteText(deletePicked(true), text); return; }
      pasteText(indexOf(el), text);
    });

    root.addEventListener('input', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      const i = indexOf(el);
      readLine(i);
      if (el.dataset.placeholder && blocks[i].s) delete el.dataset.placeholder;
      if (!autoFormat(i)) changed('typing');
    });

    return {
      pickAll() { readAll(); pick(0, blocks.length - 1); },
      clearPick() { if (picked) pick(null); },
      pickedCount() { return picked ? picked[1] - picked[0] + 1 : 0; },
      pickedText,
      deletePicked() { deletePicked(false); },
      // Paste text at the cursor (or over picked lines).
      pasteText(text) {
        if (!text) return;
        if (picked) { pasteText(deletePicked(true), text); return; }
        let i = lastIndex;
        if (!root.contains(document.activeElement)) { const j = textLine(blocks.length - 1, -1); focusLine(j, 'end'); i = j; }
        pasteText(i, text);
      },
      load(newBlocks) {
        blocks = newBlocks && newBlocks.length ? newBlocks.map(clean) : [clean({ t: 'p', s: '' })];
        lastIndex = 0;
        if (picked) { picked = null; onPick && onPick(0); }
        lastSel = null;
        render();
        hist = [{ ...snapshot(), kind: 'load' }];
        hpos = 0;
      },
      undo, redo,
      canUndo() { return hpos > 0; },
      canRedo() { return hpos < hist.length - 1; },
      blocks() { readAll(); return blocks.map((b) => ({ ...b, r: b.r ? b.r.map((r) => ({ ...r })) : null })); },
      imageCount() { return blocks.filter((b) => b.t === 'img').length; },
      focused() { return root.contains(document.activeElement); },
      focusEnd() { const j = textLine(blocks.length - 1, -1); if (j >= 0) focusLine(j, 'end'); },
      // Screen position of the bottom of the last line that has something in it (null if the note is empty).
      contentBottom() {
        readAll();
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i];
          if (b.t === 'p' && !b.s) continue;
          return root.children[i]?.getBoundingClientRect().bottom ?? null;
        }
        return null;
      },
      // Add lines of text at the end of the note.
      appendText(text) {
        readAll();
        const add = String(text).split('\n').map((s) => clean({ t: 'p', s }));
        while (blocks.length > 1 && blocks[blocks.length - 1].t === 'p' && !blocks[blocks.length - 1].s) blocks.pop();
        if (blocks.length === 1 && blocks[0].t === 'p' && !blocks[0].s) blocks = add;
        else blocks = blocks.concat(add);
        structural(blocks.length - 1, 'end');
      },
      // Make the note end with exactly n empty lines after the last real content and put the cursor on the last one.
      blankLinesAtEnd(n) {
        readAll();
        while (blocks.length > 1 && blocks[blocks.length - 1].t === 'p' && !blocks[blocks.length - 1].s) blocks.pop();
        const onlyEmpty = blocks.length === 1 && blocks[0].t === 'p' && !blocks[0].s;
        for (let k = onlyEmpty ? 1 : 0; k < n; k++) blocks.push(clean({ t: 'p', s: '' }));
        structural(blocks.length - 1, 0);
      },
      // Insert a picture after the line being edited, with a text line after it to keep typing.
      insertImage(file) {
        readAll();
        const i = Math.min(lastIndex, blocks.length - 1);
        const at = blocks.length === 1 && blocks[0].t === 'p' && !blocks[0].s ? 0 : i + 1;
        const img = clean({ t: 'img', file, z: 'l' });
        if (at === 0) blocks.splice(0, 0, img); else blocks.splice(at, 0, img);
        const next = at + 1;
        if (!blocks[next] || blocks[next].t === 'img') blocks.splice(next, 0, clean({ t: 'p', s: '' }));
        structural(next, 0);
      },
      current() { return Math.min(lastIndex, blocks.length - 1); },
      currentType() { const i = this.current(); return blocks[i] ? blocks[i].t : 'p'; },
      setType(type) {
        const i = this.current();
        readLine(i);
        const el = textEl(i);
        const pos = (el && caretOffset(el)?.start) ?? blocks[i].s.length;
        blocks[i].t = blocks[i].t === type ? 'p' : type;
        if (blocks[i].t !== 'todo') blocks[i].d = false;
        structural(i, pos);
      },
      indent() { indent(this.current(), 1); },
      outdent() { indent(this.current(), -1); },
      format,
      currentStyle,
      clearDone() {
        readAll();
        const kept = blocks.filter((b) => !(b.t === 'todo' && b.d));
        if (kept.length === blocks.length) return false;
        blocks = kept.length ? kept : [clean({ t: 'p', s: '' })];
        render();
        changed();
        return true;
      },
    };
  }

  return { create, textFromBlocks, blocksFromText, blocksForNote, styleElement, FONTS };
})();
