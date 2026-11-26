// Text labels and images placed on the drawing area.
// Items are stored with the ink in drawing units (the canvas is 1000 units wide):
//   label: { id, k: 'text', x, y, s: 'text', size, st: { b, i, u, x, c, h, f } }
//   image: { id, k: 'img', x, y, w, h, file }
'use strict';

const CanvasItems = (() => {
  const LABEL_SIZES = [18, 24, 32, 44, 60];

  function create(layer, { scale, onChange, fileURL, onEditStart }) {
    let items = [];
    let mode = 'pen';          // 'pen' (items ignore input) | 'select' | 'text'
    let selected = null;       // item id
    let editing = null;        // label id being typed into
    const els = new Map();     // id -> element
    const bar = document.createElement('div');
    bar.className = 'item-bar hidden';

    const byId = (id) => items.find((it) => it.id === id);
    const changed = () => onChange && onChange();
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

    function place(el, it) {
      const s = scale();
      el.style.left = `${it.x * s}px`;
      el.style.top = `${it.y * s}px`;
      if (it.k === 'img') {
        el.style.width = `${it.w * s}px`;
        el.style.height = `${it.h * s}px`;
      } else {
        el.style.fontSize = `${(it.size || 24) * s}px`;
        el.style.maxWidth = `${Math.max(60, (1000 - it.x) * s)}px`;
      }
    }

    function renderItem(it) {
      let el = els.get(it.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `item item-${it.k}`;
        el.dataset.id = it.id;
        if (it.k === 'img') {
          const img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          el.append(img);
          const handle = document.createElement('div');
          handle.className = 'resize-handle';
          el.append(handle);
          fileURL(it.file).then((url) => { if (url) img.src = url; else el.classList.add('missing'); });
        } else {
          const t = document.createElement('div');
          t.className = 'label-text';
          t.spellcheck = true;
          el.append(t);
          t.addEventListener('input', () => { it.s = t.innerText.replace(/\n$/, ''); changed(); });
          t.addEventListener('blur', () => finishEditing(it.id));
          t.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); t.blur(); } });
          t.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
        }
        attachPointer(el, it);
        layer.append(el);
        els.set(it.id, el);
      }
      if (it.k === 'text') {
        const t = el.firstChild;
        if (editing !== it.id && t.innerText !== it.s) t.innerText = it.s;
        BodyEditor.styleElement(t, it.st || {});
        t.classList.add('label-text');
      }
      el.classList.toggle('selected', selected === it.id);
      place(el, it);
    }

    function render() {
      for (const [id, el] of els) if (!byId(id)) { el.remove(); els.delete(id); }
      items.forEach(renderItem);
      layer.classList.toggle('interactive', mode !== 'pen');
      layer.classList.toggle('mode-text', mode === 'text');
      layer.parentElement.classList.toggle('select-mode', mode === 'select');
      renderBar();
    }

    // ---- floating toolbar for the selected item ----
    function renderBar() {
      const it = byId(selected);
      if (!it || mode === 'pen') { bar.classList.add('hidden'); return; }
      bar.textContent = '';
      const btn = (label, title, fn, cls = '') => {
        const b = document.createElement('button');
        b.innerHTML = label;
        b.title = title;
        b.className = cls;
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        bar.append(b);
        return b;
      };
      if (it.k === 'text') {
        const st = it.st || (it.st = {});
        const font = document.createElement('select');
        [['', 'Default'], ['serif', 'Serif'], ['mono', 'Mono'], ['hand', 'Handwriting'], ['round', 'Rounded']]
          .forEach(([v, n]) => font.append(new Option(n, v)));
        font.value = st.f || '';
        font.addEventListener('pointerdown', (e) => e.stopPropagation());
        font.addEventListener('change', () => { if (font.value) st.f = font.value; else delete st.f; renderItem(it); changed(); });
        bar.append(font);
        btn('A−', 'Smaller', () => { const i = Math.max(0, LABEL_SIZES.indexOf(nearestSize(it.size)) - 1); it.size = LABEL_SIZES[i]; renderItem(it); renderBar(); changed(); });
        btn('A+', 'Bigger', () => { const i = Math.min(LABEL_SIZES.length - 1, LABEL_SIZES.indexOf(nearestSize(it.size)) + 1); it.size = LABEL_SIZES[i]; renderItem(it); renderBar(); changed(); });
        for (const [k, html, title] of [['b', '<b>B</b>', 'Bold'], ['i', '<i>I</i>', 'Italic'], ['u', '<u>U</u>', 'Underline']]) {
          btn(html, title, () => { if (st[k]) delete st[k]; else st[k] = 1; renderItem(it); renderBar(); changed(); }, st[k] ? 'on' : '');
        }
        for (const c of ['#1f1f1f', '#d32f2f', '#1e5bd8', '#2e7d32', '#e67700', '#8e24aa']) {
          const b = btn('', 'Color', () => { st.c = c; renderItem(it); renderBar(); changed(); }, `dot${(st.c || '#1f1f1f') === c ? ' on' : ''}`);
          b.style.background = c;
        }
        btn('✎', 'Edit text', () => startEditing(it.id));
      }
      btn('🗑', 'Delete', () => remove(it.id), 'danger');
      const s = scale();
      const el = els.get(it.id);
      const h = el ? el.offsetHeight : 0;
      const top = it.y * s - 44;
      bar.style.left = `${Math.max(0, it.x * s)}px`;
      bar.style.top = `${top < 0 ? it.y * s + h + 6 : top}px`;
      bar.classList.remove('hidden');
    }
    const nearestSize = (v) => LABEL_SIZES.reduce((a, b) => (Math.abs(b - (v || 24)) < Math.abs(a - (v || 24)) ? b : a));

    // ---- editing labels ----
    function startEditing(id) {
      const it = byId(id);
      if (!it || it.k !== 'text') return;
      editing = id;
      selected = id;
      const t = els.get(id).firstChild;
      try { t.contentEditable = 'plaintext-only'; } catch { /* older browsers */ }
      if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
      t.focus();
      const r = document.createRange();
      r.selectNodeContents(t);
      r.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      onEditStart && onEditStart();
      render();
    }
    function finishEditing(id) {
      if (editing !== id) return;
      editing = null;
      const it = byId(id);
      const el = els.get(id);
      if (el) el.firstChild.contentEditable = 'false';
      if (it && !it.s.trim()) { remove(id); return; }
      render();
    }

    function remove(id) {
      items = items.filter((it) => it.id !== id);
      if (selected === id) selected = null;
      if (editing === id) editing = null;
      render();
      changed();
    }

    // ---- moving & resizing ----
    function attachPointer(el, it) {
      el.addEventListener('pointerdown', (e) => {
        if (mode === 'pen') return;
        if (editing === it.id) return;           // let the caret move inside the label
        e.preventDefault();
        e.stopPropagation();
        const wasSelected = selected === it.id;
        selected = it.id;
        render();
        const s = scale();
        const resizing = e.target.classList.contains('resize-handle');
        const start = { x: e.clientX, y: e.clientY, ix: it.x, iy: it.y, iw: it.w, ih: it.h };
        let moved = false;
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        const move = (ev) => {
          const dx = (ev.clientX - start.x) / s, dy = (ev.clientY - start.y) / s;
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          if (resizing) {
            const ratio = start.ih / start.iw;
            it.w = Math.max(40, Math.min(1000 - it.x, start.iw + dx));
            it.h = it.w * ratio;
          } else {
            it.x = Math.max(0, Math.min(1000 - (it.w || 40), start.ix + dx));
            it.y = Math.max(0, start.iy + dy);
          }
          place(el, it);
          renderBar();
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          if (moved) changed();
          else if (it.k === 'text' && (wasSelected || mode === 'text')) startEditing(it.id);
          renderBar();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (!selected || editing || mode === 'pen') return;
      if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (document.activeElement?.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(selected); }
    });

    // In select mode the ink layer lets taps through; tapping empty space clears the selection.
    layer.parentElement.addEventListener('pointerdown', (e) => {
      if (mode === 'select' && !e.target.closest('.item, .item-bar')) { selected = null; render(); }
    });

    layer.append(bar);

    return {
      load(list) {
        for (const el of els.values()) el.remove();
        els.clear();
        items = Array.isArray(list) ? list.map((it) => ({ ...it, st: it.st ? { ...it.st } : undefined })) : [];
        selected = null;
        editing = null;
        render();
      },
      items() { return items.map((it) => ({ ...it })); },
      setMode(m) { mode = m; if (m === 'pen') { selected = null; if (editing) document.activeElement?.blur?.(); } render(); },
      deselect() { if (selected || editing) { if (editing) document.activeElement?.blur?.(); selected = null; render(); } },
      relayout() { items.forEach((it) => { const el = els.get(it.id); if (el) place(el, it); }); renderBar(); },
      addLabel(x, y) {
        const it = { id: uid(), k: 'text', x, y: Math.max(0, y - 16), s: '', size: 28, st: {} };
        items.push(it);
        render();
        startEditing(it.id);
        return it;
      },
      addImage(file, w, h, x, y) {
        const it = { id: uid(), k: 'img', file, x, y, w, h };
        items.push(it);
        selected = it.id;
        render();
        changed();
        return it;
      },
      lowestPoint() { return items.reduce((m, it) => Math.max(m, it.y + (it.h || (it.size || 28) * 1.5)), 0); },
      busy() { return !!editing; },
    };
  }

  return { create };
})();
