import { html } from '../../lib/html.js';
import { config } from '../../config.js';

const errorList = (errors) => (errors?.length ? html`<div class="flash flash-error"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : '');

export function signupPage({ csrf, name, plan, values, errors }) {
  return html`<section class="section auth"><div class="container narrow">
  <h1>Create your account</h1>
  <p class="muted">${plan ? html`You picked the <strong>${plan.name}</strong> plan. Everyone starts on Free; upgrade from your dashboard once you're in.` : 'Free to start. Your first site can go live in a minute.'}</p>
  ${errorList(errors)}
  <form method="post" action="/signup" class="form" autocomplete="on">
    <input type="hidden" name="_csrf" value="${csrf}">
    <label>Your site name <span class="muted">(you can add it later)</span>
      <div class="domain-input"><input name="subdomain" value="${name}" maxlength="40" placeholder="yourname" autocomplete="off" spellcheck="false" data-availability><span>.${config.baseDomain}</span></div>
      <small data-availability-msg></small></label>
    <label>Name <input name="name" value="${values.name ?? ''}" maxlength="80" autocomplete="name"></label>
    <label>Email <input type="email" name="email" value="${values.email ?? ''}" required maxlength="254" autocomplete="email"></label>
    <label>Password <input type="password" name="password" required minlength="10" maxlength="200" autocomplete="new-password"><small>At least 10 characters.</small></label>
    <label class="check"><input type="checkbox" name="agree" value="1" required> I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy policy</a>.</label>
    <button class="btn btn-primary btn-lg" type="submit">Create account</button>
  </form>
  <p class="muted">Already have an account? <a href="/login">Log in</a></p>
</div></section>`.toString();
}

export function loginPage({ csrf, next, email, error }) {
  return html`<section class="section auth"><div class="container narrow">
  <h1>Log in</h1>
  ${error ? html`<div class="flash flash-error">${error}</div>` : ''}
  <form method="post" action="/login" class="form">
    <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="next" value="${next}">
    <label>Email <input type="email" name="email" value="${email}" required autocomplete="email" autofocus></label>
    <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn btn-primary btn-lg" type="submit">Log in</button>
  </form>
  <p class="muted"><a href="/forgot">Forgot your password?</a> · New here? <a href="/signup">Create an account</a></p>
</div></section>`.toString();
}

export function forgotPage({ csrf }) {
  return html`<section class="section auth"><div class="container narrow"><h1>Reset your password</h1>
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
