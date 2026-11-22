#!/usr/bin/env node
// Holt die Daten vom Wiener Volleyball Verband und schreibt site/data.json.
// Aufruf: node scraper/update.mjs [--prev pfad/zu/altem/data.json] [--out site/data.json] [--fixtures tests/fixtures]
//
// Regeln: Ist die Quelle nicht erreichbar oder passt ihr Aufbau nicht, wird der letzte
// gültige Stand behalten und nur eine Warnung ergänzt. Ein leerer Stand wird nie geschrieben.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildData, validate } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const outFile = path.resolve(root, args.out || 'site/data.json');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function load(page) {
  if (args.fixtures) {
    const name = path.basename(page).replace(/^tabellen_/, '');
    const local = { 'nachwuchs-burschen.html': 'nachwuchs-burschen.html', 'herren.html': 'herren.html', 'hallenliste.html': 'hallenliste.html' }[name] || name;
    return readFile(path.resolve(root, args.fixtures, local), 'utf8');
  }
  const url = `${config.source}/${page}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'volleyball-uebersicht (private Spielplan-Anzeige, Abfrage alle 3 Stunden)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${url} antwortet mit ${res.status}.`);
  const html = await res.text();
  if (!/OEVVBewerb|HalleName/i.test(html)) throw new Error(`${url} hat einen unbekannten Aufbau.`);
  return html;
}

const prev = args.prev ? await readJson(path.resolve(args.prev)) : await readJson(outFile);
const now = new Date();

let data;
try {
  const pages = {};
  for (const page of [...new Set(config.teams.map(t => t.page))]) {
    pages[page] = await load(page);
    if (!args.fixtures) await sleep(2000);
  }
  let hallsHtml = null;
  try { hallsHtml = await load(config.hallPage); } catch { /* Adressen vom letzten Stand */ }

  data = buildData({ pages, hallsHtml, config, prev, now });
  const problems = validate(data, config);
  if (problems.length) throw new Error(`Daten unplausibel: ${problems.join(' ')}`);
} catch (err) {
  if (!prev || validate(prev, config).length) {
    console.error(`Fehler und kein gültiger alter Stand vorhanden: ${err.message}`);
    process.exit(1);
  }
  data = { ...prev, checkedAt: now.toISOString(), status: 'error',
    warnings: [`Die Verbandsseite konnte beim letzten Versuch nicht gelesen werden (${err.message}). Angezeigt wird der letzte gültige Stand.`] };
  console.warn(`Warnung: ${err.message} – alter Stand bleibt.`);
}

data.adminUrl = process.env.ADMIN_URL || config.adminUrl || '';
await writeFile(outFile, JSON.stringify(data, null, 1) + '\n', 'utf8');
console.log(`Gespeichert: ${path.relative(root, outFile)} (Status ${data.status}, ${data.teams.map(t => `${t.label}: ${t.competitions.reduce((n, c) => n + c.games.length, 0)} Spiele`).join(', ')})`);
