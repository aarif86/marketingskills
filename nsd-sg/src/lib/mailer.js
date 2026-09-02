// Minimal SMTP client (STARTTLS / implicit TLS, AUTH PLAIN/LOGIN) with a console fallback.
// Zero dependencies on purpose: the platform only sends a handful of transactional emails.
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../config.js';

function smtpSession(socketFactory, { host, port, user, pass, from, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    let sock = socketFactory();
    let buf = '';
    const steps = [];
    let idx = 0;
    const timeout = setTimeout(() => fail(new Error('SMTP timeout')), 20_000);

    function fail(err) {
      clearTimeout(timeout);
      try { sock.destroy(); } catch { /* ignore */ }
      reject(err);
    }
    function send(line) {
      sock.write(line + '\r\n');
    }
    function expect(codePrefix) {
      return (line) => {
        if (!line.startsWith(codePrefix)) throw new Error(`SMTP unexpected: ${line}`);
      };
    }
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const boundary = 'nsd' + Date.now().toString(36);
    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      `--${boundary}--`,
      '.',
    ].join('\r\n').replace(/\r\n\.(?=\r\n)/g, '\r\n..');

    steps.push({ check: expect('220'), then: () => send(`EHLO ${config.baseDomain}`) });
    steps.push({
      check: expect('250'),
      then: (banner) => {
        if (sock instanceof tls.TLSSocket === false && /STARTTLS/i.test(banner)) {
          send('STARTTLS');
          steps.splice(idx + 1, 0, {
            check: expect('220'),
            then: () => {
              const plain = sock;
              plain.removeAllListeners('data');
              sock = tls.connect({ socket: plain, servername: host }, () => {
                attach();
                send(`EHLO ${config.baseDomain}`);
              });
              sock.on('error', fail);
            },
          });
          steps.splice(idx + 2, 0, { check: expect('250'), then: () => send('AUTH LOGIN') });
        } else {
          send('AUTH LOGIN');
        }
      },
    });
    steps.push({ check: expect('334'), then: () => send(b64(user)) });
    steps.push({ check: expect('334'), then: () => send(b64(pass)) });
    steps.push({ check: expect('235'), then: () => send(`MAIL FROM:<${from.replace(/.*<|>.*/g, '')}>`) });
    steps.push({ check: expect('250'), then: () => send(`RCPT TO:<${to}>`) });
    steps.push({ check: expect('250'), then: () => send('DATA') });
    steps.push({ check: expect('354'), then: () => send(message) });
    steps.push({ check: expect('250'), then: () => send('QUIT') });
    steps.push({ check: () => {}, then: () => { clearTimeout(timeout); sock.end(); resolve(true); } });

    function onData(chunk) {
      buf += chunk.toString('utf8');
      let nl;
      let full = '';
      while ((nl = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        full += line + '\n';
        if (line.length >= 4 && line[3] === '-') continue; // multi-line continuation
        try {
          const step = steps[idx];
          step.check(line);
          idx += 1;
          step.then(full);
        } catch (e) {
          fail(e);
        }
        full = '';
      }
    }
    function attach() {
      sock.on('data', onData);
    }
    attach();
    sock.on('error', fail);
  });
}

export async function sendMail({ to, subject, text, html }) {
  const { host, port, user, pass, from } = config.smtp;
  if (!host) {
    // Console fallback: safe default for dev and for the first deploy before SMTP is configured.
    console.log(JSON.stringify({ level: 'info', mail: { to, subject, text } }));
    return { delivered: false, logged: true };
  }
  const implicitTls = port === 465;
  const factory = implicitTls
    ? () => tls.connect({ host, port, servername: host })
    : () => net.connect({ host, port });
  await smtpSession(factory, { host, port, user, pass, from, to, subject, text, html: html ?? `<pre>${text}</pre>` });
  return { delivered: true };
}
