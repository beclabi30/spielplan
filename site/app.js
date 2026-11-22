'use strict';

const TZ = 'Europe/Vienna';
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000; // ein Spiel bleibt 2 h nach Beginn „nächstes Spiel“
const params = new URLSearchParams(location.search);
// Nur für Tests: andere Datendatei (gleicher Ordner) und fester Zeitpunkt.
const DATA_FILE = /^[\w.-]+\.json$/.test(params.get('data') || '') ? params.get('data') : 'data.json';
const nowFn = () => (params.get('now') ? new Date(params.get('now')) : new Date());

let data = null;
let selected = 'all';
let pane = null; // 'up' | 'tab' | 'res'; null = automatisch
try { selected = localStorage.getItem('team') || 'all'; } catch { /* privat oder gesperrt */ }

/* ---------- Helfer ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

function tzOffsetMs(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime();
}

/** Datum + Uhrzeit in Wiener Ortszeit → echter Zeitpunkt (Sommer-/Winterzeit korrekt). */
function viennaToDate(isoDate, time) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const local = Date.UTC(y, m - 1, d, hh, mm);
  let ts = local;
  for (let i = 0; i < 2; i++) ts = local - tzOffsetMs(new Date(ts));
  return new Date(ts);
}

const fmt = opts => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, ...opts });
const fDayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fDayShort = fmt({ weekday: 'short', day: 'numeric', month: 'numeric' });
const fStamp = fmt({ weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const fKey = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

function relDays(start, now) {
  if (start <= now) return 'läuft gerade';
  const noon = d => viennaToDate(fKey.format(d).split('.').reverse().join('-'), '12:00');
  const n = Math.round((noon(start) - noon(now)) / 86400000);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  return `in ${n} Tagen`;
}

const mapsUrl = address => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

/** Ergebnis aus Sicht des eigenen Teams. */
function ownScore(g) {
  if (!g.result) return null;
  const flip = s => s && s.split(':').reverse().join(':');
  const sets = g.isHome ? g.result.sets : flip(g.result.sets);
  const [a, b] = sets.split(':').map(Number);
  return { sets, win: a > b, setScores: g.isHome ? g.result.setScores : g.result.setScores.map(flip) };
}

/* ---------- Daten aufbereiten ---------- */
function gamesOf(teams) {
  const out = [];
  for (const t of teams) for (const c of t.competitions) for (const g of c.games)
    out.push({ ...g, teamId: t.id, teamLabel: t.label, teamName: t.team, comp: c.name, start: viennaToDate(g.date, g.time) });
  return out;
}

function split(games, now) {
  const upcoming = [], past = [];
  for (const g of games) {
    if (g.played) past.push(g);
    else if (!g.start || g.start.getTime() > now.getTime() - LIVE_WINDOW_MS) upcoming.push(g);
    else past.push(g); // vorbei, aber noch kein Ergebnis eingetragen
  }
  const t = g => (g.start ? g.start.getTime() : Infinity);
  upcoming.sort((a, b) => t(a) - t(b));
  past.sort((a, b) => (b.start ? b.start.getTime() : -Infinity) - (a.start ? a.start.getTime() : -Infinity));
  return { upcoming, past };
}

const visibleTeams = () => data.teams.filter(t => selected === 'all' || t.id === selected);

function setTeam(id) {
  selected = id;
  try { localStorage.setItem('team', selected); } catch { /* egal */ }
  render();
}

/* ---------- Darstellung ---------- */
function renderSeg() {
  const seg = document.getElementById('seg');
  const opts = [{ id: 'all', label: 'Alle' }, ...data.teams.map(t => ({ id: t.id, label: t.label }))];
  if (!opts.some(o => o.id === selected)) selected = 'all';
  seg.replaceChildren(...opts.map(o => {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(o.id === selected), 'data-id': o.id }, o.label);
    b.addEventListener('click', () => setTeam(o.id));
    return b;
  }));
}

function changeNote(g) {
  if (!g.changes || !g.changes.length) return null;
  const last = g.changes[g.changes.length - 1];
  if (last.type === 'termin') {
    const [d, t] = last.from.split(' ');
    const old = viennaToDate(d, t);
    return h('span', { class: 'change' }, `Verschoben, vorher ${old ? fDayShort.format(old) + (t ? ', ' + t : '') : 'anderer Termin'}`);
  }
  return h('span', { class: 'change' }, `Halle geändert, vorher ${last.from}`);
}

function hallBits(g) {
  if (!g.hall) return { name: 'Halle noch offen', address: null };
  return { name: g.hall.name || g.hall.raw, address: g.hall.address };
}

function scoreBox(g) {
  const s = ownScore(g);
  if (!s) return h('div', { class: 'score' }, h('small', {}, 'Ergebnis noch offen'));
  return h('div', { class: `score led${s.win ? '' : ' loss'}` }, s.sets, h('small', {}, s.win ? 'Sieg' : 'Niederlage'));
}

function renderNext(upcoming, past, now) {
  const box = document.getElementById('next');
  const g = upcoming.find(x => x.start) || upcoming[0];
  if (!g) {
    const last = past.find(x => x.played);
    box.replaceChildren(h('div', { class: 'glass quiet' },
      h('h2', {}, 'Gerade kein Spiel angesetzt'),
      h('p', {}, 'Sobald der Verband neue Termine einträgt, stehen sie hier.'),
      last ? h('div', { class: 'last' },
        h('div', {}, h('span', { class: 'chip us' }, last.teamLabel), ' ', h('span', { class: 'muted' }, 'Zuletzt: '),
          `${last.isHome ? 'gegen' : 'bei'} ${last.opponent}`, h('div', { class: 'card-next' }, last.start ? fDayShort.format(last.start) : last.note || '')),
        scoreBox(last)) : null));
    return;
  }
  const [left, right] = g.isHome ? [g.teamName, g.opponent] : [g.opponent, g.teamName];
  const hall = hallBits(g);
  box.replaceChildren(h('article', { class: 'glass board' },
    h('div', { class: 'board-head' },
      h('p', { class: 'board-title' }, h('span', { class: 'chip us' }, g.teamLabel), ` ${g.isHome ? 'Heimspiel' : 'Auswärtsspiel'}`),
      g.start ? h('span', { class: 'board-rel' }, relDays(g.start, now)) : null),
    g.start
      ? h('p', { class: 'board-when' }, h('span', { class: 'time led' }, g.time || '--:--'), h('span', { class: 'day' }, fDayLong.format(g.start)))
      : h('p', { class: 'board-when' }, h('span', { class: 'day' }, 'Termin noch offen')),
    h('div', { class: 'court', role: 'img', 'aria-label': `${g.home} gegen ${g.away}` },
      h('div', { class: `half left${g.isHome ? ' us' : ''}` }, h('span', { class: 'side' }, 'Heim'), h('span', { class: 'name' }, left)),
      h('div', { class: `half right${g.isHome ? '' : ' us'}` }, h('span', { class: 'side' }, 'Gast'), h('span', { class: 'name' }, right)),
      h('div', { class: 'net' })),
    changeNote(g),
    h('div', { class: 'board-foot' },
      h('div', {}, h('p', { class: 'hall' }, hall.name), h('p', { class: 'addr' }, hall.address || 'Adresse noch offen'), h('p', { class: 'addr' }, g.comp)),
      hall.address ? h('a', { class: 'route', href: mapsUrl(hall.address), target: '_blank', rel: 'noopener noreferrer' }, 'Route planen') : null)));
}

function renderCards(now) {
  const box = document.getElementById('cards');
  box.replaceChildren(...visibleTeams().map(t => {
    const comp = t.competitions[0];
    const row = comp && comp.standings.find(s => s.team === t.team);
    const { upcoming, past } = split(gamesOf([t]), now);
    const form = past.filter(g => g.played).slice(0, 5).reverse().map(g => {
      const s = ownScore(g);
      return h('span', { class: `dot ${s.win ? 'w' : 'l'}`, title: `${s.win ? 'Sieg' : 'Niederlage'} ${s.sets} ${g.isHome ? 'gegen' : 'bei'} ${g.opponent}` });
    });
    const nxt = upcoming[0];
    const card = h('button', { type: 'button', class: 'glass card', 'aria-label': `${t.label} anzeigen` },
      h('div', { class: 'card-head' }, h('span', { class: 'card-name' }, t.label), h('div', { class: 'form', 'aria-label': 'Letzte Spiele, links das älteste' }, form)),
      h('div', { class: 'card-comp' }, comp ? `${comp.name} ${comp.season || ''}` : 'Kein Bewerb'),
      h('div', { class: 'card-stats' },
        h('div', { class: 'card-rank led' }, row ? `${row.rank}.` : '–', h('small', {}, row ? `Platz von ${comp.standings.length}` : 'Platz')),
        h('div', { class: 'card-pts led' }, row ? row.points : '–', h('small', {}, 'Punkte')),
        h('div', { class: 'card-pts led' }, row ? `${row.won}:${row.lost}` : '–', h('small', {}, 'Bilanz'))),
      h('div', { class: 'card-next' }, nxt ? ['Nächstes: ', h('b', {}, nxt.start ? `${fDayShort.format(nxt.start)}, ${nxt.time || ''}` : 'Termin offen'), ` ${nxt.isHome ? 'gegen' : 'bei'} ${nxt.opponent}`] : 'Noch kein neuer Termin'));
    card.addEventListener('click', () => setTeam(t.id));
    return card;
  }));
}

function gameRow(g, kind) {
  const showTeam = selected === 'all';
  const date = g.start
    ? h('div', { class: 'date' }, fDayShort.format(g.start), h('small', {}, g.time || 'Zeit offen'))
    : h('div', { class: 'date note' }, (g.note || 'Termin offen').replace('Spielverzicht', 'Spiel­verzicht'));
  const who = h('div', {},
    h('div', { class: 'who' }, showTeam ? h('span', { class: 'chip' }, g.teamLabel) : null,
      h('span', {}, h('span', { class: 'vs' }, g.isHome ? 'gegen ' : 'bei '), g.opponent)));
  let cls = 'game', right = null;
  if (kind === 'up') {
    const hall = hallBits(g);
    who.append(h('div', { class: 'sub' }, `${g.isHome ? 'Heim' : 'Auswärts'}, `,
      hall.address ? h('a', { href: mapsUrl(hall.address), target: '_blank', rel: 'noopener noreferrer' }, hall.name) : `${hall.name}, Adresse noch offen`));
    const c = changeNote(g); if (c) who.append(h('div', {}, c));
    right = h('div', {});
  } else {
    const s = ownScore(g);
    if (s) { cls += s.win ? ' win' : ' loss'; who.append(h('div', { class: 'sub' }, s.setScores.join('  '))); }
    right = scoreBox(g);
  }
  return h('li', { class: cls }, date, who, right);
}

function renderList(id, games, kind, emptyText) {
  document.getElementById(id).replaceChildren(...(games.length ? games.map(g => gameRow(g, kind)) : [h('li', { class: 'empty-row' }, emptyText)]));
}

function renderTables() {
  const box = document.getElementById('tables');
  box.replaceChildren();
  for (const t of visibleTeams()) for (const c of t.competitions) {
    if (!c.standings.length) continue;
    box.append(h('h3', { class: 'tbl-title' }, `${t.label}: ${c.name}`),
      h('table', { class: 'standings' },
        h('thead', {}, h('tr', {}, h('th', { class: 'r', scope: 'col', title: 'Platz' }, '#'), h('th', { class: 't', scope: 'col' }, 'Team'),
          h('th', { scope: 'col', title: 'Spiele' }, 'Sp'), h('th', { scope: 'col', title: 'Siege' }, 'S'), h('th', { scope: 'col', title: 'Niederlagen' }, 'N'),
          h('th', { class: 'sets', scope: 'col' }, 'Sätze'), h('th', { scope: 'col', title: 'Punkte' }, 'Pkt'))),
        h('tbody', {}, c.standings.map(s => h('tr', { class: s.team === t.team ? 'us' : null },
          h('td', { class: 'r' }, s.rank), h('td', { class: 't' }, s.team), h('td', {}, s.played ?? '–'), h('td', {}, s.won ?? '–'), h('td', {}, s.lost ?? '–'),
          h('td', { class: 'sets' }, `${s.setsWon ?? '–'}:${s.setsLost ?? '–'}`), h('td', { class: 'pts' }, s.points ?? '–'))))));
  }
  if (!box.children.length) box.append(h('p', { class: 'empty-row' }, 'Noch keine Tabelle veröffentlicht.'));
}

function renderTabs(hasUpcoming) {
  const active = pane || (hasUpcoming ? 'up' : 'res');
  for (const b of document.querySelectorAll('.tabs button')) {
    const on = b.dataset.pane === active;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    document.getElementById(`pane-${b.dataset.pane}`).hidden = !on;
  }
}

function renderStatus() {
  const checked = data.checkedAt ? new Date(data.checkedAt) : null;
  document.getElementById('stamp').textContent = checked ? `Zuletzt aktualisiert: ${fStamp.format(checked)}` : 'Stand unbekannt';
  const alert = document.getElementById('alert');
  if (data.status !== 'ok' && data.warnings && data.warnings.length) {
    const ok = data.lastSuccessAt ? ` Letzter vollständiger Stand: ${fStamp.format(new Date(data.lastSuccessAt))}.` : '';
    alert.textContent = data.warnings.join(' ') + ok;
    alert.hidden = false;
  } else alert.hidden = true;
  const admin = document.getElementById('admin');
  if (data.adminUrl && /^https:\/\/github\.com\//.test(data.adminUrl)) {
    document.getElementById('admin-link').href = data.adminUrl;
    admin.hidden = false;
  } else admin.hidden = true;
}

function render() {
  if (!data) return;
  const now = nowFn();
  renderSeg();
  renderStatus();
  const { upcoming, past } = split(gamesOf(visibleTeams()), now);
  renderNext(upcoming, past, now);
  renderCards(now);
  renderList('upcoming', upcoming.slice(1), 'up', upcoming.length ? 'Keine weiteren Termine.' : 'Noch keine Termine eingetragen.');
  renderTables();
  renderList('results', past, 'past', 'Noch keine Ergebnisse.');
  renderTabs(upcoming.length > 1);
}

/* ---------- Laden ---------- */
async function load(manual) {
  const btn = document.getElementById('refresh');
  btn.setAttribute('aria-busy', 'true');
  const before = data && data.checkedAt;
  try {
    const res = await fetch(`${DATA_FILE}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const fresh = await res.json();
    if (!fresh || !Array.isArray(fresh.teams)) throw new Error('Datenformat');
    data = fresh;
    render();
    if (manual) {
      const stamp = document.getElementById('stamp');
      stamp.textContent = (before === data.checkedAt ? 'Schon aktuell. ' : 'Neu geladen. ') + stamp.textContent;
    }
  } catch {
    if (data) {
      document.getElementById('stamp').textContent = 'Keine Verbindung. Angezeigt wird der zuletzt geladene Stand.';
    } else {
      const alert = document.getElementById('alert');
      alert.textContent = 'Der Spielplan konnte nicht geladen werden. Prüfe die Internetverbindung und tippe auf „Jetzt aktualisieren“.';
      alert.hidden = false;
      document.getElementById('stamp').textContent = 'Nicht geladen';
    }
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refresh').addEventListener('click', () => load(true));
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => { pane = b.dataset.pane; render(); });
  load(false);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(false); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
});
