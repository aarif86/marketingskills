// Progressive enhancement only: every form works without this file.
(function () {
  'use strict';

  // ---- availability checker ----
  document.querySelectorAll('[data-availability]').forEach(function (input) {
    var msg = input.closest('label, form, .hero-form') && input.closest('label, form, .hero-form').querySelector('[data-availability-msg]');
    var timer;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var v = input.value.trim().toLowerCase().replace(/\s+/g, '-');
      if (v !== input.value) input.value = v;
      if (!msg) return;
      if (v.length < 3) { msg.textContent = ''; msg.className = ''; return; }
      timer = setTimeout(function () {
        fetch('/api/availability?name=' + encodeURIComponent(v), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (input.value.trim() !== v) return;
            msg.textContent = d.available ? d.url + ' is available' : d.reason;
            msg.className = d.available ? 'ok' : 'warn';
          }).catch(function () {});
      }, 250);
    });
  });

  // ---- mobile drawer ----
  var drawer = document.querySelector('[data-drawer]');
  var opener = document.querySelector('[data-drawer-open]');
  if (drawer && opener) {
    var setOpen = function (on) {
      drawer.classList.toggle('open', on);
      drawer.setAttribute('aria-hidden', on ? 'false' : 'true');
      opener.setAttribute('aria-expanded', on ? 'true' : 'false');
      document.body.classList.toggle('drawer-open', on);
    };
    opener.addEventListener('click', function () { setOpen(!drawer.classList.contains('open')); });
    drawer.querySelectorAll('[data-drawer-close], a').forEach(function (el) { el.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  // ---- reveal on scroll (marketing only; respects reduced motion) ----
  if (document.body.classList.contains('marketing') && 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var targets = document.querySelectorAll('.section .card, .section h2, .section-lead, .features li, .cta > .container > *');
    var i = 0;
    targets.forEach(function (el) { el.classList.add('reveal'); if (el.classList.contains('card') || el.tagName === 'LI') el.style.transitionDelay = ((i++ % 3) * 0.08) + 's'; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('on'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (el) { io.observe(el); });
  }

  // ---- scroll to top ----
  var top = document.createElement('button');
  top.type = 'button'; top.className = 'to-top'; top.setAttribute('aria-label', 'Back to top');
  top.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(top);
  var ticking = false;
  var updateTop = function () { top.classList.toggle('show', window.scrollY > 480); ticking = false; };
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(updateTop); } }, { passive: true });
  updateTop();
  top.addEventListener('click', function () {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });

  // ---- Continue with Google: carry the site name typed on the signup form ----
  document.querySelectorAll('[data-google-start]').forEach(function (a) {
    a.addEventListener('click', function () {
      var inp = document.querySelector('input[name=subdomain]');
      if (!inp || !inp.value.trim()) return;
      var u = new URL(a.href, window.location.origin);
      u.searchParams.set('name', inp.value.trim().toLowerCase());
      a.href = u.pathname + u.search;
    });
  });

  // ---- try it: pick a file = go; show progress while it uploads ----
  var tryForm = document.querySelector('[data-try-form]');
  if (tryForm) {
    var tryFile = tryForm.querySelector('[data-try-file]');
    var tryName = tryForm.querySelector('[data-try-filename]');
    var tryBtn = tryForm.querySelector('[data-try-submit]');
    var tryBar = tryForm.querySelector('[data-try-bar]');
    if (tryFile) tryFile.addEventListener('change', function () {
      if (!tryFile.files.length) return;
      if (tryName) tryName.textContent = tryFile.files[0].name;
      if (typeof tryForm.requestSubmit === 'function') tryForm.requestSubmit(); else tryForm.submit();
    });
    tryForm.addEventListener('submit', function () {
      tryBtn.disabled = true; tryBtn.textContent = 'Putting your page online…';
      if (tryBar) tryBar.hidden = false;
    });
  }

  // ---- try it result page: ask the server until the link really answers, then show it ----
  var waiting = document.querySelector('[data-try-status]');
  if (waiting) {
    var statusUrl = waiting.getAttribute('data-try-status');
    var tick = function () {
      fetch(statusUrl, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ready) window.location.reload(); else setTimeout(tick, 3000);
      }).catch(function () { setTimeout(tick, 5000); });
    };
    setTimeout(tick, 2000);
  }

  // ---- confirmations ----
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // ---- drag & drop uploads ----
  var dz = document.querySelector('[data-dropzone]');
  if (!dz || dz.hasAttribute('data-disabled')) {
    if (dz) dz.classList.add('disabled');
    return;
  }
  var progress = dz.querySelector('.dz-progress');
  var bar = dz.querySelector('.bar span');
  var status = dz.querySelector('.dz-status');
  var modeInput = dz.querySelector('[data-mode]');
  var busy = false;

  function collectFromDataTransfer(dt) {
    // Walk dropped folders where the browser supports it (Chrome/Edge/Safari), otherwise plain files.
    var items = dt.items;
    if (!items || !items.length || typeof items[0].webkitGetAsEntry !== 'function') {
      return Promise.resolve(Array.prototype.map.call(dt.files, function (f) { return { file: f, path: f.name }; }));
    }
    var out = [];
    function walk(entry, prefix) {
      return new Promise(function (resolve) {
        if (entry.isFile) {
          entry.file(function (f) { out.push({ file: f, path: prefix + entry.name }); resolve(); }, function () { resolve(); });
        } else if (entry.isDirectory) {
          var reader = entry.createReader();
          var all = [];
          (function readMore() {
            reader.readEntries(function (batch) {
              if (!batch.length) {
                Promise.all(all.map(function (e) { return walk(e, prefix + entry.name + '/'); })).then(resolve);
              } else { all = all.concat(Array.prototype.slice.call(batch)); readMore(); }
            }, function () { resolve(); });
          })();
        } else resolve();
      });
    }
    var entries = [];
    for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry(); if (en) entries.push(en); }
    return Promise.all(entries.map(function (e) { return walk(e, ''); })).then(function () { return out; });
  }

  function stripTopFolder(list) {
    // If everything sits inside one folder (e.g. "my-site/index.html"), publish its contents at the root.
    if (list.length < 1) return list;
    var first = list[0].path.split('/');
    if (first.length < 2) return list;
    var top = first[0] + '/';
    if (list.every(function (f) { return f.path.indexOf(top) === 0; })) {
      return list.map(function (f) { return { file: f.file, path: f.path.slice(top.length) }; });
    }
    return list;
  }

  function upload(list, mode) {
    if (busy || !list.length) return;
    list = stripTopFolder(list);
    var isZip = list.length === 1 && /\.zip$/i.test(list[0].path);
    if (!isZip && mode === 'replace' && !window.confirm('Replace the whole site with these ' + list.length + ' files?')) return;
    busy = true;
    dz.classList.add('busy');
    progress.hidden = false;
    bar.style.width = '0%';
    status.textContent = isZip ? 'Uploading ZIP…' : 'Uploading ' + list.length + ' file' + (list.length === 1 ? '' : 's') + '…';
    var fd = new FormData();
    fd.append('_csrf', dz.querySelector('input[name=_csrf]').value);
    fd.append('mode', isZip ? 'replace' : mode);
    list.forEach(function (f) { fd.append('files', f.file, f.path); });
    var xhr = new XMLHttpRequest();
    xhr.open('POST', dz.getAttribute('action'));
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
    xhr.onload = function () {
      busy = false;
      var d = {};
      try { d = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && d.ok) {
        status.textContent = 'Published version ' + d.version + '. Reloading…';
        bar.style.width = '100%';
        window.location.reload();
      } else {
        dz.classList.remove('busy');
        status.textContent = (d.error || 'Upload failed (' + xhr.status + ').');
        status.classList.add('warn');
      }
    };
    xhr.onerror = function () { busy = false; dz.classList.remove('busy'); status.textContent = 'Network error. Please try again.'; };
    xhr.send(fd);
  }

  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
  dz.addEventListener('drop', function (e) {
    collectFromDataTransfer(e.dataTransfer).then(function (list) { upload(list, modeInput.value); });
  });
  dz.querySelectorAll('input[type=file]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var list = Array.prototype.map.call(inp.files, function (f) { return { file: f, path: f.webkitRelativePath || f.name }; });
      var pick = inp.getAttribute('data-pick');
      upload(list, pick === 'zip' ? 'replace' : 'merge');
      inp.value = '';
    });
  });
  dz.addEventListener('submit', function (e) { e.preventDefault(); });
})();
