import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildZip } from './helpers/zipwriter.js';
import { dataDir, cleanup } from './helpers/env.js';

const { extractZip, ZipError } = await import('../src/storage/zip.js');

const limits = { maxFileBytes: 200 * 1024, maxTotalBytes: 1024 * 1024 };
let n = 0;
function fixture(entries) {
  const dir = path.join(dataDir, `ziptest-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, 'in.zip');
  fs.writeFileSync(zipPath, buildZip(entries));
  const dest = path.join(dir, 'out');
  fs.mkdirSync(dest);
  return { zipPath, dest };
}

after(cleanup);

test('extracts a normal site and strips a single wrapper folder', async () => {
  const { zipPath, dest } = fixture([
    { name: 'my-site/index.html', data: '<h1>hi</h1>' },
    { name: 'my-site/css/style.css', data: 'body{}' },
    { name: 'my-site/__MACOSX/._index.html', data: 'junk' },
    { name: 'my-site/.DS_Store', data: 'junk' },
  ]);
  const r = await extractZip(zipPath, dest, limits);
  assert.deepEqual(r.written.map((w) => w.path).sort(), ['css/style.css', 'index.html']);
  assert.equal(r.strippedPrefix, 'my-site/');
  assert.equal(r.skipped.length, 2);
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), '<h1>hi</h1>');
});

test('archives with traversal or absolute entry names are rejected outright', async () => {
  for (const bad of ['../../escape.html', '/etc/cron.d/x.html', 'sub/../index2.html']) {
    const { zipPath, dest } = fixture([{ name: 'index.html', data: 'ok' }, { name: bad, data: 'bad' }]);
    await assert.rejects(() => extractZip(zipPath, dest, limits), (e) => e instanceof ZipError);
    assert.ok(!fs.existsSync(path.join(dataDir, 'escape.html')));
    assert.ok(!fs.existsSync(path.join(dest, 'index.html')) || fs.readdirSync(dest).length <= 1);
  }
});

test('hidden and executable entries are dropped, the rest is kept', async () => {
  const { zipPath, dest } = fixture([
    { name: 'index.html', data: 'ok' },
    { name: 'shell.php', data: '<?php' },
    { name: '.htaccess', data: 'bad' },
    { name: 'bin/run.sh', data: '#!/bin/sh' },
  ]);
  const r = await extractZip(zipPath, dest, limits);
  assert.deepEqual(r.written.map((w) => w.path), ['index.html']);
  assert.equal(r.rejected.length, 3);
  assert.ok(!fs.existsSync(path.join(dest, 'shell.php')));
  assert.ok(!fs.existsSync(path.join(dest, '.htaccess')));
});

test('symlink entries are refused', async () => {
  const { zipPath, dest } = fixture([
    { name: 'index.html', data: 'ok' },
    { name: 'link.html', data: '/etc/passwd', symlink: true },
  ]);
  const r = await extractZip(zipPath, dest, limits);
  assert.ok(r.rejected.some((x) => x.reason.includes('symlink')));
  assert.ok(!fs.existsSync(path.join(dest, 'link.html')));
});

test('zip bomb: entry that inflates beyond its declared size is aborted', async () => {
  const big = Buffer.alloc(150 * 1024, 'a');
  const { zipPath, dest } = fixture([{ name: 'index.html', data: big, lieUncompressed: 10 }]);
  await assert.rejects(() => extractZip(zipPath, dest, limits), (e) => e instanceof ZipError);
  assert.ok(!fs.existsSync(path.join(dest, 'index.html')) || fs.statSync(path.join(dest, 'index.html')).size <= 16384 * 2);
});

test('per-file and total limits are enforced from headers', async () => {
  const big = Buffer.alloc(300 * 1024, 'b');
  const { zipPath, dest } = fixture([{ name: 'index.html', data: 'ok' }, { name: 'huge.png', data: big }]);
  const r = await extractZip(zipPath, dest, limits);
  assert.ok(r.rejected.some((x) => x.path === 'huge.png'));
  const many = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.alloc(190 * 1024, 'c') }));
  const f2 = fixture([{ name: 'index.html', data: 'ok' }, ...many]);
  await assert.rejects(() => extractZip(f2.zipPath, f2.dest, { ...limits, maxTotalBytes: 500 * 1024 }), /quota/);
});

test('entry count cap', async () => {
  const entries = Array.from({ length: 60 }, (_, i) => ({ name: `p${i}.html`, data: 'x' }));
  const { zipPath, dest } = fixture(entries);
  await assert.rejects(() => extractZip(zipPath, dest, limits), /entries/);
});

test('empty or all-junk archives fail with a clear message', async () => {
  const { zipPath, dest } = fixture([{ name: 'evil.php', data: 'x' }]);
  await assert.rejects(() => extractZip(zipPath, dest, limits), /No usable files/);
});
