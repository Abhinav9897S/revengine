// All HUD / overlay DOM logic.
import { listCars, distinct, compareCars, maxStats, runConsole, resetDatabase, credits } from '../db/db.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');

const PART_ORDER = [
  ['engine', 'Engine', 'X-RAY'],
  ['wheel-fr', 'Wheels & brakes'],
  ['door-r', 'Doors'],
  ['lights-front', 'Headlights'],
  ['lights-rear', 'Tail lights'],
  ['exhaust', 'Exhaust', 'X-RAY'],
  ['wing', 'Rear wing'],
  ['interior', 'Cabin', 'X-RAY'],
  ['chassis', 'Chassis', 'X-RAY'],
];

export function createUI({ rows, thumbs, registry, showroom, audio, cinema, scenes, switchScene }) {
  const order = rows.map((r) => r.slug);
  const max = maxStats();
  let view = 'showroom';
  let current = null;

  // ---------------- carousel ----------------
  const cardsEl = $('#cards');
  cardsEl.innerHTML = rows.map((r) => `
    <button class="card" data-slug="${r.slug}" title="${esc(r.manufacturer)} ${esc(r.model)}">
      <img src="${thumbs.get(r.slug)}" alt="" /><span>${esc(r.model)}</span>${registry.isReal(r.slug) ? '<em class="real">3D</em>' : '<em class="draft">DRAFT</em>'}
    </button>`).join('');
  cardsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.card');
    if (b) go(b.dataset.slug);
  });
  $('#carousel .prev').onclick = () => step(-1);
  $('#carousel .next').onclick = () => step(1);

  function step(d) {
    const i = order.indexOf(current?.slug);
    go(order[(i + d + order.length) % order.length]);
  }
  function go(slug) {
    if (showroom.busy) return;
    audio.blip(660);
    showroom.showCar(slug);
  }

  // ---------------- car info ----------------
  function stat(label, value, unit, frac, peak) {
    const on = Math.max(1, Math.min(20, Math.round(frac * 20)));
    const segs = Array.from({ length: 20 }, (_, i) => `<i data-c="${i < on ? (peak && i === on - 1 ? 'on peak' : 'on') : ''}" style="transition-delay:${i * 22}ms"></i>`).join('');
    return `<div class="stat"><label>${label}</label><div class="meter">${segs}</div><b>${value}<small>${unit}</small></b></div>`;
  }

  function onCar(car) {
    current = car;
    const r = car.info;
    $('#ci-maker').textContent = `${r.manufacturer} · ${r.country}`;
    const model = $('#ci-model');
    model.textContent = r.model;
    model.classList.remove('swap'); void model.offsetWidth; model.classList.add('swap');
    $('#ci-tagline').textContent = r.tagline;
    const disp = r.displacement_l ? `${r.displacement_l} L ` : '';
    $('#ci-chips').innerHTML = [r.year, `${disp}${r.engine_layout}`, r.aspiration, r.drivetrain, `${r.engine_position === 'floor' ? 'Floor battery' : `${r.engine_position}-engine`}`, r.color_name]
      .map((c) => `<span>${esc(c)}</span>`).join('')
      + (car.real ? '' : '<span class="draft-chip">Draft model · real 3D model not downloaded yet</span>');
    const statsEl = $('#ci-stats');
    statsEl.innerHTML = [
      stat('Power', fmt(r.power_hp), 'hp', r.power_hp / max.power, r.power_hp === max.power),
      stat('Torque', fmt(r.torque_nm), 'Nm', r.torque_nm / max.torque, r.torque_nm === max.torque),
      stat('Top speed', r.top_speed_kmh, 'km/h', r.top_speed_kmh / max.speed, r.top_speed_kmh === max.speed),
      stat('0-100', r.zero_100_s.toFixed(1), 's', 1 - (r.zero_100_s - 1.6) / (max.accel_worst - 1.2), r.zero_100_s === max.accel_best),
      stat('hp / tonne', r.hp_per_tonne, '', r.hp_per_tonne / max.ratio, r.hp_per_tonne === max.ratio),
    ].join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      statsEl.querySelectorAll('.meter i').forEach((i) => { i.className = i.dataset.c; });
    }));
    $('#ci-price').textContent = `$${fmt(r.price_usd)}`;
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c.dataset.slug === car.slug));
    document.querySelector('.card.on')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

    $('#partlist').innerHTML = PART_ORDER.filter(([id]) => car.parts.has(id)).map(([id, name, tag], i) => `
      <button data-part="${id}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${name}</span>${tag ? `<span class="tag">${tag}</span>` : '<span></span>'}</button>`).join('');
    showPartInfo(null);
  }

  $('#partlist').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-part]');
    if (b) { audio.blip(520); showroom.activate(b.dataset.part); }
  });
  $('#partlist').addEventListener('mouseover', (e) => {
    const b = e.target.closest('button[data-part]');
    if (b && !showroom.busy) showroom.setHover({ partId: b.dataset.part, label: b.textContent.trim() });
  });
  $('#partlist').addEventListener('mouseleave', () => showroom.setHover(null));

  // ---------------- part info ----------------
  function showPartInfo(part, car = current) {
    document.querySelectorAll('#partlist button').forEach((b) => b.classList.toggle('on', !!part && (b.dataset.part === part.id || (part.id?.startsWith('wheel') && b.dataset.part.startsWith('wheel')) || (part.id?.startsWith('door') && b.dataset.part.startsWith('door')))));
    const box = $('#partinfo');
    document.body.classList.toggle('inspecting', !!part);
    if (!part) { box.hidden = true; return; }
    box.hidden = false;
    const db = part.key ? car.partsDb[part.key] : null;
    $('#pi-system').textContent = db ? `${db.system} system` : 'All systems';
    $('#pi-name').textContent = part.name;
    $('#pi-desc').textContent = db ? db.description : 'Every system on the car pulled apart at once, like a technical cutaway poster. Click any piece.';
    $('#pi-spec').textContent = db ? db.spec : `${car.info.manufacturer} ${car.info.model}`;
    $('#pi-spec').hidden = false;
    $('#pi-piece').textContent = '';
    const pieces = part.pieces ? part.pieces.filter((p) => p.label) : [];
    $('#pi-pieces').innerHTML = pieces.map((p, i) => `<li data-i="${i}">${esc(p.label)}</li>`).join('');
    $('#pi-pieces').onclick = (e) => {
      const li = e.target.closest('li');
      if (li) onPiece(pieces[+li.dataset.i], part);
    };
  }
  function onPiece(piece, part) {
    if (!piece) return;
    audio.blip(990, 0.04);
    $('#pi-piece').innerHTML = `<b>${esc(piece.label.split(' · ')[0])}</b>${piece.label.includes(' · ') ? ` · ${esc(piece.label.split(' · ').slice(1).join(' · '))}` : ''}`;
    showroom.stage.outline.selectedObjects = [piece.obj];
  }
  $('#pi-back').onclick = () => showroom.reset();

  // ---------------- tooltip ----------------
  const tip = $('#tooltip');
  window.addEventListener('pointermove', (e) => { tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`; });
  function onHover(h) {
    document.querySelectorAll('#partlist button').forEach((b) => b.classList.toggle('hover', !!h && b.dataset.part === h.partId));
    if (!h || !h.point) { tip.classList.remove('on'); return; }
    const [a, ...b] = (h.label || '').split(' · ');
    tip.innerHTML = `${esc(a)}${b.length ? ` <b>· ${esc(b.join(' · '))}</b>` : ''}`;
    tip.classList.add('on');
  }

  // ---------------- toolbar ----------------
  $('#btn-xray').onclick = () => { showroom.toggleXray(); };
  $('#btn-explode').onclick = () => { audio.whoosh(); showroom.explodeAll(); };
  $('#btn-reset').onclick = () => showroom.reset();
  const soundBtn = $('#btn-sound');
  soundBtn.onclick = () => {
    audio.unlock();
    audio.setEnabled(!audio.enabled);
    soundBtn.textContent = audio.enabled ? '🔊' : '🔇';
    toast(audio.enabled ? 'Sound on' : 'Sound off');
  };
  function onXray(on) {
    $('#btn-xray').classList.toggle('on', on);
    if (on) audio.whoosh();
  }

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 1600);
  }

  // ---------------- views ----------------
  function setView(v) {
    view = v;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    ['garage', 'compare', 'sqllab'].forEach((id) => { $(`#${id}`).hidden = id !== v; });
    document.body.classList.toggle('view-overlay', v !== 'showroom');
    showroom.stage.controls.enabled = v === 'showroom';
    if (v === 'garage') renderGarage();
    if (v === 'compare') renderCompare();
    if (v === 'sqllab' && !$('#lab-input').value) { $('#lab-input').value = PRESETS[0][1]; runLab(); }
    audio.blip(440);
  }
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => setView(b.dataset.view); });

  // ---------------- garage ----------------
  const fill = (sel, values) => { $(sel).insertAdjacentHTML('beforeend', values.map((v) => `<option>${esc(v)}</option>`).join('')); };
  fill('#f-maker', distinct('manufacturer'));
  fill('#f-layout', distinct('engine_layout'));
  fill('#f-position', distinct('engine_position'));
  fill('#f-drive', distinct('drivetrain'));
  ['#f-search', '#f-maker', '#f-layout', '#f-position', '#f-drive', '#f-power', '#f-sort'].forEach((s) => $(s).addEventListener('input', renderGarage));
  $('#f-dir').onclick = (e) => {
    const b = e.currentTarget;
    b.dataset.dir = b.dataset.dir === 'desc' ? 'asc' : 'desc';
    b.textContent = b.dataset.dir === 'desc' ? '▼ High → Low' : '▲ Low → High';
    renderGarage();
  };
  function renderGarage() {
    $('#f-power-v').textContent = `${$('#f-power').value} hp`;
    const sort = $('#f-sort').value;
    const res = listCars({
      search: $('#f-search').value.trim(), manufacturer: $('#f-maker').value, layout: $('#f-layout').value,
      position: $('#f-position').value, drivetrain: $('#f-drive').value, minPower: $('#f-power').value,
      sort, dir: $('#f-dir').dataset.dir,
    });
    $('#garage-sql').innerHTML = `${highlight(res.sql)}\n<span class="meta">-- ${res.rows.length} row${res.rows.length === 1 ? '' : 's'} in ${res.ms.toFixed(2)} ms</span>`;
    const hl = { power: 'power_hp', speed: 'top_speed_kmh', accel: 'zero_100_s' }[sort];
    $('#garage-grid').innerHTML = res.rows.length ? res.rows.map((r, i) => `
      <button class="gcard" data-slug="${r.slug}" style="animation-delay:${i * 40}ms">
        <img src="${thumbs.get(r.slug)}" alt="" />
        <span class="rank">#${i + 1}</span>
        <div class="body">
          <div class="mk">${esc(r.manufacturer)} · ${r.year}</div>
          <h3>${esc(r.model)}</h3>
          <dl>
            <div><dt>Power</dt><dd class="${hl === 'power_hp' ? 'hl' : ''}">${fmt(r.power_hp)} hp</dd></div>
            <div><dt>0-100</dt><dd class="${hl === 'zero_100_s' ? 'hl' : ''}">${r.zero_100_s} s</dd></div>
            <div><dt>Top</dt><dd class="${hl === 'top_speed_kmh' ? 'hl' : ''}">${r.top_speed_kmh} km/h</dd></div>
          </dl>
        </div>
      </button>`).join('') : '<p class="empty">No cars match. Loosen a filter.</p>';
  }
  $('#garage-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.gcard');
    if (!b) return;
    setView('showroom');
    go(b.dataset.slug);
  });

  // ---------------- compare ----------------
  const opts = rows.map((r) => `<option value="${r.slug}">${esc(r.manufacturer)} ${esc(r.model)}</option>`).join('');
  $('#cmp-a').innerHTML = opts;
  $('#cmp-b').innerHTML = opts;
  $('#cmp-b').value = rows[1].slug;
  $('#cmp-a').onchange = renderCompare;
  $('#cmp-b').onchange = renderCompare;
  function renderCompare() {
    if (view === 'compare' && current && !renderCompare.init) { $('#cmp-a').value = current.slug; if ($('#cmp-b').value === current.slug) $('#cmp-b').value = order.find((s) => s !== current.slug); renderCompare.init = true; }
    const a = $('#cmp-a').value, b = $('#cmp-b').value;
    const res = compareCars(a, b);
    const A = res.rows.find((r) => r.slug === a) || res.rows[0];
    const B = res.rows.find((r) => r.slug === b) || res.rows[0];
    const metrics = [
      ['Power', 'power_hp', 'hp', 1], ['Torque', 'torque_nm', 'Nm', 1], ['Top speed', 'top_speed_kmh', 'km/h', 1],
      ['0-100 km/h', 'zero_100_s', 's', -1], ['Weight', 'weight_kg', 'kg', -1], ['hp / tonne', 'hp_per_tonne', '', 1], ['Price', 'price_usd', '$', -1],
    ];
    let sa = 0, sb = 0;
    const rowsHtml = metrics.map(([label, k, unit, better]) => {
      const va = A[k], vb = B[k];
      const m = Math.max(va, vb);
      const aw = va !== vb && (better > 0 ? va > vb : va < vb);
      const bw = va !== vb && !aw;
      if (aw) sa++; if (bw) sb++;
      const show = (v) => (unit === '$' ? `$${fmt(v)}` : `${fmt(v)} ${unit}`);
      return `<div class="cmp-row">
        <div class="cmp-side a ${aw ? 'win' : ''}"><div class="bar"><i style="width:${(va / m) * 100}%"></i></div><b>${show(va)}</b></div>
        <label>${label}</label>
        <div class="cmp-side b ${bw ? 'win' : ''}"><div class="bar"><i style="width:${(vb / m) * 100}%"></i></div><b>${show(vb)}</b></div>
      </div>`;
    }).join('');
    $('#cmp-body').innerHTML = `<div class="cmp-heads"><h3>${esc(A.model)}</h3><div class="score">${sa} : ${sb}</div><h3>${esc(B.model)}</h3></div>${rowsHtml}`;
    $('#cmp-sql').innerHTML = `${highlight(res.sql)}\n<span class="meta">-- ${res.ms.toFixed(2)} ms</span>`;
  }

  // ---------------- SQL lab ----------------
  const PRESETS = [
    ['Quickest to 100', 'SELECT manufacturer, model, zero_100_s\nFROM car_overview\nORDER BY zero_100_s ASC\nLIMIT 5;'],
    ['GROUP BY country', 'SELECT country,\n       COUNT(*)            AS cars,\n       ROUND(AVG(power_hp)) AS avg_hp,\n       MAX(top_speed_kmh)  AS fastest\nFROM car_overview\nGROUP BY country\nORDER BY avg_hp DESC;'],
    ['JOIN engines', 'SELECT c.model, e.code, e.layout, e.displacement_l, e.aspiration\nFROM cars c\nJOIN engines e ON e.id = c.engine_id\nORDER BY e.cylinders DESC;'],
    ['Brakes (3-table JOIN)', "SELECT m.name AS maker, c.model, cp.spec AS brakes\nFROM car_parts cp\nJOIN cars c          ON c.id = cp.car_id\nJOIN manufacturers m ON m.id = c.manufacturer_id\nWHERE cp.part_key = 'brakes';"],
    ['Sub-query', 'SELECT model, power_hp\nFROM cars\nWHERE power_hp > (SELECT AVG(power_hp) FROM cars)\nORDER BY power_hp DESC;'],
    ['UPDATE a row', "UPDATE cars SET power_hp = power_hp + 100 WHERE slug = 'thar';\nSELECT model, power_hp FROM cars WHERE slug = 'thar';"],
    ['Schema', "SELECT type, name, sql\nFROM sqlite_master\nWHERE type IN ('table', 'view', 'index');"],
  ];
  $('#lab-presets').innerHTML = PRESETS.map(([n], i) => `<button data-i="${i}">${esc(n)}</button>`).join('');
  $('#lab-presets').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('#lab-input').value = PRESETS[+b.dataset.i][1];
    runLab();
  };
  $('#lab-run').onclick = runLab;
  $('#lab-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runLab(); } e.stopPropagation(); });
  $('#lab-reset').onclick = async () => { await resetDatabase(); toast('Database reset to seed data'); runLab(); };
  function runLab() {
    const sql = $('#lab-input').value;
    try {
      const r = runConsole(sql);
      $('#lab-meta').textContent = `${r.rows.length} row${r.rows.length === 1 ? '' : 's'} · ${r.ms.toFixed(2)} ms`;
      $('#lab-out').innerHTML = r.columns.length
        ? `<table><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.rows.map((row) => `<tr>${r.columns.map((c) => `<td>${esc(row[c] ?? 'NULL')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : `<div class="err" style="color:var(--ink-2)">Done. ${r.changes ?? 0} row(s) changed.</div>`;
    } catch (err) {
      $('#lab-meta').textContent = 'error';
      $('#lab-out').innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  }

  // ---------------- keyboard ----------------
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (cinema.on) cinema.stop(); else if (view !== 'showroom') setView('showroom'); else showroom.reset(); return; }
    if (k === 'c' && view === 'showroom') { cinema.toggle(); return; }
    if (k === 'l') { $('#btn-loc').click(); return; }
    if (cinema.on) return;
    if (view !== 'showroom') return;
    if (k === 'arrowright') step(1);
    else if (k === 'arrowleft') step(-1);
    else if (k === 'x') showroom.toggleXray();
    else if (k === 'e') $('#btn-explode').click();
    else if (k === 'r') showroom.reset();
    else if (k === 'm') soundBtn.click();
    else if (/^[1-9]$/.test(k)) {
      const b = document.querySelectorAll('#partlist button')[+k - 1];
      if (b) b.click();
    }
  });

  // ---------------- locations ----------------
  const locEl = $('#locations');
  locEl.innerHTML = `<div class="loc-head">Shoot location</div>${scenes.map((sc) => `
    <button data-scene="${sc.id}"><b>${esc(sc.name)}</b><small>${esc(sc.time)}</small></button>`).join('')}<p id="scene-credit"></p>`;
  const toggleLoc = (open) => document.body.classList.toggle('loc-open', open);
  $('#btn-loc').onclick = (e) => { e.stopPropagation(); toggleLoc(!document.body.classList.contains('loc-open')); };
  window.addEventListener('pointerdown', (e) => { if (!e.target.closest('#locations, #btn-loc')) toggleLoc(false); });
  locEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scene]');
    if (b) { audio.blip(520); toggleLoc(false); switchScene(b.dataset.scene); }
  });
  function onScene(cfg) {
    locEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.scene === cfg.id));
    $('#scene-credit').textContent = `Photo: ${cfg.credit}`;
    $('#loc-name').textContent = cfg.name;
  }

  // ---------------- loading pill ----------------
  let loadText = '';
  function loading(text, frac) {
    const el = $('#loading');
    if (text === false) { el.classList.remove('on'); return; }
    if (text) loadText = text;
    el.querySelector('span').textContent = loadText;
    if (frac != null) el.querySelector('i').style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
    el.classList.add('on');
  }
  function markReal(slug) {
    document.querySelectorAll(`.card[data-slug="${slug}"] em.draft`).forEach((em) => { em.className = 'real'; em.textContent = '3D'; });
  }
  function setThumb(slug, url) {
    document.querySelectorAll(`.card[data-slug="${slug}"] img, .gcard[data-slug="${slug}"] img`).forEach((img) => { img.src = url; });
  }

  // ---------------- ad mode ----------------
  $('#btn-ad').onclick = () => cinema.toggle();
  function cinemaUI(on) {
    $('#btn-ad').classList.toggle('on', on);
    if (!on) $('#adcard').className = '';
  }
  function adCut(shot, car) {
    const card = $('#adcard');
    const r = car.info;
    if (shot.card === 'title') card.innerHTML = `<small>${esc(r.manufacturer)}</small><h2>${esc(r.model)}</h2><p>${esc(r.tagline)}</p>`;
    else if (shot.card === 'spec') card.innerHTML = `<div class="spec"><b>${fmt(r.power_hp)}</b><small>horsepower</small></div><div class="spec"><b>${r.zero_100_s.toFixed(1)}s</b><small>0-100 km/h</small></div><div class="spec"><b>${r.top_speed_kmh}</b><small>km/h top speed</small></div>`;
    else if (shot.card === 'end') card.innerHTML = `<h2>${esc(r.manufacturer)}</h2><p>${esc(r.model)} · from $${fmt(r.price_usd)}</p>`;
    card.className = shot.card ? `show ${shot.card}` : '';
  }

  // ---------------- credits ----------------
  $('#btn-credits').onclick = () => {
    const res = credits();
    $('#credits-list').innerHTML = res.rows.map((c) => `
      <tr><td>${esc(c.kind)}</td><td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>${c.car ? `<small>${esc(c.car)}</small>` : ''}</td><td>${esc(c.author)}</td><td>${esc(c.license)}</td></tr>`).join('');
    $('#credits-sql').innerHTML = highlight(res.sql);
    $('#credits').hidden = false;
  };
  $('#credits-close').onclick = () => { $('#credits').hidden = true; };

  return { onCar, onPart: (p, car) => showPartInfo(p, car), onPiece, onHover, onXray, toast, onScene, loading, setThumb, markReal, adCut, cinema: cinemaUI };
}

function highlight(sql) {
  return esc(sql)
    .replace(/'[^']*'/g, (m) => `<span class="str">${m}</span>`)
    .replace(/\b(SELECT|FROM|WHERE|AND|OR|ORDER BY|GROUP BY|LEFT JOIN|JOIN|ON|AS|IN|LIKE|LIMIT|ASC|DESC|ROUND|COUNT|AVG|MAX|MIN|DISTINCT)\b/g, '<span class="kw">$1</span>');
}
