// Signup, login, logout, email verification, password reset.
import { config, platformUrl } from '../../config.js';
import { limiter } from '../../lib/ratelimit.js';
import { audit } from '../../lib/audit.js';
import { validatePasswordStrength } from '../../lib/password.js';
import { sendMail } from '../../lib/mailer.js';
import { normalizeSubdomain, blockedTermIn } from '../../lib/subdomain.js';
import { watchdog } from '../../lib/audit.js';
import {
  normalizeEmail, validateEmail, findUserByEmail, createUser, authenticate, createSession, destroySession,
  issueToken, consumeToken, markEmailVerified, changePassword,
} from '../../services/users.js';
import { createSite, subdomainUnavailableReason } from '../../services/sites.js';
import { getPlan } from '../../services/plans.js';
import { marketingLayout } from '../views/layout.js';
import { signupPage, loginPage, forgotPage, resetPage } from '../views/auth.js';
import { csrfTokenFor, setSessionCookie, clearSessionCookie, readFlash, flash } from '../middleware.js';

function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/dashboard';
  return next.slice(0, 200);
}

export async function registerAuthRoutes(app) {
  const render = (req, reply, title, body) =>
    reply.type('text/html; charset=utf-8').send(marketingLayout({ title, body, user: req.user, flash: readFlash(req, reply) }));

  app.get('/signup', async (req, reply) => {
    if (req.user) return reply.redirect('/dashboard');
    const plan = getPlan(String(req.query.plan ?? ''));
    return render(req, reply, 'Create your account', signupPage({ csrf: csrfTokenFor(req), name: normalizeSubdomain(req.query.name ?? ''), plan: plan?.is_public ? plan : null, values: {} }));
  });

  app.post('/signup', { preHandler: limiter('signup') }, async (req, reply) => {
    const b = req.body ?? {};
    const email = normalizeEmail(b.email);
    const name = String(b.name ?? '').trim().slice(0, 80);
    const password = String(b.password ?? '');
    const subdomain = normalizeSubdomain(b.subdomain ?? '');
    const errors = [];
    const e1 = validateEmail(email); if (e1) errors.push(e1);
    const e2 = validatePasswordStrength(password); if (e2) errors.push(e2);
    if (subdomain) { const e3 = subdomainUnavailableReason(subdomain); if (e3) errors.push(`Site name: ${e3}`); const t = blockedTermIn(subdomain); if (t) watchdog(req, subdomain, t); }
    if (!b.agree) errors.push('Please accept the Terms of Service.');
    if (!errors.length && findUserByEmail(email)) errors.push('An account with that email already exists. Try logging in.');
    if (errors.length) {
      return render(req, reply, 'Create your account', signupPage({ csrf: csrfTokenFor(req), name: subdomain, plan: null, values: { email, name }, errors }));
    }
    const user = await createUser({ email, password, name });
    audit({ req, actor: user, action: 'auth.signup', targetType: 'user', targetId: user.id });
    let siteMsg = '';
    if (subdomain) {
      const r = createSite({ user, subdomain, title: name ? `${name}'s site` : subdomain });
      if (r.ok) {
        audit({ req, actor: user, action: 'site.create', targetType: 'site', targetId: r.site.id, details: { subdomain } });
        siteMsg = ` ${subdomain}.${config.baseDomain} is yours — upload your files to go live.`;
      }
    }
    const token = issueToken(user.id, 'verify_email', 3 * 86400);
    sendMail({
      to: email,
      subject: 'Confirm your NSD.SG email',
      text: `Welcome to NSD.SG. Confirm your email: ${platformUrl(`/verify?token=${token}`)}\n\nThis link expires in 3 days.`,
    }).catch((err) => req.log.error({ err }, 'verification mail failed'));
    const sessionToken = createSession({ userId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] ?? '' });
    setSessionCookie(reply, sessionToken);
    flash(reply, 'success', `Welcome to NSD.SG!${siteMsg} We have emailed you a confirmation link.`);
    return reply.redirect('/dashboard');
  });

  app.get('/login', async (req, reply) => {
    if (req.user) return reply.redirect(safeNext(req.query.next));
    return render(req, reply, 'Log in', loginPage({ csrf: csrfTokenFor(req), next: safeNext(req.query.next), email: '' }));
  });

  app.post('/login', { preHandler: limiter('login') }, async (req, reply) => {
    const b = req.body ?? {};
    const email = normalizeEmail(b.email);
    const next = safeNext(b.next);
    const r = await authenticate(email, String(b.password ?? ''));
    if (!r.ok) {
      audit({ req, action: 'auth.login_failed', targetType: 'user', targetId: email, details: { reason: r.reason }, severity: r.reason === 'locked' ? 'warn' : 'info' });
      const msg = r.reason === 'locked' ? 'Too many failed attempts. This account is locked for 15 minutes.'
        : r.reason === 'disabled' ? 'This account has been disabled. Contact support.'
        : 'Email or password is incorrect.';
      return render(req, reply, 'Log in', loginPage({ csrf: csrfTokenFor(req), next, email, error: msg }));
    }
    if (r.user.status === 'suspended') {
      return render(req, reply, 'Log in', loginPage({ csrf: csrfTokenFor(req), next, email, error: 'This account is suspended. Check your email or contact support.' }));
    }
    const token = createSession({ userId: r.user.id, ip: req.ip, userAgent: req.headers['user-agent'] ?? '' });
    setSessionCookie(reply, token);
    audit({ req, actor: r.user, action: 'auth.login', targetType: 'user', targetId: r.user.id });
    return reply.redirect(next);
  });

  app.post('/logout', async (req, reply) => {
    destroySession(req.sessionToken);
    clearSessionCookie(reply);
    if (req.user) audit({ req, action: 'auth.logout', targetType: 'user', targetId: req.user.id });
    return reply.redirect('/');
  });

  app.get('/verify', async (req, reply) => {
    const user = consumeToken(String(req.query.token ?? ''), 'verify_email');
    if (!user) { flash(reply, 'error', 'That confirmation link is invalid or has expired.'); return reply.redirect('/login'); }
    markEmailVerified(user.id);
    audit({ req, actor: user, action: 'auth.email_verified', targetType: 'user', targetId: user.id });
    flash(reply, 'success', 'Email confirmed. Thank you!');
    return reply.redirect(req.user ? '/dashboard' : '/login');
  });

  app.post('/resend-verification', { preHandler: limiter('passwordReset') }, async (req, reply) => {
    if (!req.user) return reply.redirect('/login');
    if (!req.user.email_verified_at) {
      const token = issueToken(req.user.id, 'verify_email', 3 * 86400);
      await sendMail({ to: req.user.email, subject: 'Confirm your NSD.SG email', text: `Confirm your email: ${platformUrl(`/verify?token=${token}`)}` }).catch(() => {});
    }
    flash(reply, 'success', 'Confirmation email sent.');
    return reply.redirect('/account');
  });

  app.get('/forgot', async (req, reply) => render(req, reply, 'Reset password', forgotPage({ csrf: csrfTokenFor(req) })));

  app.post('/forgot', { preHandler: limiter('passwordReset') }, async (req, reply) => {
    const email = normalizeEmail(req.body?.email);
    const user = findUserByEmail(email);
    if (user && user.status !== 'disabled') {
      const token = issueToken(user.id, 'reset_password', 3600);
      await sendMail({ to: email, subject: 'Reset your NSD.SG password', text: `Reset your password: ${platformUrl(`/reset?token=${token}`)}\n\nThis link expires in 1 hour. If you did not ask for this, ignore this email.` }).catch(() => {});
      audit({ req, actor: user, action: 'auth.reset_requested', targetType: 'user', targetId: user.id });
    }
    flash(reply, 'success', 'If that email has an account, a reset link is on its way.');
    return reply.redirect('/forgot');
  });

  app.get('/reset', async (req, reply) => render(req, reply, 'Choose a new password', resetPage({ csrf: csrfTokenFor(req), token: String(req.query.token ?? '') })));

  app.post('/reset', { preHandler: limiter('passwordReset') }, async (req, reply) => {
    const b = req.body ?? {};
    const err = validatePasswordStrength(String(b.password ?? ''));
    if (err) return render(req, reply, 'Choose a new password', resetPage({ csrf: csrfTokenFor(req), token: String(b.token ?? ''), error: err }));
    const user = consumeToken(String(b.token ?? ''), 'reset_password');
    if (!user) { flash(reply, 'error', 'That reset link is invalid or has expired.'); return reply.redirect('/forgot'); }
    await changePassword(user.id, String(b.password));
    markEmailVerified(user.id);
    audit({ req, actor: user, action: 'auth.password_reset', targetType: 'user', targetId: user.id, severity: 'warn' });
    flash(reply, 'success', 'Password changed. Please log in.');
    return reply.redirect('/login');
  });
}
