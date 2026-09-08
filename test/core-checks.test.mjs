import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { checkReachability, checkRobots, checkSeo, checkSecurityHeaders } from '../scripts/core-checks.mjs';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('core checks pass for a healthy fixture page', async () => {
  await withServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private\n');
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html',
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin'
    });
    res.end('<!doctype html><html><head><title>Testseite</title><link rel="canonical" href="https://halteverbot123.de/"><meta name="robots" content="index,follow"></head><body><h1>Test</h1></body></html>');
  }, async (baseUrl) => {
    const reachability = await checkReachability(baseUrl, ['/']);
    assert.equal(reachability[0].status, 'pass');

    const seo = await checkSeo(baseUrl, ['/'], { forbidNoindex: true, expectedCanonicalHost: 'halteverbot123.de' });
    assert.equal(seo[0].status, 'pass');

    const robots = await checkRobots(baseUrl, true);
    assert.equal(robots[0].status, 'pass');

    const headers = await checkSecurityHeaders(baseUrl);
    assert.equal(headers[0].status, 'pass');
  });
});

test('SEO check fails on noindex and a staging canonical', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>Test</title><link rel="canonical" href="https://storyblok.halteverbot123.de/"><meta name="robots" content="noindex"></head><body><h1>Test</h1></body></html>');
  }, async (baseUrl) => {
    const seo = await checkSeo(baseUrl, ['/'], { forbidNoindex: true, expectedCanonicalHost: 'halteverbot123.de' });
    assert.equal(seo[0].status, 'fail');
    assert.match(seo[0].message, /noindex/);
    assert.match(seo[0].message, /Canonical/);
  });
});

test('robots check fails on a global production block', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /\n');
  }, async (baseUrl) => {
    const robots = await checkRobots(baseUrl, true);
    assert.equal(robots[0].status, 'fail');
  });
});
