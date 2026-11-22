// Aufruf: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompetitions, parseHalls, findHall, buildData, validate } from '../scraper/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = name => readFile(path.join(root, 'tests/fixtures', name), 'utf8');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));

test('liest Bewerbe, Tabellen, Spiele und Spielverzicht', async () => {
  const comps = parseCompetitions(await fx('nachwuchs-burschen.html'));
  const u18 = comps.find(c => c.name === 'u18m Qualifikation Gruppe A');
  assert.equal(u18.season, '2026/2027');
  assert.equal(u18.standings[0].team, 'Döbling 1');
  assert.equal(u18.standings[0].points, 6);
  const sv = u18.games.find(g => g.note === 'Spielverzicht' && g.home === 'Döbling 1');
  assert.equal(sv.result.sets, '2:0');
  const future = u18.games.find(g => g.nr === '2608');
  assert.equal(future.played, false);
  assert.equal(future.hall, 'RH Simmering');
  assert.equal(future.date, '2026-12-05');
});

test('ordnet Hallen eindeutig zu, sonst gar nicht', async () => {
  const halls = parseHalls(await fx('hallenliste.html'));
  assert.ok(halls.length > 50);
  assert.equal(findHall('RH Simmering', halls).address, 'Florian Hedorfer-Straße 24, 1110 Wien');
  assert.match(findHall('SH Jedlesee', halls).address, /Jedleseer Straße/);
  assert.equal(findHall('Gibt es nicht', halls), null);
});

test('findet die drei Teams und lässt die ÖMS weg', async () => {
  const data = buildData({ pages: { 'tabellen/nachwuchs-burschen.html': await fx('nachwuchs-burschen.html'), 'tabellen/herren.html': await fx('herren.html') },
    hallsHtml: await fx('hallenliste.html'), config, prev: null });
  assert.deepEqual(validate(data, config), []);
  const names = data.teams.flatMap(t => t.competitions.map(c => `${t.id}:${c.name}`));
  assert.deepEqual(names, ['u18:u18m Qualifikation Gruppe A', 'u20:u20m Qualifikation Gruppe A', 'h3:Herren Landesliga Grunddurchgang']);
});

test('erkennt verschobene Termine', async () => {
  const pages = { 'tabellen/nachwuchs-burschen.html': await fx('nachwuchs-burschen.html'), 'tabellen/herren.html': await fx('herren.html') };
  const hallsHtml = await fx('hallenliste.html');
  const first = buildData({ pages, hallsHtml, config, prev: null });
  // Ein kommendes Spiel künstlich in den alten Stand legen, mit anderem Termin
  const prev = JSON.parse(JSON.stringify(first));
  pages['tabellen/herren.html'] = pages['tabellen/herren.html'].replace('<TD CLASS="ErgSpN">1023</TD><TD CLASS="ErgDat">21.11.2026</TD><TD CLASS="ErgZeit">09:00</TD>', '<TD CLASS="ErgSpN">1023</TD><TD CLASS="ErgDat">21.11.2026</TD><TD CLASS="ErgZeit">09:00</TD>');
  const g = prev.teams[2].competitions[0].games.find(x => x.nr === '1023');
  g.played = false; g.date = '2026-11-20';
  const html = pages['tabellen/herren.html'].replace(/(<TD CLASS="ErgSpN">1023<\/TD>[\s\S]*?<TD CLASS="ErgGast">[^<]*<\/TD>)<TD CLASS="ErgSet">[\s\S]*?<\/TR>/, '$1<TD CLASS="ErgHalle" COLSPAN="3">RH Simmering</TD></TR>');
  const second = buildData({ pages: { ...pages, 'tabellen/herren.html': html }, hallsHtml, config, prev });
  const moved = second.teams[2].competitions[0].games.find(x => x.nr === '1023');
  assert.equal(moved.changes[0].type, 'termin');
  assert.equal(moved.changes[0].from, '2026-11-20 09:00');
});

test('Quelle kaputt: alter Stand bleibt, mit Warnung; ohne alten Stand wird nichts geschrieben', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vb-'));
  const broken = path.join(dir, 'broken');
  await import('node:fs/promises').then(f => f.mkdir(broken));
  for (const n of ['nachwuchs-burschen.html', 'herren.html', 'hallenliste.html']) await writeFile(path.join(broken, n), '<html>Wartung</html>');
  const out = path.join(dir, 'data.json');
  // 1) ohne alten Stand: Abbruch, keine Datei
  assert.throws(() => execFileSync(process.execPath, ['scraper/update.mjs', '--fixtures', broken, '--out', out], { cwd: root, stdio: 'pipe' }));
  await assert.rejects(readFile(out));
  // 2) mit gültigem altem Stand: alter Stand bleibt, Status error
  execFileSync(process.execPath, ['scraper/update.mjs', '--fixtures', 'tests/fixtures', '--out', out], { cwd: root, stdio: 'pipe' });
  const good = JSON.parse(await readFile(out, 'utf8'));
  execFileSync(process.execPath, ['scraper/update.mjs', '--fixtures', broken, '--out', out], { cwd: root, stdio: 'pipe' });
  const after = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(after.status, 'error');
  assert.equal(after.lastSuccessAt, good.lastSuccessAt);
  assert.deepEqual(after.teams, good.teams);
  assert.match(after.warnings[0], /letzte gültige Stand/);
});
