/**
 * admin-nav.js — shared console switcher for every VillageFirst admin page.
 *
 * Renders a slim strip under the page topbar:
 *   ⌂ Admin home · 📊 Surveys · 📰 News desk · 🌐 Publish · 📖 Playbook
 * Current console is highlighted. Include with:
 *   <script src="/admin/admin-nav.js" defer></script>
 *
 * Placement: into #vf-console-nav-mount if present, else directly after the
 * first .topbar (works inside auth-gated #app wrappers), else top of body.
 *
 * Also fixes /survey-admin/#playbook deep links: once the survey app is
 * visible it switches to the Playbook panel.
 */
(function () {
  var TOOLS = [
    { id: 'home',     href: '/admin/',                   label: '⌂ Admin home' },
    { id: 'surveys',  href: '/survey-admin/',            label: '📊 Surveys' },
    { id: 'news',     href: '/admin/news/',              label: '📰 News desk' },
    { id: 'publish',  href: '/admin/publish-news.html',  label: '🌐 Publish' },
    { id: 'playbook', href: '/admin/playbook/',          label: '📖 Playbooks' },
  ];

  function currentId() {
    var p = location.pathname, h = location.hash;
    if (p.indexOf('/survey-admin') === 0) return 'surveys';
    if (p.indexOf('/admin/playbook') === 0) return 'playbook';
    if (p.indexOf('/admin/news') === 0) return 'news';
    if (p.indexOf('publish-news') > -1) return 'publish';
    if (p.indexOf('/admin') === 0) return 'home';
    return '';
  }

  function buildBar() {
    var cur = currentId();
    var bar = document.createElement('nav');
    bar.id = 'vf-console-nav';
    bar.setAttribute('aria-label', 'Admin consoles');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#ffffff;border-bottom:1px solid #e2e8f0;padding:7px 14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:100%;box-sizing:border-box;';
    TOOLS.forEach(function (t) {
      var a = document.createElement('a');
      a.href = t.href;
      a.textContent = t.label;
      var on = t.id === cur;
      a.style.cssText = 'font-size:11.5px;font-weight:' + (on ? '700' : '500') + ';text-decoration:none;border-radius:14px;padding:4px 12px;white-space:nowrap;' +
        (on
          ? 'background:#0f5c48;color:#ffffff;'
          : 'color:#4b5563;border:1px solid #e2e8f0;background:#fff;');
      if (!on) {
        a.onmouseenter = function () { a.style.background = '#f0fdf6'; };
        a.onmouseleave = function () { a.style.background = '#fff'; };
      }
      if (t.id === 'playbook' && location.pathname.indexOf('/survey-admin') === 0) {
        a.onclick = function () { setTimeout(openPlaybookIfRequested, 50); };
      }
      bar.appendChild(a);
    });
    return bar;
  }

  function insertBar() {
    if (document.getElementById('vf-console-nav')) return;
    var bar = buildBar();
    var mount = document.getElementById('vf-console-nav-mount');
    if (mount) { mount.appendChild(bar); return; }
    var topbar = document.querySelector('.topbar');
    if (topbar && topbar.parentNode) {
      topbar.parentNode.insertBefore(bar, topbar.nextSibling);
      return;
    }
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // ── /survey-admin/#playbook deep link ─────────────────────────────
  function openPlaybookIfRequested() {
    if (location.pathname.indexOf('/survey-admin') !== 0) return;
    if (location.hash !== '#playbook') return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var app = document.getElementById('app');
      var visible = app && app.style.display !== 'none';
      if (visible && typeof window.showPanel === 'function') {
        clearInterval(timer);
        var items = document.querySelectorAll('.sidebar .s-item');
        var pbItem = null;
        items.forEach(function (el) { if (el.textContent.indexOf('Playbook') > -1) pbItem = el; });
        try { window.showPanel('playbook', pbItem); } catch (e) { /* panel name changed */ }
      }
      if (tries > 100) clearInterval(timer);
    }, 200);
  }

  function init() {
    insertBar();
    openPlaybookIfRequested();
    window.addEventListener('hashchange', function () {
      var old = document.getElementById('vf-console-nav');
      if (old) old.replaceWith(buildBar());
      openPlaybookIfRequested();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
