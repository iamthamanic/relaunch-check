import fs from 'node:fs/promises';
import path from 'node:path';

const REQUEST_TIMEOUT_MS = 15000;

function result(id, name, status, message, details = {}) {
  return { id, name, status, message, details };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: options.redirect ?? 'follow',
      headers: { 'user-agent': 'RelaunchCheck/0.1 (+https://github.com/iamthamanic/relaunch-check)' },
      signal: controller.signal,
      ...options
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractTag(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function extractMetadata(html) {
  const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = extractTag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, '').trim();
  const canonical = extractTag(html, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)
    || extractTag(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
  const robots = extractTag(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || extractTag(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']robots["'][^>]*>/i);
  return { title, h1, canonical, robots };
}

function hasNoindex(metadata, response) {
  const htmlNoindex = metadata.robots.toLowerCase().split(',').map((v) => v.trim()).includes('noindex')
    || metadata.robots.toLowerCase().includes('none');
  const header = response.headers.get('x-robots-tag') ?? '';
  return htmlNoindex || header.toLowerCase().includes('noindex');
}

export async function checkReachability(baseUrl, criticalPaths) {
  const checks = [];
  for (const pathname of criticalPaths) {
    const url = new URL(pathname, baseUrl).toString();
    try {
      const response = await fetchWithTimeout(url);
      checks.push(result(
        `HTTP-${pathname}`,
        `Erreichbarkeit ${pathname}`,
        response.ok ? 'pass' : 'fail',
        response.ok ? `${response.status} ${response.statusText}` : `Unerwarteter HTTP-Status ${response.status}`,
        { url, status: response.status }
      ));
    } catch (error) {
      checks.push(result(`HTTP-${pathname}`, `Erreichbarkeit ${pathname}`, 'fail', String(error), { url }));
    }
  }
  return checks;
}

export async function checkSeo(baseUrl, criticalPaths, options = {}) {
  const checks = [];
  for (const pathname of criticalPaths) {
    const url = new URL(pathname, baseUrl).toString();
    try {
      const response = await fetchWithTimeout(url);
      const html = await response.text();
      const metadata = extractMetadata(html);
      const noindex = hasNoindex(metadata, response);
      const failures = [];
      if (!metadata.title) failures.push('Title fehlt');
      if (!metadata.h1) failures.push('H1 fehlt');
      if (!metadata.canonical) failures.push('Canonical fehlt');
      if (options.forbidNoindex && noindex) failures.push('noindex gefunden');
      if (options.expectedCanonicalHost && metadata.canonical) {
        try {
          if (new URL(metadata.canonical, url).hostname !== options.expectedCanonicalHost) {
            failures.push(`Canonical zeigt nicht auf ${options.expectedCanonicalHost}`);
          }
        } catch {
          failures.push('Canonical ist keine gültige URL');
        }
      }
      for (const forbidden of options.forbiddenHtmlTerms ?? []) {
        if (html.includes(forbidden)) failures.push(`Verbotener Production-Begriff gefunden: ${forbidden}`);
      }
      checks.push(result(
        `SEO-${pathname}`,
        `SEO-Grunddaten ${pathname}`,
        failures.length === 0 ? 'pass' : 'fail',
        failures.length === 0 ? 'Title, H1, Canonical und Robots sind plausibel.' : failures.join('; '),
        { url, status: response.status, ...metadata, noindex }
      ));
    } catch (error) {
      checks.push(result(`SEO-${pathname}`, `SEO-Grunddaten ${pathname}`, 'fail', String(error), { url }));
    }
  }
  return checks;
}

export async function checkRobots(baseUrl, forbidGlobalBlock) {
  const url = new URL('/robots.txt', baseUrl).toString();
  try {
    const response = await fetchWithTimeout(url);
    const body = await response.text();
    const globalBlock = /User-agent:\s*\*\s*[\r\n]+\s*Disallow:\s*\/\s*(?:[\r\n]|$)/i.test(body);
    const fail = !response.ok || (forbidGlobalBlock && globalBlock);
    return [result(
      'ROBOTS-001',
      'robots.txt',
      fail ? 'fail' : 'pass',
      !response.ok ? `robots.txt liefert HTTP ${response.status}` : globalBlock && forbidGlobalBlock ? 'robots.txt blockiert die komplette Production.' : 'robots.txt ist erreichbar und enthält keine verbotene globale Sperre.',
      { url, status: response.status, globalBlock }
    )];
  } catch (error) {
    return [result('ROBOTS-001', 'robots.txt', 'fail', String(error), { url })];
  }
}

export async function checkSitemaps(baseUrl, sitemapPaths) {
  const checks = [];
  let found = false;
  for (const sitemapPath of sitemapPaths) {
    const url = new URL(sitemapPath, baseUrl).toString();
    try {
      const response = await fetchWithTimeout(url);
      if (response.ok) found = true;
      checks.push(result(
        `SITEMAP-${sitemapPath}`,
        `Sitemap ${sitemapPath}`,
        response.ok ? 'pass' : 'warn',
        response.ok ? `Sitemap erreichbar (${response.status}).` : `Nicht gefunden (${response.status}).`,
        { url, status: response.status }
      ));
    } catch (error) {
      checks.push(result(`SITEMAP-${sitemapPath}`, `Sitemap ${sitemapPath}`, 'warn', String(error), { url }));
    }
  }
  if (!found) checks.push(result('SITEMAP-NONE', 'Mindestens eine Sitemap', 'fail', 'Keine konfigurierte Sitemap ist erreichbar.'));
  return checks;
}

export async function checkSecurityHeaders(baseUrl) {
  const url = new URL('/', baseUrl).toString();
  try {
    const response = await fetchWithTimeout(url);
    const required = [
      ['strict-transport-security', 'HSTS'],
      ['x-content-type-options', 'X-Content-Type-Options'],
      ['referrer-policy', 'Referrer-Policy']
    ];
    const missing = required.filter(([header]) => !response.headers.get(header)).map(([, label]) => label);
    return [result(
      'SEC-HEADERS',
      'Security Header Baseline',
      missing.length === 0 ? 'pass' : 'warn',
      missing.length === 0 ? 'Basale Security Header vorhanden.' : `Fehlende Header: ${missing.join(', ')}`,
      { url, missing }
    )];
  } catch (error) {
    return [result('SEC-HEADERS', 'Security Header Baseline', 'fail', String(error), { url })];
  }
}

export async function checkHttpRedirect(baseUrl) {
  const httpsUrl = new URL(baseUrl);
  const httpUrl = `http://${httpsUrl.host}${httpsUrl.pathname}`;
  try {
    const response = await fetchWithTimeout(httpUrl, { redirect: 'manual' });
    const location = response.headers.get('location') ?? '';
    const permanentOrTemporaryRedirect = response.status >= 300 && response.status < 400;
    const redirectsToHttps = location.startsWith('https://');
    return [result(
      'SEC-HTTPS',
      'HTTP → HTTPS',
      permanentOrTemporaryRedirect && redirectsToHttps ? 'pass' : 'fail',
      permanentOrTemporaryRedirect && redirectsToHttps ? `HTTP leitet auf HTTPS (${response.status}).` : `Erwartete HTTPS-Weiterleitung fehlt. Status ${response.status}, Location ${location || '—'}.`,
      { httpUrl, status: response.status, location }
    )];
  } catch (error) {
    return [result('SEC-HTTPS', 'HTTP → HTTPS', 'fail', String(error), { httpUrl })];
  }
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(current.trim()); current = ''; }
    else current += char;
  }
  values.push(current.trim());
  return values.map((value) => value.replace(/^"|"$/g, ''));
}

export async function checkRedirectMapping(csvPath) {
  const text = await fs.readFile(csvPath, 'utf8');
  const rows = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (rows.length <= 1) {
    return [result('REDIRECT-MAP', 'Redirect-Mapping', 'warn', 'Noch keine Redirect-Zeilen konfiguriert. Falls URLs geändert werden, muss config/url-mapping.csv befüllt werden.')];
  }
  const checks = [];
  for (const row of rows.slice(1)) {
    const [oldUrl, newUrl, expectedRaw] = parseCsvLine(row);
    const expected = Number(expectedRaw || 301);
    try {
      const response = await fetchWithTimeout(oldUrl, { redirect: 'manual' });
      const locationRaw = response.headers.get('location') ?? '';
      const location = locationRaw ? new URL(locationRaw, oldUrl).toString() : '';
      const expectedTarget = new URL(newUrl).toString();
      const statusMatches = response.status === expected || (expected === 301 && response.status === 308);
      const targetMatches = location === expectedTarget;
      let targetStatus = null;
      if (targetMatches) {
        const targetResponse = await fetchWithTimeout(expectedTarget);
        targetStatus = targetResponse.status;
      }
      const pass = statusMatches && targetMatches && targetStatus === 200;
      checks.push(result(
        `REDIRECT-${oldUrl}`,
        `Redirect ${oldUrl}`,
        pass ? 'pass' : 'fail',
        pass ? 'Redirect-Ziel und Zielstatus sind korrekt.' : `Status ${response.status}, Ziel ${location || '—'}, Zielstatus ${targetStatus ?? 'nicht geprüft'}`,
        { oldUrl, expectedTarget, actualStatus: response.status, actualLocation: location, targetStatus }
      ));
    } catch (error) {
      checks.push(result(`REDIRECT-${oldUrl}`, `Redirect ${oldUrl}`, 'fail', String(error), { oldUrl, newUrl }));
    }
  }
  return checks;
}

export async function snapshotPages(baseUrl, criticalPaths) {
  const pages = [];
  for (const pathname of criticalPaths) {
    const url = new URL(pathname, baseUrl).toString();
    try {
      const response = await fetchWithTimeout(url);
      const html = await response.text();
      pages.push({ url, status: response.status, metadata: extractMetadata(html), capturedAt: new Date().toISOString() });
    } catch (error) {
      pages.push({ url, error: String(error), capturedAt: new Date().toISOString() });
    }
  }
  return pages;
}

export function configPath(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}
