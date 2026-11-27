// Text labels and images placed on the drawing area.
// Items are stored with the ink in drawing units (the canvas is 1000 units wide):
//   label: { id, k: 'text', x, y, s: 'text', size, st: { b, i, u, x, c, h, f } }
//   image: { id, k: 'img', x, y, w, h, file }
//   shape: { id, k: 'shape', shape: 'rect'|'ellipse'|'triangle'|'line'|'arrow', x, y, w, h, c: line color, fill, sw: line width }
//          (x, y) is where the drag started and (x+w, y+h) where it ended; lines keep their direction.
'use strict';

const CanvasItems = (() => {
  const LABEL_SIZES = [18, 24, 32, 44, 60];
  const LINE_COLORS = ['#1f1f1f', '#d32f2f', '#1e5bd8', '#2e7d32', '#e67700', '#8e24aa', '#ffffff'];
  const FILL_COLORS = [null, '#ffffff', '#fff176', '#b9f6a8', '#a8dcff', '#ffc1d3', '#e0e0e0', '#1f1f1f', '#d32f2f', '#1e5bd8', '#2e7d32'];
  const isBoxShape = (it) => it.k === 'shape' && !['line', 'arrow'].includes(it.shape);

  // Shape geometry in drawing units, relative to an origin (ox, oy).
  function shapeParts(it, ox = 0, oy = 0) {
    const x = it.x - ox, y = it.y - oy, w = it.w, h = it.h;
    const sw = it.sw || 4;
    const parts = [];
    if (it.shape === 'rect') parts.push({ type: 'rect', x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) });
    else if (it.shape === 'ellipse') parts.push({ type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: Math.abs(w) / 2, ry: Math.abs(h) / 2 });
    else if (it.shape === 'triangle') parts.push({ type: 'poly', pts: [[x + w / 2, y], [x + w, y + h], [x, y + h]] });
    else {
      parts.push({ type: 'line', x1: x, y1: y, x2: x + w, y2: y + h });
      if (it.shape === 'arrow') {
        const len = Math.max(14, sw * 4), a = Math.atan2(h, w), spread = 0.45;
        const ex = x + w, ey = y + h;
        parts.push({ type: 'head', pts: [[ex, ey], [ex - len * Math.cos(a - spread), ey - len * Math.sin(a - spread)], [ex - len * Math.cos(a + spread), ey - len * Math.sin(a + spread)]] });
      }
    }
    return parts;
  }
  // Is point (px, py) within r of the shape's outline, or inside it when it's filled?
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function inPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function shapeHit(it, px, py, r) {
    const tol = r + (it.sw || 4) / 2;
    const filled = isBoxShape(it) && it.fill;
    return shapeParts(it).some((p) => {
      if (p.type === 'rect') {
        const pts = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
        if (filled && inPoly(px, py, pts)) return true;
        return pts.some((a, i) => { const b = pts[(i + 1) % 4]; return segDist(px, py, a[0], a[1], b[0], b[1]) <= tol; });
      }
      if (p.type === 'ellipse') {
        const rx = Math.max(p.rx, 0.5), ry = Math.max(p.ry, 0.5);
        const d = Math.hypot((px - p.cx) / rx, (py - p.cy) / ry);
        if (filled && d <= 1) return true;
        return Math.abs(d - 1) * Math.min(rx, ry) <= tol || (Math.min(rx, ry) < tol && d <= 1 + tol / Math.min(rx, ry));
      }
      if (p.type === 'line') return segDist(px, py, p.x1, p.y1, p.x2, p.y2) <= tol;
      // triangle or arrow head
      if ((filled || p.type === 'head') && inPoly(px, py, p.pts)) return true;
      return p.pts.some((a, i) => { const b = p.pts[(i + 1) % p.pts.length]; return segDist(px, py, a[0], a[1], b[0], b[1]) <= tol; });
    });
  }
  // Turn a shape into ordinary ink strokes that look the same (fill first, then outline), so the
  // eraser can remove just part of it. Strokes are {t, c, w, p: [x, y, pressure, ...]}; pressure 0.65
  // draws exactly width w.
  function shapeToStrokes(it) {
    const sw = it.sw || 4, c = it.c || '#1f1f1f', P = 0.65;
    const pts = (list) => list.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, P]);
    const fills = [], lines = [];
    // Fill: overlapping horizontal lines across the inside of a polygon or ellipse.
    const fillRows = (top, bottom, span, color) => {
      const fw = 8, step = 6;
      for (let y = top + fw / 2; y <= bottom - fw / 2 + 0.01; y += step) {
        const r = span(y);
        if (!r) continue;
        let [x1, x2] = r;
        x1 += fw / 2; x2 -= fw / 2;
        if (x2 < x1) { const m = (x1 + x2) / 2; x1 = m; x2 = m + 0.1; }
        fills.push({ t: 'pen', c: color, w: fw, p: pts([[x1, y], [x2, y]]) });
      }
    };
    const polySpan = (poly) => (y) => {
      const xs = [];
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
    };
    const filled = isBoxShape(it) && it.fill;
    for (const p of shapeParts(it)) {
      if (p.type === 'rect') {
        const poly = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
        if (filled) fillRows(p.y, p.y + p.h, polySpan(poly), it.fill);
        lines.push({ t: 'pen', c, w: sw, p: pts([...poly, poly[0]]) });
      } else if (p.type === 'ellipse') {
        const n = 72, poly = [];
        for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; poly.push([p.cx + p.rx * Math.cos(a), p.cy + p.ry * Math.sin(a)]); }
        if (filled && p.ry > 0) fillRows(p.cy - p.ry, p.cy + p.ry, (y) => { const t = 1 - ((y - p.cy) / p.ry) ** 2; if (t < 0) return null; const dx = p.rx * Math.sqrt(t); return [p.cx - dx, p.cx + dx]; }, it.fill);
        lines.push({ t: 'pen', c, w: sw, p: pts(poly) });
      } else if (p.type === 'line') {
        lines.push({ t: 'pen', c, w: sw, p: pts([[p.x1, p.y1], [p.x2, p.y2]]) });
      } else {
        const ys = p.pts.map((q) => q[1]);
        if (filled || p.type === 'head') fillRows(Math.min(...ys), Math.max(...ys), polySpan(p.pts), p.type === 'head' ? c : it.fill);
        lines.push({ t: 'pen', c, w: sw, p: pts([...p.pts, p.pts[0]]) });
      }
    }
    return [...fills, ...lines];
  }
  function shapeSVG(it, ox, oy) {
    const sw = it.sw || 4, c = (window.inkColor || ((x) => x))(it.c || '#1f1f1f');
    const fill = isBoxShape(it) && it.fill ? it.fill : 'none';
    const common = `stroke="${c}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`;
    return shapeParts(it, ox, oy).map((p) => {
      if (p.type === 'rect') return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="2" fill="${fill}" ${common}/>`;
      if (p.type === 'ellipse') return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="${fill}" ${common}/>`;
      if (p.type === 'poly') return `<polygon points="${p.pts.map((q) => q.join(',')).join(' ')}" fill="${fill}" ${common}/>`;
      if (p.type === 'line') return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" ${common}/>`;
      return `<polygon points="${p.pts.map((q) => q.join(',')).join(' ')}" fill="${c}" ${common}/>`;
    }).join('');
  }
  // Draw a shape onto a 2D canvas (note-card previews).
  function drawShape(ctx, it) {
    const sw = it.sw || 4, c = (window.inkColor || ((x) => x))(it.c || '#1f1f1f');
    ctx.save();
    ctx.lineWidth = sw; ctx.strokeStyle = c; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const p of shapeParts(it)) {
      ctx.beginPath();
      if (p.type === 'rect') ctx.rect(p.x, p.y, p.w, p.h);
      else if (p.type === 'ellipse') ctx.ellipse(p.cx, p.cy, Math.max(p.rx, 0.1), Math.max(p.ry, 0.1), 0, 0, Math.PI * 2);
      else if (p.type === 'line') { ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); }
      else { p.pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); }
      if (p.type === 'head') { ctx.fillStyle = c; ctx.fill(); }
      else if (isBoxShape(it) && it.fill) { ctx.fillStyle = it.fill; ctx.fill(); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function create(layer, { scale, onChange, fileURL, onEditStart, barHost, barExtras }) {
    let items = [];
    let mode = 'pen';          // 'pen' (items ignore input) | 'select' | 'text'
    let selected = null;       // item id
    let editing = null;        // label id being typed into
    const els = new Map();     // id -> element
    // Toolbar for the selected item, shown in a fixed spot just under the drawing toolbar.
    const bar = barHost;
    let sizeInput = null;

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
      } else if (it.k === 'shape') {
        const pad = (it.sw || 4) + (it.shape === 'arrow' ? Math.max(14, (it.sw || 4) * 4) : 0) + 4;
        const l = Math.min(it.x, it.x + it.w) - pad, t = Math.min(it.y, it.y + it.h) - pad;
        const bw = Math.abs(it.w) + pad * 2, bh = Math.abs(it.h) + pad * 2;
        el.style.left = `${l * s}px`;
        el.style.top = `${t * s}px`;
        el.style.width = `${bw * s}px`;
        el.style.height = `${bh * s}px`;
        const svg = el.querySelector('svg');
        svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
        svg.innerHTML = shapeSVG(it, l, t);
        // resize handle sits where the drag ended (bottom-right for boxes, the end point for lines)
        const hd = el.querySelector('.resize-handle');
        hd.style.left = `${(it.x + it.w - l) * s - 14}px`;
        hd.style.top = `${(it.y + it.h - t) * s - 14}px`;
      } else {
        el.style.fontSize = `${(it.size || 24) * s}px`;
        el.style.maxWidth = `${1000 * s}px`;
      }
    }

    function renderItem(it) {
      let el = els.get(it.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `item item-${it.k}`;
        el.dataset.id = it.id;
        if (it.k === 'shape') {
          el.innerHTML = '<svg width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true"></svg><div class="resize-handle"></div>';
        } else if (it.k === 'img') {
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
          t.addEventListener('input', () => { it.s = t.innerText.replace(/\n$/, ''); keepInside(it); changed(); });
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

    // Boxes keep a positive size after dragging past their corner; nothing goes off the page.
    function normalise(it) {
      if (isBoxShape(it)) {
        if (it.w < 0) { it.x += it.w; it.w = -it.w; }
        if (it.h < 0) { it.y += it.h; it.h = -it.h; }
        it.w = Math.max(8, it.w); it.h = Math.max(8, it.h);
      }
      const minX = Math.min(it.x, it.x + it.w), maxX = Math.max(it.x, it.x + it.w);
      if (minX < 0) it.x -= minX;
      if (maxX > 1000) it.x -= maxX - 1000;
      const minY = Math.min(it.y, it.y + it.h);
      if (minY < 0) it.y -= minY;
    }

    // Labels near the right edge slide left as they grow, instead of wrapping.
    function keepInside(it) {
      const el = els.get(it.id);
      if (!el) return;
      const s = scale();
      const w = el.offsetWidth / s;
      if (it.x + w > 1000) { it.x = Math.max(0, 1000 - w); place(el, it); }
    }

    function render() {
      for (const [id, el] of els) if (!byId(id)) { el.remove(); els.delete(id); }
      items.forEach(renderItem);
      layer.classList.toggle('interactive', mode !== 'pen');
      layer.classList.toggle('mode-text', mode === 'text');
      layer.parentElement.classList.toggle('select-mode', mode === 'select');
      renderBar();
    }

    // ---- toolbar for the selected item ----
    const imagePct = (it) => Math.round(it.w / 10);
    function setImageWidth(it, pct) {
      const ratio = it.h / it.w;
      it.w = Math.max(50, Math.min(1000, pct * 10));
      it.h = it.w * ratio;
      it.x = Math.max(0, Math.min(it.x, 1000 - it.w));
      const el = els.get(it.id);
      if (el) place(el, it);
      if (sizeInput) { sizeInput.value = imagePct(it); sizeInput.nextSibling.textContent = `${imagePct(it)}%`; }
      changed();
    }
    function renderBar() {
      const it = byId(selected);
      sizeInput = null;
      if (!it || mode === 'pen') { bar.classList.add('hidden'); bar.textContent = ''; return; }
      bar.textContent = '';
      const title = document.createElement('span');
      title.className = 'bar-title';
      title.textContent = it.k === 'img' ? 'Image' : it.k === 'shape' ? 'Shape' : 'Label';
      bar.append(title);
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
        for (const c of LINE_COLORS) {
          const b = btn('', 'Color', () => { st.c = c; renderItem(it); renderBar(); changed(); }, `dot${(st.c || '#1f1f1f') === c ? ' on' : ''}${c === '#ffffff' ? ' white' : ''}`);
          b.style.background = c;
        }
        btn('✎', 'Edit text', () => startEditing(it.id));
      }
      if (it.k === 'shape') {
        const lab = (t) => { const x = document.createElement('span'); x.className = 'bar-sub'; x.textContent = t; bar.append(x); };
        lab('Line');
        for (const c of LINE_COLORS) {
          const b = btn('', 'Line color', () => { it.c = c; renderItem(it); renderBar(); changed(); }, `dot${(it.c || '#1f1f1f') === c ? ' on' : ''}${c === '#ffffff' ? ' white' : ''}`);
          b.style.background = c;
        }
        btn('−', 'Thinner line', () => { it.sw = Math.max(1, (it.sw || 4) - 1); renderItem(it); changed(); });
        btn('+', 'Thicker line', () => { it.sw = Math.min(24, (it.sw || 4) + 1); renderItem(it); changed(); });
        if (isBoxShape(it)) {
          lab('Fill');
          for (const c of FILL_COLORS) {
            const b = btn('', c ? 'Fill color' : 'No fill', () => { it.fill = c; renderItem(it); renderBar(); changed(); }, `dot${(it.fill || null) === c ? ' on' : ''}${c ? '' : ' none'}${c === '#ffffff' ? ' white' : ''}`);
            if (c) b.style.background = c;
          }
        }
      }
      if (it.k === 'img') {
        btn('−', 'Smaller', () => setImageWidth(it, imagePct(it) - 10));
        const range = document.createElement('input');
        range.type = 'range';
        range.min = '5';
        range.max = '100';
        range.value = imagePct(it);
        range.title = 'Image size';
        range.className = 'size-slider';
        range.addEventListener('pointerdown', (e) => e.stopPropagation());
        range.addEventListener('input', () => setImageWidth(it, Number(range.value)));
        const pct = document.createElement('span');
        pct.className = 'size-pct';
        pct.textContent = `${imagePct(it)}%`;
        bar.append(range, pct);
        sizeInput = range;
        btn('+', 'Bigger', () => setImageWidth(it, imagePct(it) + 10));
        btn('Full width', 'Fit the width of the page', () => { it.x = 0; setImageWidth(it, 100); });
      }
      for (const [label, title, fn] of (barExtras ? barExtras(it) : [])) btn(label, title, fn);
      btn('🗑 Delete', 'Delete', () => remove(it.id), 'danger');
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
          if (resizing && it.k === 'shape') {
            it.w = start.iw + dx;
            it.h = start.ih + dy;
          } else if (resizing) {
            const ratio = start.ih / start.iw;
            it.w = Math.max(40, Math.min(1000 - it.x, start.iw + dx));
            it.h = it.w * ratio;
          } else if (it.k === 'shape') {
            it.x = start.ix + dx;
            it.y = start.iy + dy;
          } else {
            it.x = Math.max(0, Math.min(1000 - (it.w || 40), start.ix + dx));
            it.y = Math.max(0, start.iy + dy);
          }
          place(el, it);
          if (sizeInput && resizing) { sizeInput.value = imagePct(it); sizeInput.nextSibling.textContent = `${imagePct(it)}%`; }
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          if (it.k === 'shape') { normalise(it); place(el, it); }
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
      relayout() { items.forEach((it) => { const el = els.get(it.id); if (el) place(el, it); }); },
      addLabel(x, y) {
        const it = { id: uid(), k: 'text', x, y: Math.max(0, y - 16), s: '', size: 28, st: {} };
        items.push(it);
        render();
        startEditing(it.id);
        return it;
      },
      addText(x, y, s, size) {
        const it = { id: uid(), k: 'text', x, y, s, size: Math.round(size || 28), st: {} };
        items.push(it);
        keepInside(it);
        render();
        changed();
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
      restore(list) {
        for (const el of els.values()) el.remove();
        els.clear();
        items = list.map((it) => JSON.parse(JSON.stringify(it)));
        selected = null; editing = null;
        render();
        changed();
      },
      selectedItem() { const it = byId(selected); return it ? JSON.parse(JSON.stringify(it)) : null; },
      remove(id) { remove(id); },
      select(id) { selected = id; render(); },
      // Add copies of items (from the clipboard), moved by dx, dy. Returns the new items.
      addCopies(list, dx, dy) {
        const out = list.map((src) => ({ ...JSON.parse(JSON.stringify(src)), id: uid(), x: src.x + dx, y: src.y + dy }));
        items.push(...out);
        selected = out.length === 1 ? out[0].id : null;
        render();
        changed();
        return out;
      },
      // Eraser: shapes under the eraser circle are taken off the item layer and returned as ink strokes
      // (which the eraser then trims like handwriting).
      takeShapesAsInk(x, y, r) {
        const hit = items.filter((it) => it.k === 'shape' && shapeHit(it, x, y, r));
        if (!hit.length) return [];
        const gone = new Set(hit.map((it) => it.id));
        items = items.filter((it) => !gone.has(it.id));
        if (gone.has(selected)) selected = null;
        render();
        changed();
        return hit.flatMap(shapeToStrokes);
      },
      // move everything down (used when an older note is converted to the combined page)
      shiftAll(dy) { items.forEach((it) => { it.y += dy; }); render(); },
      // [top, bottom] of every item, in page units
      spans() {
        return items.map((it) => it.k === 'shape'
          ? [Math.min(it.y, it.y + it.h), Math.max(it.y, it.y + it.h)]
          : [it.y, it.y + (it.h || (it.size || 28) * 1.5)]);
      },
      lowestPoint() {
        return items.reduce((m, it) => Math.max(m, it.k === 'shape' ? Math.max(it.y, it.y + it.h) : it.y + (it.h || (it.size || 28) * 1.5)), 0);
      },
      // Shape tool: drag out a new shape (a simple tap makes a default-size one).
      beginShape(x, y, opts) {
        const it = { id: uid(), k: 'shape', shape: opts.shape || 'rect', x, y, w: 0, h: 0, c: opts.c || '#1f1f1f', fill: opts.fill || null, sw: opts.sw || 4 };
        items.push(it);
        renderItem(it);
        this._drawing = it;
        return it;
      },
      updateShape(x, y) {
        const it = this._drawing;
        if (!it) return;
        it.w = x - it.x;
        it.h = y - it.y;
        place(els.get(it.id), it);
      },
      endShape() {
        const it = this._drawing;
        this._drawing = null;
        if (!it) return;
        if (Math.abs(it.w) < 6 && Math.abs(it.h) < 6) {
          if (['line', 'arrow'].includes(it.shape)) { it.w = 160; it.h = 0; }
          else { it.x -= 80; it.y -= 55; it.w = 160; it.h = 110; }
        }
        normalise(it);
        renderItem(it);
        changed();
      },
      busy() { return !!editing; },
    };
  }

  return { create, drawShape, LINE_COLORS, FILL_COLORS };
})();
