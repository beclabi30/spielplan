"""Browser-Tests der Spielplan-Seite. Aufruf: python tests/browser_test.py <www-ordner> <screenshot-ordner>"""
import sys, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

www, shots = sys.argv[1], sys.argv[2]
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=www)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
Handler = functools.partial(Quiet, directory=www)
srv = socketserver.TCPServer(("127.0.0.1", 0), Handler); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{port}/index.html"
NOW = "2026-11-22T13:00:00Z"
fails, external, errors = [], [], []

def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    def page_for(w, h, dark=False):
        ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme="dark" if dark else "light", locale="de-AT", timezone_id="Europe/Vienna")
        pg = ctx.new_page()
        pg.on("request", lambda r: external.append(r.url) if not r.url.startswith(f"http://127.0.0.1:{port}") and not r.url.startswith("data:") else None)
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        return pg

    for name, (w, h) in {"mobile": (390, 844), "desktop": (1280, 900)}.items():
        for case in ["real", "upcoming", "error", "empty"]:
            pg = page_for(w, h, dark=(case == "upcoming" and name == "mobile"))
            pg.goto(f"{BASE}?data=fx-{case}.json&now={NOW}"); pg.wait_for_load_state("networkidle")
            pg.screenshot(path=f"{shots}/{name}-{case}.png", full_page=True)
            body = pg.inner_text("body")
            tag = f"[{name}/{case}]"
            check("Zuletzt aktualisiert" in body, f"{tag} Stand-Anzeige sichtbar")
            check(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"{tag} kein seitliches Scrollen")
            if case == "real":
                check("Gerade kein Spiel angesetzt" in body, f"{tag} leerer Hinweis, weil echt kein Spiel angesetzt")
                check(pg.locator("tr.us").count() == 3, f"{tag} eigenes Team in 3 Tabellen hervorgehoben")
                check("Sieg" in body and "Niederlage" in body, f"{tag} Ergebnisse mit Sieg/Niederlage")
                check(pg.is_visible("#pane-res") and pg.locator("#results li").count() == 13 and "Spielverzicht" in body.replace("­", ""), f"{tag} ohne Termine startet Reiter Ergebnisse, alle 13 da")
                pg.click("#tab-tab"); check(pg.is_visible("#pane-tab") and not pg.is_visible("#pane-res") and pg.locator("#tables tbody tr").count() == 18, f"{tag} Reiter Tabelle mit ganzen Tabellen")
                pg.click("#tab-up"); check(pg.is_visible("#pane-up") and "Noch keine Termine" in pg.inner_text("#pane-up"), f"{tag} Reiter Termine")
                check(pg.locator(".card").count() == 0, f"{tag} keine Team-Kacheln mehr")
                pg.click("#seg button[data-id=h3]")
                check(pg.locator("tr.us").count() == 1 and "u18m" not in pg.inner_text("#tables"), f"{tag} Filter Herren/3 wirkt")
                pg.reload(); pg.wait_for_load_state("networkidle")
                check(pg.get_attribute("#seg button[data-id=h3]", "aria-selected") == "true", f"{tag} Teamauswahl bleibt gemerkt")
            if case == "upcoming":
                nxt = pg.inner_text("#next")
                check("Samstag, 5. Dezember" in nxt and "09:00" in nxt, f"{tag} nächstes Spiel mit Datum und Uhrzeit")
                check("Sokol V/1" in nxt and "Auswärtsspiel" in nxt, f"{tag} Gegner und Auswärts")
                check("Florian Hedorfer-Straße 24" in nxt, f"{tag} Adresse der Halle")
                href = pg.get_attribute("#next a.route", "href") or ""
                check(href.startswith("https://www.google.com/maps/dir/?api=1&destination="), f"{tag} Route-Knopf verlinkt Google Maps")
                check("Verschoben, vorher" in nxt, f"{tag} Verschiebung markiert")
                check("in 13 Tagen" in nxt, f"{tag} Abstand in Tagen")
                up = pg.inner_text("#upcoming")
                check("Adresse noch offen" in up and "So., 28.3." in up and "10:30" in up, f"{tag} unbekannte Halle als offen, Termin nach Zeitumstellung korrekt")
            if case == "error":
                al = pg.inner_text("#alert")
                check(pg.is_visible("#alert") and "nicht gelesen werden" in al and "Letzter vollständiger Stand" in al, f"{tag} Warnung sichtbar")
                check(pg.locator("tr.us").count() == 3, f"{tag} alter Stand bleibt sichtbar")
            if case == "empty":
                pg.click("#tab-tab"); t1 = pg.inner_text("#pane-tab")
                pg.click("#tab-res"); t2 = pg.inner_text("#pane-res")
                check("Gerade kein Spiel angesetzt" in body and "Noch keine Tabelle" in t1 and "Noch keine Ergebnisse" in t2, f"{tag} leere Zustände")
            pg.context.close()

    # Quelle bzw. Datendatei gar nicht erreichbar
    pg = page_for(390, 844)
    pg.goto(f"{BASE}?data=gibtsnicht.json&now={NOW}"); pg.wait_for_load_state("networkidle")
    check(pg.is_visible("#alert") and "konnte nicht geladen werden" in pg.inner_text("#alert"), "[mobile/offline] Fehlermeldung ohne Daten")
    pg.screenshot(path=f"{shots}/mobile-nodata.png", full_page=True)
    # Knopf aktualisieren
    pg.goto(f"{BASE}?data=fx-real.json&now={NOW}"); pg.wait_for_load_state("networkidle")
    pg.click("#refresh"); pg.wait_for_timeout(500)
    check("Schon aktuell" in pg.inner_text("#stamp"), "[mobile] Jetzt aktualisieren lädt neu")
    # Cookies
    check(len(pg.context.cookies()) == 0, "keine Cookies")
    b.close()

ignored = [e for e in errors if "404" in e and "gibtsnicht" in e or "Failed to load resource" in e]
check(not external, f"keine Anfragen an fremde Server {external[:3]}")
check(not [e for e in errors if e not in ignored], f"keine JS-Fehler {[e for e in errors if e not in ignored][:3]}")
srv.shutdown()
print(f"\n{len(fails)} Fehler")
sys.exit(1 if fails else 0)
