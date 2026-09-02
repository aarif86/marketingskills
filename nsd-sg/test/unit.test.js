import './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { validateSubdomainSyntax, tenantFromHost, normalizeSubdomain } = await import('../src/lib/subdomain.js');
const { sanitizeRelativePath, isJunkPath } = await import('../src/lib/paths.js');
const { isAllowedFileName, contentTypeFor } = await import('../src/lib/mime.js');
const { injectBranding } = await import('../src/serve/branding.js');
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
