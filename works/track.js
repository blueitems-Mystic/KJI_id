/* works 방문 기록 수집 (관리자 대시보드: works/stats/)
 * - 페이지 열림 1회 + 누적 체류시간을 숨김/떠남 때 navigator.sendBeacon 으로 보냄 (Umami·Plausible 과 같은 방식)
 * - 체류시간 = 탭이 보이고, 마지막 조작 후 60초 안인 시간만 셈
 * - 게시물 = article.arc[id] 또는 [data-track-item]. 화면의 절반 이상을 차지하거나 절반 이상 보일 때 시간 셈, 안의 링크·이미지 클릭 = 크게 보기
 * - 쿠키·localStorage ID 없음. 방문자 구분은 서버가 IP·브라우저·날짜 해시로 함
 * - 제외: ?edit=1 화면, 관리자로 로그인한 적 있는 브라우저(localStorage kji_works_notrack=1), 로컬 개발 주소 */
(function () {
  'use strict';
  var me = document.currentScript;
  var PROD_API = 'https://kji-gallery-api.blueitems7.workers.dev';
  var host = location.hostname;
  var local = host === '127.0.0.1' || host === 'localhost';
  var api;
  try {
    if (new URLSearchParams(location.search).get('edit') === '1') return;
    if (localStorage.getItem('kji_works_notrack') === '1') return;
    api = local ? localStorage.getItem('kji_track_api') : PROD_API; // 로컬은 개발용 Worker 를 지정했을 때만
  } catch (e) { return; }
  if (!api || !navigator.sendBeacon || navigator.webdriver) return;

  // works/ 기준 경로: 허브 = "/", 상세 = "tactan/"
  var base = new URL('.', me && me.src ? me.src : location.href).pathname;
  var path = location.pathname.replace(/index\.html$/, '');
  var page = path.indexOf(base) === 0 ? path.slice(base.length) || '/' : path;

  var pv = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  var url = api + '/api/works/track';
  function send(o) {
    o.pv = pv; o.page = page;
    try { navigator.sendBeacon(url, new Blob([JSON.stringify(o)], { type: 'text/plain' })); } catch (e) {}
  }

  // 유입: 다른 사이트면 호스트만, 이 사이트 안이면 경로
  var ref = '';
  try {
    if (document.referrer) {
      var r = new URL(document.referrer);
      if (r.host === location.host) {
        var rp = r.pathname.replace(/index\.html$/, '');
        ref = '@' + (rp.indexOf(base) === 0 ? rp.slice(base.length) || '/' : rp);
      } else ref = r.host;
    }
  } catch (e) {}
  send({ t: 'v', title: document.title, ref: ref });

  // ---------- 체류시간 ----------
  var IDLE = 60000;
  var activeMs = 0, maxScroll = 0, lastTick = performance.now(), lastInput = lastTick, dirty = false;
  var items = {}; // key → { ms, opens, label, on }
  function active(now) { return document.visibilityState === 'visible' && now - lastInput < IDLE; }
  function tick() {
    var now = performance.now(), dt = now - lastTick;
    lastTick = now;
    if (dt <= 0 || dt > 5000 || !active(now)) return; // 탭이 잠들었다 깬 큰 간격은 버림
    activeMs += dt; dirty = true;
    for (var k in items) if (items[k].on) items[k].ms += dt;
  }
  ['scroll', 'pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(function (t) {
    window.addEventListener(t, function () { tick(); lastInput = performance.now(); }, { passive: true, capture: true });
  });
  window.addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight - innerHeight;
    var s = h > 0 ? Math.round(scrollY / h * 100) : 100;
    if (s > maxScroll) { maxScroll = Math.min(100, s); dirty = true; }
  }, { passive: true });
  setInterval(tick, 1000);

  // ---------- 게시물 ----------
  var SEL = 'article.arc[id], li.work[id], [data-track-item]';
  function keyOf(n) { return n.getAttribute('data-track-item') || n.id; }
  function labelOf(n) {
    var l = n.getAttribute('data-track-label');
    if (!l) { var h = n.querySelector('h2, h3'); l = h ? h.textContent : ''; }
    return (l || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (ents) {
    tick();
    ents.forEach(function (en) {
      var it = items[keyOf(en.target)];
      if (it) it.on = en.isIntersecting && (en.intersectionRatio >= 0.5 || en.intersectionRect.height >= innerHeight * 0.5);
    });
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] }) : null;
  var watched = typeof WeakSet === 'function' ? new WeakSet() : null;
  function scan() {
    if (!io || !watched) return;
    Array.prototype.forEach.call(document.querySelectorAll(SEL), function (n) {
      if (watched.has(n)) return;
      var k = keyOf(n);
      if (!k) return;
      watched.add(n);
      if (!items[k]) items[k] = { ms: 0, opens: 0, label: labelOf(n), on: false };
      io.observe(n);
    });
  }
  scan();
  if ('MutationObserver' in window) {
    var pend = 0;
    new MutationObserver(function () { if (!pend) pend = setTimeout(function () { pend = 0; scan(); }, 300); })
      .observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('a, img, button') : null;
    var box = t && t.closest(SEL);
    var it = box && items[keyOf(box)];
    if (it && (t.tagName === 'IMG' || t.querySelector && t.querySelector('img') || t.tagName === 'A')) { it.opens++; dirty = true; }
  }, true);

  // ---------- 보내기: 숨김·떠남 때, 그리고 보이는 동안 45초마다 바뀐 게 있으면 ----------
  function flush() {
    tick();
    if (!dirty) return;
    dirty = false;
    var list = [];
    for (var k in items) {
      var it = items[k];
      if (it.ms >= 300 || it.opens) list.push([k, Math.round(it.ms), it.opens, it.label]);
    }
    send({ t: 'u', ms: Math.round(activeMs), scroll: maxScroll, items: list.slice(0, 150) });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
    else { lastTick = performance.now(); lastInput = lastTick; }
  });
  window.addEventListener('pagehide', flush);
  setInterval(function () { if (document.visibilityState === 'visible') flush(); }, 45000);
})();
