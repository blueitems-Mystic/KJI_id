/* works 편집 모드 공용: 로그인, 저장 바, Worker 호출, SortableJS 로드, 이미지 고르기 창
 * ?edit=1 일 때만 허브/상세 페이지가 이 파일을 불러온다. 공개 화면에는 영향 없음.
 * 토큰 = 갤러리 관리자와 같은 ADMIN_TOKEN, sessionStorage 'admin_token' 공유 */
(function () {
  var SORTABLE = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js';
  var SORTABLE_SRI = 'sha384-DgmC6Xe2bSN2WjTDXzWYbUbxyhNP+NNkGDR/g78pCXV7E7rcVTGxVg0uIVCUUcBc';
  // 방문 기록 대시보드 (works/stats/). 이 파일(works/edit/common.js) 기준 경로
  var STATS_URL = new URL('../stats/', (document.currentScript && document.currentScript.src) || location.href).href;
  // 관리자로 로그인한 브라우저는 방문 기록에서 뺀다 (works/track.js 가 읽음)
  function noTrack() { try { localStorage.setItem('kji_works_notrack', '1'); } catch (e) {} }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function token() { return sessionStorage.getItem('admin_token') || ''; }

  function call(base, path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    if (opts.auth !== false && token()) h.Authorization = 'Bearer ' + token();
    return fetch(base + path, { method: opts.method || 'GET', headers: h, body: opts.body, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { sessionStorage.removeItem('admin_token'); throw new Error('auth'); }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
  }

  var sortableP = null;
  function loadSortable() {
    if (window.Sortable) return Promise.resolve(window.Sortable);
    if (!sortableP) sortableP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = SORTABLE; s.integrity = SORTABLE_SRI; s.crossOrigin = 'anonymous';
      s.onload = function () { res(window.Sortable); };
      s.onerror = function () { sortableP = null; rej(new Error('sortable')); };
      document.head.appendChild(s);
    });
    return sortableP;
  }

  /* 저장 바
   * opts: { title, hint, api, collect(): 저장할 조각 함수(cfg) → cfg 수정, onReverted(cfg), extra: [노드] } */
  function bar(opts) {
    var dirty = false;
    var status = el('span', { class: 'eb-status', text: opts.hint || '' });
    var pw = el('input', { type: 'password', class: 'eb-pw', placeholder: '관리자 비밀번호', autocomplete: 'current-password', 'aria-label': '관리자 비밀번호' });
    var loginBtn = el('button', { type: 'submit', class: 'eb-btn', text: '로그인' });
    var login = el('form', { class: 'eb-login' }, [pw, loginBtn]);
    var save = el('button', { type: 'button', class: 'eb-btn fill', text: '저장' });
    var revert = el('button', { type: 'button', class: 'eb-btn', text: '직전 저장으로 되돌리기', title: '마지막 저장 바로 전 상태로 돌아갑니다' });
    var exit = el('a', { class: 'eb-btn ghost', href: location.pathname + location.hash, text: '편집 끝내기' });
    var stats = el('a', { class: 'eb-btn', href: STATS_URL, text: '방문 기록', title: '방문자·게시물별 조회수와 체류시간 (관리자 전용)' });

    function setStatus(t, kind) { status.textContent = t; status.className = 'eb-status' + (kind ? ' ' + kind : ''); }
    function refresh() {
      var on = !!token();
      login.hidden = on; save.hidden = !on; revert.hidden = !on; stats.hidden = !on;
      if (on) noTrack();
      save.disabled = !dirty;
      save.textContent = dirty ? '저장' : '저장됨';
    }

    login.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!pw.value) return;
      sessionStorage.setItem('admin_token', pw.value);
      setStatus('확인 중…');
      // 저장 권한 확인: 관리자 전용 GET 으로 검사
      call(opts.api, '/api/config').then(function () {
        pw.value = ''; setStatus('로그인했습니다.', 'ok'); refresh();
        if (opts.onLogin) opts.onLogin();
      }).catch(function (err) {
        setStatus(err.message === 'auth' ? '비밀번호가 맞지 않습니다.' : '서버에 연결하지 못했습니다.', 'err'); refresh();
      });
    });

    save.addEventListener('click', function () {
      save.disabled = true; setStatus('저장 중…');
      // 다른 페이지에서 저장한 부분을 지우지 않도록 최신 값을 받아 내 조각만 바꿔 저장
      call(opts.api, '/api/works', { auth: false }).then(function (cfg) {
        cfg = cfg || {};
        cfg.banners = cfg.banners || {}; cfg.pages = cfg.pages || {};
        opts.collect(cfg);
        return call(opts.api, '/api/works', { method: 'PUT', body: JSON.stringify({ banners: cfg.banners, pages: cfg.pages }) });
      }).then(function () {
        dirty = false; refresh(); setStatus('저장했습니다. 공개 페이지에 바로 반영됩니다.', 'ok');
      }).catch(function (err) {
        refresh();
        setStatus(err.message === 'auth' ? '로그인이 풀렸습니다. 다시 로그인한 뒤 저장하세요. 편집한 내용은 그대로 있습니다.' : '저장하지 못했습니다 (' + err.message + '). 다시 눌러 주세요.', 'err');
      });
    });

    revert.addEventListener('click', function () {
      if (!confirm('마지막 저장 바로 전 상태로 되돌릴까요? 허브와 모든 상세 페이지의 편집값이 함께 되돌아갑니다.')) return;
      setStatus('되돌리는 중…');
      call(opts.api, '/api/works/revert', { method: 'POST' }).then(function (cfg) {
        dirty = false; refresh(); setStatus('되돌렸습니다.', 'ok');
        opts.onReverted(cfg || {});
      }).catch(function (err) {
        setStatus(err.message === '404' ? '되돌릴 이전 저장이 없습니다.' : '되돌리지 못했습니다 (' + err.message + ').', 'err');
      });
    });

    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    var node = el('div', { class: 'edit-bar', role: 'region', 'aria-label': '편집 도구' }, [
      el('strong', { class: 'eb-title', text: opts.title })
    ].concat(opts.extra || [], [login, save, revert, stats, exit, status]));
    document.body.classList.add('editing');
    document.body.insertBefore(node, document.body.firstChild);
    refresh();
    return {
      node: node,
      changed: function () { dirty = true; refresh(); },
      clean: function () { dirty = false; refresh(); },
      status: setStatus
    };
  }

  /* 이미지 고르기 창
   * tabs: [{ label, load(): Promise<[{ src, srcSmall, thumb, alt, label }]> }] → Promise<item|null> */
  function pickImage(tabs) {
    return new Promise(function (resolve) {
      var dlg = el('dialog', { class: 'pick', 'aria-label': '이미지 고르기' });
      var head = el('div', { class: 'pick-head' });
      var q = el('input', { type: 'search', class: 'pick-q', placeholder: '이름·폴더로 찾기', 'aria-label': '이미지 찾기' });
      var grid = el('ul', { class: 'pick-grid' });
      var msg = el('p', { class: 'pick-msg' });
      var cur = [], picked = null;
      var tabBtns = tabs.map(function (t, i) {
        return el('button', { type: 'button', class: 'eb-btn', role: 'tab', onclick: function () { show(i); } , text: t.label });
      });
      head.appendChild(el('div', { class: 'pick-tabs', role: 'tablist' }, tabBtns));
      head.appendChild(q);
      head.appendChild(el('button', { type: 'button', class: 'eb-btn', text: '닫기', onclick: function () { dlg.close(); } }));
      dlg.appendChild(head); dlg.appendChild(msg); dlg.appendChild(grid);

      function draw() {
        var term = q.value.trim().toLowerCase();
        grid.textContent = '';
        var items = cur.filter(function (it) { return !term || (it.label || '').toLowerCase().indexOf(term) >= 0; });
        msg.textContent = items.length ? items.length + '장' : (cur.length ? '찾는 이미지가 없습니다.' : '');
        items.slice(0, 400).forEach(function (it) {
          var b = el('button', { type: 'button', title: it.label || '', onclick: function () { picked = it; dlg.close(); } }, [
            el('img', { src: it.thumb || it.srcSmall || it.src, alt: '', loading: 'lazy', decoding: 'async' }),
            el('span', { text: it.label || '' })
          ]);
          grid.appendChild(el('li', null, [b]));
        });
      }
      function show(i) {
        tabBtns.forEach(function (b, k) { b.className = 'eb-btn' + (k === i ? ' fill' : ''); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
        cur = []; grid.textContent = ''; msg.textContent = '불러오는 중…';
        tabs[i].load().then(function (items) { cur = items || []; draw(); if (!cur.length) msg.textContent = '이미지가 없습니다.'; })
          .catch(function (err) { msg.textContent = err && err.message === 'auth' ? '로그인한 뒤 볼 수 있습니다.' : '불러오지 못했습니다.'; });
      }
      q.addEventListener('input', draw);
      dlg.addEventListener('close', function () { dlg.remove(); resolve(picked); });
      document.body.appendChild(dlg);
      dlg.showModal();
      show(0);
    });
  }

  // Cloudinary 전체 이미지 (관리자 전용 /api/images, Worker 경유)
  function cloudinaryAll(base, cloud) {
    return call(base, '/api/images').then(function (d) {
      return (d.images || []).map(function (im) { return cldItem(cloud, im.publicId, im.publicId); });
    });
  }
  // 배너용 URL. 초점 크롭은 % 좌표라 c_limit 축소와 무관 (기존 배너와 같은 규격)
  function cldItem(cloud, id, label) {
    var b = 'https://res.cloudinary.com/' + cloud + '/image/upload/';
    return {
      src: b + 'c_limit,w_2000,q_auto,f_auto/' + id,
      srcSmall: b + 'c_limit,w_960,q_auto,f_auto/' + id,
      thumb: b + 'c_fill,w_240,h_240,q_auto,f_auto/' + id,
      label: label || id
    };
  }

  window.KJIEdit = { el: el, call: call, token: token, loadSortable: loadSortable, bar: bar, pickImage: pickImage, cloudinaryAll: cloudinaryAll, cldItem: cldItem };
})();
