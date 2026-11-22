// Liest die Tabellen des Wiener Volleyball Verbands aus. Ohne Zusatzpakete.

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ouml: 'ö', uuml: 'ü', auml: 'ä', Ouml: 'Ö', Uuml: 'Ü', Auml: 'Ä', szlig: 'ß' };

export function text(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function cells(rowHtml) {
  const out = {};
  const re = /<TD\s+CLASS="?([A-Za-z]+)"?[^>]*?(?:\/>|>([\s\S]*?)<\/TD>)/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    if (!(m[1] in out)) out[m[1]] = text(m[2] ?? '');
  }
  return out;
}

function rows(tableHtml) {
  return [...tableHtml.matchAll(/<TR\s+CLASS="?C[01]"?[^>]*>([\s\S]*?)<\/TR>/gi)].map(m => cells(m[1]));
}

const int = v => (/^-?\d+$/.test(v) ? Number(v) : null);

/** Alle Bewerbe einer Tabellenseite: Titel, Saison, Tabelle, Spiele. */
export function parseCompetitions(html) {
  const parts = html.split(/<DIV\s+CLASS="?OEVVBewerb"?\s*>/i).slice(1);
  return parts.map(part => {
    const end = part.search(/<\/DIV>/i);
    const title = text(part.slice(0, end));
    const body = part.slice(end);
    const season = (title.match(/\((\d{4}\/\d{4})\)\s*$/) || [])[1] || null;
    const name = title.replace(/^WVV\s*-\s*/, '').replace(/\s*\(\d{4}\/\d{4}\)\s*$/, '').trim();

    const standTable = (body.match(/<TABLE\s+CLASS="?Tabelle"?[^>]*>([\s\S]*?)<\/TABLE>/i) || [])[1];
    const gameTable = (body.match(/<TABLE\s+CLASS="?Ergebnis"?[^>]*>([\s\S]*?)<\/TABLE>/i) || [])[1];

    const standings = standTable ? rows(standTable).filter(r => r.TabTeam).map((r, i) => ({
      rank: i + 1,
      team: r.TabTeam,
      played: int(r.TabMatP), won: int(r.TabMatW), lost: int(r.TabMatL),
      setsWon: int(r.TabSetW), setsLost: int(r.TabSetL),
      ballsWon: int(r.TabPnkW), ballsLost: int(r.TabPnkL),
      points: int(r.TabPnk),
    })) : [];

    const games = gameTable ? rows(gameTable).filter(r => r.ErgSpN || r.ErgUebertrag).map(r => {
      const note = r.ErgUebertrag || null; // z. B. „Spielverzicht“: keine Nummer, kein Datum
      const g = { nr: r.ErgSpN || `${note}: ${r.ErgHeim} - ${r.ErgGast}`, note, date: toIsoDate(r.ErgDat), time: /^\d{1,2}:\d{2}$/.test(r.ErgZeit || '') ? r.ErgZeit.padStart(5, '0') : null,
        home: r.ErgHeim || null, away: r.ErgGast || null, played: false, hall: null, result: null };
      if (r.ErgSet && /^\d+:\d+$/.test(r.ErgSet)) {
        g.played = true;
        g.result = { sets: r.ErgSet, balls: r.ErgPnk || null, setScores: r.ErgSetPnk ? r.ErgSetPnk.split(',').map(s => s.trim()).filter(Boolean) : [] };
      } else if (r.ErgHalle) {
        g.hall = r.ErgHalle;
      }
      return g;
    }) : [];

    return { title, name, season, standings, games };
  });
}

export function toIsoDate(d) {
  const m = String(d || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** Hallenliste: [{name, short, address}] */
export function parseHalls(html) {
  const re = /CLASS="?HalleName"?[^>]*>([\s\S]*?)<\/TD>[\s\S]*?CLASS="?HalleAdresse"?[^>]*>([\s\S]*?)<\/TD>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const nameCell = m[1];
    const short = text((nameCell.match(/HalleKurz[^>]*>([\s\S]*?)<\/SPAN>/i) || [])[1] || '').replace(/^\(|\)$/g, '').trim();
    const name = text(nameCell.replace(/<SPAN[\s\S]*?<\/SPAN>/i, ''));
    const address = text(m[2]);
    if (name && address) out.push({ name, short, address });
  }
  return out;
}

const norm = s => String(s).toLowerCase()
  .replace(/^rh\s/, 'rundhalle ').replace(/^sh\s/, 'sporthalle ')
  .replace(/[^a-z0-9äöüß]+/g, ' ').trim();

/** Ordnet einen Hallennamen aus dem Spielplan der Hallenliste zu. Nur eindeutige Treffer. */
export function findHall(raw, halls, aliases = {}) {
  if (!raw) return null;
  if (aliases[raw]) return halls.find(h => h.name === aliases[raw] || h.short === aliases[raw]) || null;
  const n = norm(raw);
  const exact = halls.filter(h => norm(h.short) === n || norm(h.name) === n);
  if (exact.length === 1) return exact[0];
  const words = n.split(' ').filter(w => w.length > 2);
  const hits = halls.filter(h => {
    const hn = norm(`${h.name} ${h.short}`);
    return words.length > 0 && words.every(w => hn.split(' ').includes(w) || hn.includes(w));
  });
  // Gleiche Adresse zählt als ein Treffer (z. B. zwei Namen für dieselbe Halle).
  const addresses = new Set(hits.map(h => h.address));
  return addresses.size === 1 ? hits[0] : null;
}

/** Bewerbe für ein Team: passender Titel, Team kommt vor, neueste Saison. */
export function competitionsForTeam(competitions, cfg) {
  const want = cfg.competition.toLowerCase();
  const hit = competitions.filter(c =>
    c.title.toLowerCase().includes(want) &&
    !(cfg.exclude || []).some(x => c.title.includes(x)) &&
    (c.standings.some(s => s.team === cfg.team) || c.games.some(g => g.home === cfg.team || g.away === cfg.team)));
  const seasons = hit.map(c => c.season).filter(Boolean).sort();
  const latest = seasons[seasons.length - 1];
  return hit.filter(c => c.season === latest);
}

/** Baut den Datenstand für die Website. prev = letzter gültiger Stand (oder null). */
export function buildData({ pages, hallsHtml, config, prev, now = new Date() }) {
  const warnings = [];
  const halls = hallsHtml ? parseHalls(hallsHtml) : [];
  const hallList = halls.length >= 10 ? halls : (prev?.halls || []);
  if (halls.length < 10) warnings.push('Die Hallenliste konnte nicht gelesen werden. Adressen stammen vom letzten Stand.');

  const parsed = {};
  for (const [page, html] of Object.entries(pages)) parsed[page] = parseCompetitions(html);

  const prevGames = new Map();
  for (const t of prev?.teams || []) for (const c of t.competitions) for (const g of c.games) prevGames.set(`${t.id}:${g.nr}`, g);

  const teams = [];
  for (const cfg of config.teams) {
    const comps = competitionsForTeam(parsed[cfg.page] || [], cfg);
    if (comps.length === 0) throw new Error(`Team ${cfg.label} (${cfg.team}) wurde auf ${cfg.page} nicht gefunden.`);
    const competitions = comps.slice().reverse().map(c => ({
      name: c.name,
      season: c.season,
      standings: c.standings,
      games: c.games.filter(g => g.home === cfg.team || g.away === cfg.team).map(g => {
        const isHome = g.home === cfg.team;
        const hall = g.hall ? findHall(g.hall, hallList, config.hallAliases) : null;
        const game = { ...g, isHome, opponent: isHome ? g.away : g.home,
          hall: g.hall ? { raw: g.hall, name: hall?.name || null, address: hall?.address || null } : null,
          changes: [] };
        const old = prevGames.get(`${cfg.id}:${g.nr}`);
        if (old && !g.played) {
          game.changes = (old.changes || []).slice();
          if (old.date !== g.date || old.time !== g.time) game.changes.push({ type: 'termin', from: `${old.date} ${old.time ?? ''}`.trim(), detectedAt: now.toISOString() });
          if ((old.hall?.raw || null) !== (g.hall || null) && old.hall?.raw) game.changes.push({ type: 'halle', from: old.hall.raw, detectedAt: now.toISOString() });
        }
        return game;
      }),
    }));
    teams.push({ id: cfg.id, label: cfg.label, team: cfg.team, season: comps[0].season, competitions });
  }

  return {
    version: 1,
    checkedAt: now.toISOString(),
    lastSuccessAt: now.toISOString(),
    status: warnings.length ? 'warning' : 'ok',
    warnings,
    source: config.source,
    adminUrl: config.adminUrl || '',
    teams,
    halls: hallList,
  };
}

/** Prüft, ob ein Datenstand veröffentlicht werden darf. */
export function validate(data, config) {
  const problems = [];
  if (!data || !Array.isArray(data.teams)) return ['Kein Datenstand.'];
  for (const cfg of config.teams) {
    const t = data.teams.find(x => x.id === cfg.id);
    if (!t) { problems.push(`${cfg.label} fehlt.`); continue; }
    if (!t.competitions.length) problems.push(`${cfg.label} hat keinen Bewerb.`);
    for (const c of t.competitions) {
      for (const g of c.games) {
        if (g.date && !/^\d{4}-\d{2}-\d{2}$/.test(g.date)) problems.push(`${cfg.label}: Datum ${g.date} ungültig.`);
        if (!g.opponent) problems.push(`${cfg.label}: Spiel ${g.nr} ohne Gegner.`);
      }
    }
  }
  return problems;
}
