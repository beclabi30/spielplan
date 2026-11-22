// Erzeugt Testdaten für die Browser-Tests aus einem echten Datenstand.
// Die künstlichen Spiele landen nur im Testordner, nie in site/.
// Aufruf: node tests/make-fixtures.mjs <echtes data.json> <zielordner>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [src, dir] = process.argv.slice(2);
const real = JSON.parse(await readFile(src, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(real));
const save = (name, d) => writeFile(path.join(dir, name), JSON.stringify(d), 'utf8');

// Normalfall: echte Daten, Zeitpunkt wird im Test über ?now= gesetzt.
await save('fx-real.json', real);

// Kommende Spiele inkl. verschobenem Termin, unbekannter Halle und Spiel nach Zeitumstellung.
const up = clone();
const u18 = up.teams.find(t => t.id === 'u18').competitions[0];
const hall = up.halls.find(h => /Simmering/.test(h.name));
u18.games.push(
  { nr: 'T1', date: '2026-12-05', time: '09:00', home: 'Sokol V/1', away: 'Döbling 1', isHome: false, opponent: 'Sokol V/1', played: false, result: null,
    hall: { raw: 'RH Simmering', name: hall.name, address: hall.address }, changes: [{ type: 'termin', from: '2026-11-29 10:00', detectedAt: '2026-11-22T10:00:00Z' }] },
  { nr: 'T2', date: '2027-03-28', time: '10:30', home: 'Döbling 1', away: 'Tigers 1', isHome: true, opponent: 'Tigers 1', played: false, result: null,
    hall: { raw: 'Neue Halle XY', name: null, address: null }, changes: [] });
await save('fx-upcoming.json', up);

// Quelle nicht erreichbar: alter Stand mit Warnung.
const err = clone();
err.status = 'error';
err.lastSuccessAt = '2026-11-21T08:00:00.000Z';
err.warnings = ['Die Verbandsseite konnte beim letzten Versuch nicht gelesen werden (https://www.volleyball-wien.at/tabellen/herren.html antwortet mit 503.). Angezeigt wird der letzte gültige Stand.'];
await save('fx-error.json', err);

// Keine Spiele und keine Tabelle (z. B. neue Saison, noch nichts eingetragen).
const empty = clone();
for (const t of empty.teams) t.competitions = [{ name: 'Neue Saison', season: '2027/2028', standings: [], games: [] }];
await save('fx-empty.json', empty);
console.log('Testdaten geschrieben nach', dir);
