// Line-based note body: each line is plain text, a bullet, a numbered item or a checklist item.
// Stored as blocks: [{ t: 'p' | 'ul' | 'ol' | 'todo', s: 'text', d: done }]
'use strict';

const BodyEditor = (() => {
  const TYPES = ['p', 'ul', 'ol', 'todo'];

  // ---- conversions (also used for search, previews and older clients) ----
  function textFromBlocks(blocks) {
    let n = 0;
    return blocks.map((b) => {
      n = b.t === 'ol' ? n + 1 : 0;
      if (b.t === 'ul') return `• ${b.s}`;
      if (b.t === 'ol') return `${n}. ${b.s}`;
      if (b.t === 'todo') return `${b.d ? '☑' : '☐'} ${b.s}`;
      return b.s;
    }).join('\n').replace(/\s+$/, '');
  }

  function parseLine(line) {
    let m;
    if ((m = /^\s*[•\-*]\s+(.*)$/.exec(line))) return { t: 'ul', s: m[1], d: false };
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) return { t: 'ol', s: m[1], d: false };
    if ((m = /^\s*(☐|☑|\[ ?\]|\[[xX]\])\s*(.*)$/.exec(line))) return { t: 'todo', s: m[2], d: m[1] === '☑' || /x/i.test(m[1]) };
    return { t: 'p', s: line, d: false };
  }

  function blocksFromText(text) {
    const lines = (text || '').split('\n');
    return lines.map(parseLine);
  }

  // Use stored blocks unless the plain text was changed elsewhere (e.g. by an older version).
  function blocksForNote(data) {
    if (Array.isArray(data.blocks) && data.blocks.length && textFromBlocks(data.blocks) === (data.text || '').replace(/\s+$/, '')) {
      return data.blocks.map((b) => ({ t: TYPES.includes(b.t) ? b.t : 'p', s: String(b.s || ''), d: !!b.d }));
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
    let blocks = [{ t: 'p', s: '', d: false }];
    let lastIndex = 0;

    const lineEls = () => [...root.querySelectorAll('.line')];
    const textEl = (i) => lineEls()[i]?.querySelector('.txt');
    const indexOf = (el) => lineEls().indexOf(el.closest('.line'));
    const changed = () => onChange && onChange();

    function render() {
      root.textContent = '';
      let n = 0;
      blocks.forEach((b, i) => {
        n = b.t === 'ol' ? n + 1 : 0;
        const line = document.createElement('div');
        line.className = `line t-${b.t}${b.t === 'todo' && b.d ? ' done' : ''}`;
        const marker = document.createElement('span');
        marker.className = 'marker';
        marker.contentEditable = 'false';
        if (b.t === 'ul') marker.textContent = '•';
        else if (b.t === 'ol') marker.textContent = `${n}.`;
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

    function splitAt(i) {
      readLine(i);
      const el = textEl(i);
      const pos = caretOffset(el)?.start ?? el.textContent.length;
      const b = blocks[i];
      // Enter on an empty list item ends the list.
      if (b.t !== 'p' && b.s === '') { b.t = 'p'; return structural(i, 0); }
      const after = b.s.slice(pos);
      b.s = b.s.slice(0, pos);
      blocks.splice(i + 1, 0, { t: b.t, s: after, d: false });
      structural(i + 1, 0);
    }

    function backspaceAtStart(i) {
      readLine(i);
      const b = blocks[i];
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

    function insertLines(i, text) {
      readLine(i);
      const el = textEl(i);
      const pos = caretOffset(el)?.start ?? el.textContent.length;
      const b = blocks[i];
      const before = b.s.slice(0, pos), after = b.s.slice(pos);
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      const parsed = lines.map(parseLine);
      b.s = before + parsed[0].s;
      if (before === '' && parsed[0].t !== 'p') { b.t = parsed[0].t; b.d = parsed[0].d; }
      const rest = parsed.slice(1);
      blocks.splice(i + 1, 0, ...rest);
      const last = i + rest.length;
      const lastLen = blocks[last].s.length;
      blocks[last].s += after;
      structural(last, lastLen);
    }

    // Typing "- ", "1. " or "[] " at the start of a line turns it into a list item.
    function autoFormat(i) {
      const b = blocks[i];
      if (b.t !== 'p') return false;
      const p = parseLine(b.s);
      if (p.t === 'p' || !/\s$/.test(b.s.slice(0, b.s.length - p.s.length))) return false;
      Object.assign(b, p);
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
        blocks = newBlocks && newBlocks.length ? newBlocks.map((b) => ({ ...b })) : [{ t: 'p', s: '', d: false }];
        lastIndex = 0;
        render();
      },
      blocks() { blocks.forEach((_, i) => readLine(i)); return blocks.map((b) => ({ ...b })); },
      focused() { return root.contains(document.activeElement); },
      focusEnd() { focusLine(blocks.length - 1, 'end'); },
      // Change the type of the line being edited (toolbar buttons). Pressing the same type again goes back to text.
      setType(type) {
        const i = Math.min(lastIndex, blocks.length - 1);
        readLine(i);
        const el = textEl(i);
        const pos = (el && caretOffset(el)?.start) ?? blocks[i].s.length;
        blocks[i].t = blocks[i].t === type ? 'p' : type;
        if (blocks[i].t !== 'todo') blocks[i].d = false;
        structural(i, pos);
      },
      // Remove checked items (keeps the rest in order).
      clearDone() {
        blocks.forEach((_, i) => readLine(i));
        const kept = blocks.filter((b) => !(b.t === 'todo' && b.d));
        if (kept.length === blocks.length) return false;
        blocks = kept.length ? kept : [{ t: 'p', s: '', d: false }];
        render();
        changed();
        return true;
      },
    };
  }

  return { create, textFromBlocks, blocksFromText, blocksForNote };
})();
