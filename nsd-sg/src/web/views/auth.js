import { html, raw } from '../../lib/html.js';
import { config } from '../../config.js';

const googleButton = (href, label) => html`<div class="oauth"><a class="btn btn-ghost btn-lg btn-google" href="${href}" data-google-start rel="nofollow">${raw(GOOGLE_G)} ${label}</a><div class="or"><span>or</span></div></div>`;
const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.3 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.4 0-11.8-4.1-13.7-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

const googleQuery = (params) => { const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString(); return q ? `?${q}` : ''; };
const errorList = (errors) => (errors?.length ? html`<div class="flash flash-error"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : '');

export function signupPage({ csrf, name, plan, values, errors, googleEnabled = false, preview = '' }) {
  return html`<section class="section auth"><div class="container narrow">
  <h1>${preview ? 'Keep your page. Pick its address.' : 'Create your account'}</h1>
  <p class="muted">${preview ? html`Choose a name below. When you sign up, your test page moves to <strong>thatname.${config.baseDomain}</strong> and stays online.` : plan ? html`You picked the <strong>${plan.name}</strong> plan. Everyone starts on Free; you can upgrade from inside once you are in.` : 'Free for 30 days, no card. Your page can be online a minute from now.'}</p>
  ${errorList(errors)}
  ${googleEnabled ? googleButton(`/auth/google${googleQuery({ name, preview })}`, 'Continue with Google') : ''}
  <form method="post" action="/signup" class="form" autocomplete="on">
    <input type="hidden" name="_csrf" value="${csrf}">
    ${preview ? html`<input type="hidden" name="preview" value="${preview}">` : ''}
    <label>Your web address ${preview ? '' : html`<span class="muted">(you can pick it later too)</span>`}
      <div class="domain-input"><input name="subdomain" value="${name}" maxlength="40" placeholder="yourname" autocomplete="off" spellcheck="false" data-availability ${preview ? 'required' : ''}><span>.${config.baseDomain}</span></div>
      <small data-availability-msg>Letters, numbers and hyphens. This becomes the link you send people.</small></label>
    <label>Your name <input name="name" value="${values.name ?? ''}" maxlength="80" autocomplete="name"></label>
    <label>Email <input type="email" name="email" value="${values.email ?? ''}" required maxlength="254" autocomplete="email"></label>
    <label>Choose a password <input type="password" name="password" required minlength="10" maxlength="200" autocomplete="new-password"><small>At least 10 characters. A short sentence works well.</small></label>
    <label class="check"><input type="checkbox" name="agree" value="1" required> I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy policy</a>.</label>
    <button class="btn btn-primary btn-lg" type="submit">${preview ? 'Create account and keep my page' : 'Create account'}</button>
  </form>
  <p class="muted">Already have an account? <a href="/login">Log in</a></p>
</div></section>`.toString();
}

export function loginPage({ csrf, next, email, error, googleEnabled = false }) {
  return html`<section class="section auth"><div class="container narrow">
  <h1>Log in</h1>
  ${error ? html`<div class="flash flash-error">${error}</div>` : ''}
  ${googleEnabled ? googleButton(`/auth/google?next=${encodeURIComponent(next)}`, 'Continue with Google') : ''}
  <form method="post" action="/login" class="form">
    <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="next" value="${next}">
    <label>Email <input type="email" name="email" value="${email}" required autocomplete="email" autofocus></label>
    <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn btn-primary btn-lg" type="submit">Log in</button>
  </form>
  <p class="muted"><a href="/forgot">Forgot your password?</a> · New here? <a href="/signup">Create a free account</a></p>
</div></section>`.toString();
}

export function forgotPage({ csrf }) {
  return html`<section class="section auth"><div class="container narrow"><h1>Reset your password</h1><p class="muted">Type your email and we send you a link to choose a new one.</p>
  <form method="post" action="/forgot" class="form"><input type="hidden" name="_csrf" value="${csrf}">
  <label>Email <input type="email" name="email" required autocomplete="email"></label>
  <button class="btn btn-primary" type="submit">Send reset link</button></form>
  <p class="muted"><a href="/login">Back to log in</a></p></div></section>`.toString();
}

export function resetPage({ csrf, token, error }) {
  return html`<section class="section auth"><div class="container narrow"><h1>Choose a new password</h1>
  ${error ? html`<div class="flash flash-error">${error}</div>` : ''}
  <form method="post" action="/reset" class="form"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="token" value="${token}">
  <label>New password <input type="password" name="password" required minlength="10" maxlength="200" autocomplete="new-password"></label>
  <button class="btn btn-primary" type="submit">Change password</button></form></div></section>`.toString();
}
