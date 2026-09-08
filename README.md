# Relaunch Check

Deterministische Pre-Launch- und Post-Launch-Prüfungen für den Relaunch von produktiven Websites auf die neue Storyblok-Website.

## Ziel

Das Repo ersetzt subjektive Aussagen wie „sieht gut aus“ durch wiederholbare PASS/WARN/FAIL-Prüfungen. Ein lokales Dashboard startet allowlistete Checks und zeigt die Ergebnisse ohne Terminal-Auswertung.

## Start

Voraussetzung: Node.js 22 oder neuer.

```bash
npm run dashboard
```

Danach im Browser öffnen:

```text
http://127.0.0.1:4173
```

Der Server bindet absichtlich nur an `127.0.0.1`. Es gibt keinen Endpoint für freie Shell-Befehle. Das Dashboard kann ausschließlich `baseline`, `pre` und `post` starten.

## Direkt verfügbare Checks

Ohne zusätzliche Dienste:

- Erreichbarkeit kritischer URLs
- Title, H1, Canonical und Robots-Metadaten auf kritischen Seiten
- Production-Check auf `noindex`
- Production-Check auf Staging-/localhost-Leaks im HTML
- `robots.txt`
- Sitemap-Erreichbarkeit
- HTTP → HTTPS
- Basale Security Header
- Redirect-Mapping aus `config/url-mapping.csv`
- Baseline-Snapshot der aktuellen Production

## Befehle

```bash
npm run relaunch:baseline
npm run relaunch:pre
npm run relaunch:post
npm test
```

Die Befehle liefern Exit Code `0`, wenn kein FAIL vorliegt, sonst Exit Code `1`. WARN blockiert den Lauf nicht.

## Konfiguration

`config/relaunch.config.json`

Dort stehen Production-/Staging-Domain, kritische Pfade und harte Production-Regeln.

`config/url-mapping.csv`

Hier muss vor dem finalen Relaunch jede bewusst geänderte Legacy-URL mit ihrem erwarteten Ziel stehen.

## Noch anzubindende Tools

| Tool/Zugang | Zweck | Pflicht? |
|---|---|---|
| Playwright | Echte Browserflows: Formulare, Rechner, Consent, Tracking, Browser-Matrix | Ja für belastbare E2E-Abnahme |
| ERP API/Testzugang | Prüfen, ob Website-Daten exakt im ERP ankommen | Ja für E2E bis ERP |
| Screaming Frog | Vollständiger Crawl Alt vs. Neu über tausende URLs | Stark empfohlen; Lizenz nötig bei >500 URLs |
| Lighthouse CI | Performance-Budgets und Regressionen | Empfohlen |
| `@axe-core/playwright` | Automatisierte Accessibility-Prüfungen | Empfohlen |
| OWASP ZAP Baseline | Passive Sicherheitsprüfung | Empfohlen |
| testssl.sh | TLS-/Zertifikats-Detailprüfung | Empfohlen |
| Google Search Console API | Post-Launch Monitoring von Google-Verarbeitung und Sitemaps | Empfohlen |

## Was weiterhin manuell bleibt

- Fachliche Qualität und Vollständigkeit von Texten
- Visuelle Abnahme wichtiger Templates
- Rechtliche Prüfung von Datenschutz/AGB/BFSG
- Sinnhaftigkeit von Alt-Texten und UX-Texten
- Go/No-Go-Entscheidung bei fachlichen Ausnahmen

## Sicherheitsmodell des Dashboards

Das Dashboard ist ein lokales Operations-Werkzeug. Es darf nicht ungeprüft öffentlich auf einen Server gestellt werden. Für einen späteren Remote-Betrieb wären mindestens Authentifizierung, Autorisierung, CSRF-Schutz, Rate Limits und eine weiterhin harte Allowlist der ausführbaren Checks erforderlich.

## Nächste Implementierungsstufen

1. Kritische URLs und Redirect-Mapping vollständig pflegen.
2. Playwright installieren und HVZ-/VS-/VZP-Flows abbilden.
3. ERP-Testverifikation ergänzen.
4. Tracking/Consent mit Browser-Network-Assertions ergänzen.
5. Lighthouse/axe/ZAP/testssl anbinden.
6. Post-Launch Search-Console-Monitoring ergänzen.
