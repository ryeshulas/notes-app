// Line-based note body: each line is plain text, a bullet, a numbered item or a checklist item,
// optionally indented (sub-lists).
// Stored as blocks: [{ t: 'p' | 'ul' | 'ol' | 'todo', s: 'text', d: done, i: indent 0-4 }]
'use strict';

const BodyEditor = (() => {
  const TYPES = ['p', 'ul', 'ol', 'todo'];
  const MAX_INDENT = 4;
  const BULLETS = ['•', '◦', '▪', '•', '◦'];

  // ---- numbering: 1. / a. / i. / 1. ... by indent level ----
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

  // Marker text for every block (bullets, numbers, checkboxes).
  function labels(blocks) {
    const counters = [];
    return blocks.map((b) => {
      const lv = b.i || 0;
      counters.length = Math.min(counters.length, lv + 1);   // deeper levels restart
      if (b.t === 'ol') { counters[lv] = (counters[lv] || 0) + 1; return numberLabel(counters[lv], lv); }
      counters[lv] = 0;                                       // anything else at this level restarts numbering
      if (b.t === 'ul') return BULLETS[lv] || '•';
      if (b.t === 'todo') return b.d ? '☑' : '☐';
      return '';
    });
  }

  // ---- conversions (also used for search, previews and older clients) ----
  function textFromBlocks(blocks) {
    const lab = labels(blocks);
    return blocks.map((b, k) => {
      const pad = '  '.repeat(b.i || 0);
      return b.t === 'p' ? pad + b.s : `${pad}${lab[k]} ${b.s}`;
    }).join('\n').replace(/\s+$/, '');
  }

  // Strict parse, used for pasted text and text saved by older versions.
  function parseLine(line) {
    const indent = Math.min(MAX_INDENT, Math.floor((/^ */.exec(line)[0].length) / 2));
    const rest = line.replace(/^\s+/, '');
    let m;
    if ((m = /^[•◦▪\-*]\s+(.*)$/.exec(rest))) return { t: 'ul', s: m[1], d: false, i: indent };
    if ((m = /^\d+[.)]\s+(.*)$/.exec(rest))) return { t: 'ol', s: m[1], d: false, i: indent };
    if (indent > 0 && (m = /^[a-z]{1,4}[.)]\s+(.*)$/.exec(rest))) return { t: 'ol', s: m[1], d: false, i: indent };
    if ((m = /^(☐|☑|\[ ?\]|\[[xX]\])\s*(.*)$/.exec(rest))) return { t: 'todo', s: m[2], d: m[1] === '☑' || /x/i.test(m[1]), i: indent };
    return { t: 'p', s: line, d: false, i: 0 };
  }

  // Loose "looks like a list item" check for the two-lines-in-a-row shortcut:
  // "1." / "2)" followed by text, or "*" / "-" / "•" followed by text.
  function listLike(s) {
    let m;
    if ((m = /^\s*\d+[.)]\s*(?!\d)(\S.*)$/.exec(s))) return { t: 'ol', s: m[1] };
    if ((m = /^\s*\*\s*(\S.*)$/.exec(s))) return { t: 'ul', s: m[1] };
    if ((m = /^\s*[-•]\s+(\S.*)$/.exec(s))) return { t: 'ul', s: m[1] };
    return null;
  }

  function blocksFromText(text) {
    return (text || '').split('\n').map(parseLine);
  }

  function clean(b) {
    return { t: TYPES.includes(b.t) ? b.t : 'p', s: String(b.s || ''), d: !!b.d, i: Math.max(0, Math.min(MAX_INDENT, b.i | 0)) };
  }

  // Use stored blocks unless the plain text was changed elsewhere (e.g. by an older version).
  function blocksForNote(data) {
    if (Array.isArray(data.blocks) && data.blocks.length) {
      const blocks = data.blocks.map(clean);
      if (textFromBlocks(blocks) === (data.text || '').replace(/\s+$/, '')) return blocks;
    }
    return blocksFromText(data.text || '');
  }

  // ---- caret helpers ----
  function caretOffset(el) {
    const sel = getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    return { start: pre.toString().length, collapsed: r.collapsed };
  }

  function setCaret(el, offset) {
    el.focus();
    const sel = getSelection();
    const r = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, left = offset;
    while ((node = walker.nextNode())) {
      if (left <= node.length) { r.setStart(node, left); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return; }
      left -= node.length;
    }
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  const plaintextOnly = (() => {
    const d = document.createElement('div');
    try { d.contentEditable = 'plaintext-only'; } catch { return false; }
    return d.contentEditable === 'plaintext-only';
  })();

  // ---- the editor ----
  function create(root, { onChange, placeholder = 'Type here…' } = {}) {
    let blocks = [clean({ t: 'p', s: '' })];
    let lastIndex = 0;

    const lineEls = () => [...root.querySelectorAll('.line')];
    const textEl = (i) => lineEls()[i]?.querySelector('.txt');
    const indexOf = (el) => lineEls().indexOf(el.closest('.line'));
    const changed = () => onChange && onChange();

    function render() {
      root.textContent = '';
      const lab = labels(blocks);
      blocks.forEach((b, i) => {
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
          cb.addEventListener('change', () => {
            blocks[i].d = cb.checked;
            line.classList.toggle('done', cb.checked);
            changed();
          });
          marker.append(cb);
        }
        const txt = document.createElement('div');
        txt.className = 'txt';
        txt.contentEditable = plaintextOnly ? 'plaintext-only' : 'true';
        txt.spellcheck = true;
        txt.textContent = b.s;
        if (blocks.length === 1 && b.t === 'p') txt.dataset.placeholder = placeholder;
        line.append(marker, txt);
        root.append(line);
      });
    }

    function focusLine(i, offset) {
      const el = textEl(i);
      if (!el) return;
      lastIndex = i;
      setCaret(el, offset === 'end' ? el.textContent.length : offset);
    }

    function readLine(i) {
      const el = textEl(i);
      if (el) blocks[i].s = el.textContent.replace(/\n/g, ' ');
    }

    function structural(i, offset) {
      render();
      focusLine(i, offset);
      changed();
    }

    // Two list-looking lines in a row ("1. x" then "2. y", or "* x" then "* y") become a list.
    function promoteToList(i) {
      const b = blocks[i];
      const prev = blocks[i - 1];
      if (b.t !== 'p' || !prev) return null;
      const cur = listLike(b.s);
      if (!cur) return null;
      const prevLike = prev.t === 'p' ? listLike(prev.s) : null;
      if (prev.t === 'p' && !(prevLike && prevLike.t === cur.t)) return null;
      if (prev.t !== 'p' && prev.t !== cur.t) return null;
      if (prev.t === 'p') Object.assign(prev, { t: cur.t, s: prevLike.s, d: false });
      const removed = b.s.length - cur.s.length;
      Object.assign(b, { t: cur.t, s: cur.s, d: false, i: prev.i || 0 });
      return removed;
    }

    function splitAt(i) {
      readLine(i);
      const el = textEl(i);
      let pos = caretOffset(el)?.start ?? el.textContent.length;
      const b = blocks[i];
      // Enter on an empty list item: step out one level, then end the list.
      if (b.t !== 'p' && b.s === '') {
        if (b.i > 0) b.i--; else b.t = 'p';
        return structural(i, 0);
      }
      const removed = promoteToList(i);
      if (removed !== null) pos = Math.max(0, pos - removed);
      const after = b.s.slice(pos);
      b.s = b.s.slice(0, pos);
      blocks.splice(i + 1, 0, { t: b.t, s: after, d: false, i: b.i || 0 });
      structural(i + 1, 0);
    }

    function backspaceAtStart(i) {
      readLine(i);
      const b = blocks[i];
      if (b.i > 0) { b.i--; return structural(i, 0); }               // step out of the sub-list first
      if (b.t !== 'p') { b.t = 'p'; b.d = false; return structural(i, 0); }
      if (i === 0) return;
      readLine(i - 1);
      const prev = blocks[i - 1];
      const len = prev.s.length;
      prev.s += b.s;
      blocks.splice(i, 1);
      structural(i - 1, len);
    }

    function deleteAtEnd(i) {
      if (i >= blocks.length - 1) return;
      readLine(i); readLine(i + 1);
      const len = blocks[i].s.length;
      blocks[i].s += blocks[i + 1].s;
      blocks.splice(i + 1, 1);
      structural(i, len);
    }

    function indent(i, delta) {
      readLine(i);
      const el = textEl(i);
      const pos = (el && caretOffset(el)?.start) ?? blocks[i].s.length;
      const b = blocks[i];
      // A sub-item can be at most one level deeper than the line above it.
      const maxHere = i === 0 ? 0 : Math.min(MAX_INDENT, (blocks[i - 1].i || 0) + 1);
      const next = Math.max(0, Math.min(maxHere, (b.i || 0) + delta));
      if (next === b.i) return;
      b.i = next;
      structural(i, pos);
    }

    function insertLines(i, text) {
      readLine(i);
      const el = textEl(i);
      const pos = caretOffset(el)?.start ?? el.textContent.length;
      const b = blocks[i];
      const before = b.s.slice(0, pos), after = b.s.slice(pos);
      const parsed = text.replace(/\r\n?/g, '\n').split('\n').map(parseLine);
      b.s = before + parsed[0].s;
      if (before === '' && parsed[0].t !== 'p') Object.assign(b, { t: parsed[0].t, d: parsed[0].d, i: parsed[0].i });
      const rest = parsed.slice(1);
      blocks.splice(i + 1, 0, ...rest);
      const last = i + rest.length;
      const lastLen = blocks[last].s.length;
      blocks[last].s += after;
      structural(last, lastLen);
    }

    // "[] " at the start of a line makes a checklist item right away.
    function autoFormat(i) {
      const b = blocks[i];
      if (b.t !== 'p') return false;
      const m = /^(\[ ?\]|\[[xX]\])\s(.*)$/.exec(b.s);
      if (!m) return false;
      Object.assign(b, { t: 'todo', s: m[2], d: /x/i.test(m[1]) });
      structural(i, 0);
      return true;
    }

    root.addEventListener('focusin', (e) => { const i = indexOf(e.target); if (i >= 0) lastIndex = i; });

    root.addEventListener('keydown', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      const i = indexOf(el);
      const c = caretOffset(el);
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); splitAt(i); return; }
      if (e.key === 'Tab') { e.preventDefault(); indent(i, e.shiftKey ? -1 : 1); return; }
      if (e.key === 'Backspace' && c && c.collapsed && c.start === 0) { e.preventDefault(); backspaceAtStart(i); return; }
      if (e.key === 'Delete' && c && c.collapsed && c.start === el.textContent.length) { e.preventDefault(); deleteAtEnd(i); return; }
      if (e.key === 'ArrowUp' && i > 0) {
        const r = getSelection().getRangeAt(0).getBoundingClientRect();
        const top = el.getBoundingClientRect().top;
        if (!r.height || r.top - top < 6) { e.preventDefault(); focusLine(i - 1, Math.min(c?.start ?? 0, blocks[i - 1].s.length)); }
      }
      if (e.key === 'ArrowDown' && i < blocks.length - 1) {
        const r = getSelection().getRangeAt(0).getBoundingClientRect();
        const bottom = el.getBoundingClientRect().bottom;
        if (!r.height || bottom - r.bottom < 6) { e.preventDefault(); focusLine(i + 1, Math.min(c?.start ?? 0, blocks[i + 1].s.length)); }
      }
    });

    // Android keyboards often don't send proper key events; beforeinput covers them.
    root.addEventListener('beforeinput', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      const i = indexOf(el);
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); splitAt(i); return; }
      if (e.inputType === 'deleteContentBackward') {
        const c = caretOffset(el);
        if (c && c.collapsed && c.start === 0) { e.preventDefault(); backspaceAtStart(i); }
      }
    });

    root.addEventListener('paste', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      if (text.includes('\n')) insertLines(indexOf(el), text);
      else document.execCommand('insertText', false, text);
    });

    root.addEventListener('input', (e) => {
      const el = e.target.closest?.('.txt');
      if (!el) return;
      const i = indexOf(el);
      readLine(i);
      if (el.dataset.placeholder && el.textContent) delete el.dataset.placeholder;
      if (!autoFormat(i)) changed();
    });

    return {
      load(newBlocks) {
        blocks = newBlocks && newBlocks.length ? newBlocks.map(clean) : [clean({ t: 'p', s: '' })];
        lastIndex = 0;
        render();
      },
      blocks() { blocks.forEach((_, i) => readLine(i)); return blocks.map((b) => ({ ...b })); },
      focused() { return root.contains(document.activeElement); },
      focusEnd() { focusLine(blocks.length - 1, 'end'); },
      current() { return Math.min(lastIndex, blocks.length - 1); },
      // Toolbar: change the type of the line being edited. Pressing the same type again goes back to text.
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
      // Remove checked items (keeps the rest in order).
      clearDone() {
        blocks.forEach((_, i) => readLine(i));
        const kept = blocks.filter((b) => !(b.t === 'todo' && b.d));
        if (kept.length === blocks.length) return false;
        blocks = kept.length ? kept : [clean({ t: 'p', s: '' })];
        render();
        changed();
        return true;
      },
    };
  }

  return { create, textFromBlocks, blocksFromText, blocksForNote };
})();
