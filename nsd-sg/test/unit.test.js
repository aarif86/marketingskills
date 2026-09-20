import './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { validateSubdomainSyntax, tenantFromHost, normalizeSubdomain } = await import('../src/lib/subdomain.js');
const { sanitizeRelativePath, isJunkPath } = await import('../src/lib/paths.js');
const { isAllowedFileName, contentTypeFor } = await import('../src/lib/mime.js');
const { injectBranding } = await import('../src/serve/branding.js');
const { injectSocial, pageTitle, pageDescription } = await import('../src/serve/social.js');
const { __test: tenant } = await import('../src/serve/tenant.js');
const { hashPassword, verifyPassword, validatePasswordStrength } = await import('../src/lib/password.js');
const { html, esc } = await import('../src/lib/html.js');

test('subdomain syntax', () => {
  assert.equal(validateSubdomainSyntax('alice'), null);
  assert.equal(validateSubdomainSyntax('my-site-2'), null);
  assert.ok(validateSubdomainSyntax('ab'));
  assert.ok(validateSubdomainSyntax('-abc'));
  assert.ok(validateSubdomainSyntax('abc-'));
  assert.ok(validateSubdomainSyntax('ab--c'));
  assert.ok(validateSubdomainSyntax('Hello'));
  assert.ok(validateSubdomainSyntax('a.b'));
  assert.ok(validateSubdomainSyntax('12345'));
  assert.ok(validateSubdomainSyntax('xn--abc'));
  assert.ok(validateSubdomainSyntax('dbs-bank'));
  assert.ok(validateSubdomainSyntax('singpass-login'));
  assert.ok(validateSubdomainSyntax('a'.repeat(41)));
  assert.equal(normalizeSubdomain('  My Site '), 'my-site');
});

test('tenant host parsing', () => {
  const base = 'nsd.test';
  const plat = ['nsd.test', 'www.nsd.test'];
  assert.equal(tenantFromHost('alice.nsd.test', base, plat), 'alice');
  assert.equal(tenantFromHost('ALICE.nsd.test:443', base, plat), 'alice');
  assert.equal(tenantFromHost('alice.nsd.test.', base, plat), 'alice');
  assert.equal(tenantFromHost('nsd.test', base, plat), null);
  assert.equal(tenantFromHost('www.nsd.test', base, plat), null);
  assert.equal(tenantFromHost('a.b.nsd.test', base, plat), null);
  assert.equal(tenantFromHost('evil.com', base, plat), null);
  assert.equal(tenantFromHost('nsd.test.evil.com', base, plat), null);
  assert.equal(tenantFromHost('', base, plat), null);
  assert.equal(tenantFromHost(undefined, base, plat), null);
});

test('path sanitization blocks traversal and hidden files', () => {
  assert.deepEqual(sanitizeRelativePath('index.html'), { ok: true, path: 'index.html' });
  assert.deepEqual(sanitizeRelativePath('css/style.css'), { ok: true, path: 'css/style.css' });
  assert.deepEqual(sanitizeRelativePath('a\\b\\c.js'), { ok: true, path: 'a/b/c.js' });
  assert.equal(sanitizeRelativePath('../etc/passwd').ok, false);
  assert.equal(sanitizeRelativePath('a/../../b.html').ok, false);
  assert.equal(sanitizeRelativePath('/abs/index.html').ok, false);
  assert.equal(sanitizeRelativePath('C:\\win\\index.html').ok, false);
  assert.equal(sanitizeRelativePath('.htaccess').ok, false);
  assert.equal(sanitizeRelativePath('dir/.env').ok, false);
  assert.equal(sanitizeRelativePath('a\u0000b.html').ok, false);
  assert.equal(sanitizeRelativePath('ünïcode.html').ok, false);
  assert.equal(sanitizeRelativePath('index.php').ok, false);
  assert.equal(sanitizeRelativePath('shell.sh').ok, false);
  assert.equal(sanitizeRelativePath('nested.zip').ok, false);
  assert.equal(sanitizeRelativePath('noext').ok, false);
  assert.equal(sanitizeRelativePath('con.html').ok, false);
  assert.equal(sanitizeRelativePath('a/'.repeat(20) + 'x.html').ok, false);
  assert.equal(sanitizeRelativePath('wrapper/index.html', { stripPrefix: 'wrapper/' }).path, 'index.html');
  assert.ok(isJunkPath('__MACOSX/._x'));
  assert.ok(isJunkPath('site/.DS_Store'));
  assert.ok(isJunkPath('node_modules/x/index.js'));
  assert.ok(!isJunkPath('images/logo.png'));
});

test('mime allowlist', () => {
  assert.ok(isAllowedFileName('a.html'));
  assert.ok(isAllowedFileName('a.woff2'));
  assert.ok(isAllowedFileName('a.svg'));
  assert.ok(!isAllowedFileName('a.php'));
  assert.ok(!isAllowedFileName('a.PHP'));
  assert.ok(!isAllowedFileName('a.exe'));
  assert.ok(!isAllowedFileName('a.html.php'));
  assert.ok(!isAllowedFileName('a.tar.gz'));
  assert.equal(contentTypeFor('x.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('x.unknown'), null);
});

test('branding injection lands before </body> and survives odd documents', () => {
  const a = injectBranding(Buffer.from('<html><body><h1>Hi</h1></body></html>')).toString();
  assert.match(a, /data-nsd="badge"[\s\S]*<\/body>/);
  assert.match(a, /MutationObserver/);
  const b = injectBranding(Buffer.from('<html><body><h1>Hi</h1></BODY  ></html>')).toString();
  assert.match(b, /badge[\s\S]*<\/BODY  >/);
  const c = injectBranding(Buffer.from('<h1>no body tag</h1>')).toString();
  assert.ok(c.startsWith('<h1>no body tag</h1><a id="n'));
  // Randomised id per render
  const id1 = a.match(/id="(n[0-9a-f]+)"/)[1];
  const id2 = injectBranding(Buffer.from('<body></body>')).toString().match(/id="(n[0-9a-f]+)"/)[1];
  assert.notEqual(id1, id2);
});

test('tenant request path parsing', () => {
  const rp = tenant.requestPath;
  assert.deepEqual(rp('/'), { parts: [], trailingSlash: true });
  assert.deepEqual(rp('/about'), { parts: ['about'], trailingSlash: false });
  assert.deepEqual(rp('/blog/?x=1'), { parts: ['blog'], trailingSlash: true });
  assert.deepEqual(rp('/a//b/../c'), null);
  assert.equal(rp('/%2e%2e/x'), null);
  assert.equal(rp('/.git/config'), null);
  assert.equal(rp('/a%00b'), null);
  assert.equal(rp('/%zz'), null);
  assert.deepEqual(rp('/img/caf%C3%A9.png'), { parts: ['img', 'café.png'], trailingSlash: false });
});

test('password hashing', async () => {
  const h = await hashPassword('correct-horse-battery');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.ok(await verifyPassword('correct-horse-battery', h));
  assert.ok(!(await verifyPassword('wrong', h)));
  assert.ok(!(await verifyPassword('x', 'garbage')));
  assert.ok(validatePasswordStrength('short'));
  assert.ok(validatePasswordStrength('aaaaaaaaaaaa'));
  assert.equal(validatePasswordStrength('a-decent-passphrase'), null);
});

test('html template escapes interpolations', () => {
  const out = html`<p>${'<script>alert(1)</script>'}</p>`.toString();
  assert.equal(out, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(esc(`"'&`), '&quot;&#39;&amp;');
  assert.equal(html`<i>${[1, 2]}</i>`.toString(), '<i>12</i>');
});

test('share tags: added from the page title/description when missing, left alone when present', () => {
  const page = '<!doctype html><html><head><title>Ramadan &amp; Quiz</title><meta name="description" content="Ten questions for P5."></head><body><p>x</p></body></html>';
  const out = injectSocial(Buffer.from(page), { url: 'https://ustaz.nsd.sg/quiz', siteName: 'ustaz.nsd.sg', image: 'https://nsd.sg/assets/social-site.png' }).toString();
  assert.equal(pageTitle(page), 'Ramadan & Quiz');
  assert.equal(pageDescription(page), 'Ten questions for P5.');
  assert.match(out, /<head><meta property="og:type" content="website">/);
  assert.match(out, /og:title" content="Ramadan &amp; Quiz"/);
  assert.match(out, /og:description" content="Ten questions for P5\."/);
  assert.match(out, /og:url" content="https:\/\/ustaz\.nsd\.sg\/quiz"/);
  assert.match(out, /og:image" content="https:\/\/nsd\.sg\/assets\/social-site\.png"/);
  assert.match(out, /twitter:card" content="summary_large_image"/);
  const noDesc = '<html><head><title>T</title></head><body><p>This first paragraph is long enough to serve as a description.</p></body></html>';
  assert.match(injectSocial(Buffer.from(noDesc), { siteName: 'a.nsd.sg' }).toString(), /og:description" content="This first paragraph is long enough/);
  const own = '<html><head><meta property="og:title" content="Mine"><meta property="og:image" content="https://x/y.png"></head><body></body></html>';
  assert.equal(injectSocial(Buffer.from(own), { siteName: 'a.nsd.sg', image: 'https://nsd.sg/i.png' }).toString(), own);
  const ownImage = '<html><head><title>T</title><meta property="og:image" content="https://x/y.png"></head><body></body></html>';
  const o2 = injectSocial(Buffer.from(ownImage), { siteName: 'a.nsd.sg', image: 'https://nsd.sg/i.png' }).toString();
  assert.doesNotMatch(o2, /nsd\.sg\/i\.png/, 'never overrides a page that brings its own image');
  assert.match(o2, /og:title" content="T"/);
  const plain = injectSocial(Buffer.from('<html><head><title>T</title></head><body></body></html>'), { siteName: 'a.nsd.sg', image: 'https://nsd.sg/i.png', plain: true }).toString();
  assert.doesNotMatch(plain, /nsd\.sg\/i\.png|NSD\.SG|put online/, 'paid plans: no NSD.SG image or wording');
  assert.match(plain, /og:description" content="A page on a\.nsd\.sg\."/);
  assert.match(plain, /twitter:card" content="summary"/);
});
