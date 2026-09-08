import fs from 'node:fs/promises';
import {
  checkHttpRedirect,
  checkReachability,
  checkRedirectMapping,
  checkRobots,
  checkSecurityHeaders,
  checkSeo,
  checkSitemaps,
  configPath,
  snapshotPages
} from './core-checks.mjs';

const mode = process.argv[2];
const allowedModes = new Set(['baseline', 'pre', 'post']);
if (!allowedModes.has(mode)) {
  console.error('Usage: node scripts/runner.mjs baseline|pre|post');
  process.exit(2);
}

const config = JSON.parse(await fs.readFile(configPath('config/relaunch.config.json'), 'utf8'));
const startedAt = new Date().toISOString();

function emit(type, payload) {
  console.log(`RC_EVENT ${JSON.stringify({ type, ...payload })}`);
}

async function runCheck(label, fn) {
  emit('progress', { label, state: 'running' });
  const results = await fn();
  for (const check of results) emit('check', { check });
  emit('progress', { label, state: 'done' });
  return results;
}

async function main() {
  emit('run', { mode, state: 'running', startedAt });

  if (mode === 'baseline') {
    const pages = await snapshotPages(config.productionBaseUrl, config.criticalPaths);
    await fs.mkdir(configPath('baseline'), { recursive: true });
    const file = configPath(`baseline/baseline-${startedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`);
    await fs.writeFile(file, JSON.stringify({ startedAt, baseUrl: config.productionBaseUrl, pages }, null, 2));
    const failures = pages.filter((page) => page.error || page.status >= 400);
    const checks = [{
      id: 'BASELINE-SNAPSHOT',
      name: 'Baseline-Snapshot',
      status: failures.length === 0 ? 'pass' : 'fail',
      message: failures.length === 0 ? `${pages.length} kritische Seiten gespeichert.` : `${failures.length} Seiten konnten nicht sauber erfasst werden.`,
      details: { file, pages: pages.length, failures: failures.length }
    }];
    for (const check of checks) emit('check', { check });
    return checks;
  }

  const isPost = mode === 'post';
  const baseUrl = isPost ? config.productionBaseUrl : config.stagingBaseUrl;
  const seoOptions = isPost
    ? {
        forbidNoindex: config.productionRules.forbidNoindex,
        forbiddenHtmlTerms: config.productionRules.forbiddenHtmlTerms,
        expectedCanonicalHost: new URL(config.productionBaseUrl).hostname
      }
    : {
        forbidNoindex: false,
        expectedCanonicalHost: config.stagingRules.expectedCanonicalHost
      };

  const results = [];
  results.push(...await runCheck('Erreichbarkeit', () => checkReachability(baseUrl, config.criticalPaths)));
  results.push(...await runCheck('SEO-Grunddaten', () => checkSeo(baseUrl, config.criticalPaths, seoOptions)));
  results.push(...await runCheck('robots.txt', () => checkRobots(baseUrl, isPost && config.productionRules.forbidGlobalRobotsBlock)));
  results.push(...await runCheck('Sitemaps', () => checkSitemaps(baseUrl, config.sitemapPaths)));
  results.push(...await runCheck('HTTP → HTTPS', () => checkHttpRedirect(baseUrl)));
  results.push(...await runCheck('Security Header', () => checkSecurityHeaders(baseUrl)));
  if (isPost) results.push(...await runCheck('Redirect-Mapping', () => checkRedirectMapping(configPath('config/url-mapping.csv'))));
  return results;
}

const checks = await main();
const summary = {
  mode,
  startedAt,
  finishedAt: new Date().toISOString(),
  total: checks.length,
  pass: checks.filter((item) => item.status === 'pass').length,
  warn: checks.filter((item) => item.status === 'warn').length,
  fail: checks.filter((item) => item.status === 'fail').length,
  checks
};

await fs.mkdir(configPath('reports'), { recursive: true });
await fs.writeFile(configPath(`reports/${mode}-latest.json`), JSON.stringify(summary, null, 2));
emit('summary', { summary });
process.exit(summary.fail > 0 ? 1 : 0);
