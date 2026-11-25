/* 완성 페이지(컨셉군 페이지 등) 공용: 편집값 적용 + ?edit=1 편집기 연결
 *   <script src="../static-layout.js" data-slug="project-cx" defer></script>
 * - 시트형 (main 안 .seq 블록): 이미지 순서·한 줄 묶기·숨기기·추가
 * - 보드형 (그 밖): 원래 내용은 그대로, 맨 아래 "추가 이미지" 영역만 편집
 * 편집값 = Worker /api/works → pages[slug] = { order: ['page'], entries: { page: { rows, hidden, added } } }
 * 편집값이 없으면 페이지를 건드리지 않는다. */
(function () {
  var me = document.currentScript;
  var SLUG = me && me.getAttribute('data-slug');
  if (!SLUG) return;
  var HERE = me.src.replace(/[^/]*$/, '');        // works/
  var CLOUD = 'duwi0pqm2';
  var DEFAULT_API = 'https://kji-gallery-api.blueitems7.workers.dev';
  var qs = new URLSearchParams(location.search);
  var EDIT = qs.get('edit') === '1';
  var API = (qs.get('api') && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) ? qs.get('api').replace(/\/$/, '') : DEFAULT_API;

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] == null) return;
      if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function cld(id, t) { return 'https://res.cloudinary.com/' + CLOUD + '/image/upload/' + t + '/' + id; }

  // ---- 스타일 (한 줄 묶음, 추가 영역, 보드형 크게 보기) ----
  var css = document.createElement('style');
  css.textContent =
    '.seq.kji-row{max-width:1200px;display:flex;gap:16px;align-items:flex-start}' +
    '.seq.kji-row figure{margin:0;min-width:0;flex:1 1 0}' +
    '.kji-extra{max-width:1200px;margin:96px auto 0;padding:0 clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:16px}' +
    '.kji-extra .kji-xrow{display:flex;gap:16px;align-items:flex-start}' +
    '.kji-extra .kji-xrow a{flex:1 1 0;min-width:0;display:block;cursor:zoom-in}' +
    '.kji-extra img{display:block;width:100%;height:auto}' +
    '.kji-lb{width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgba(30,31,33,.96)}' +
    '.kji-lb::backdrop{background:transparent}' +
    '.kji-lb img{position:absolute;inset:16px 16px 60px;margin:auto;max-width:calc(100% - 32px);max-height:calc(100% - 76px);width:auto;height:auto;object-fit:contain}' +
    '.kji-lb .bar{position:absolute;left:0;right:0;bottom:0;height:56px;display:flex;gap:8px;align-items:center;justify-content:center;color:#e6e4df;font:14px "IBM Plex Sans KR",sans-serif}' +
    '.kji-lb button{font:inherit;color:inherit;background:none;border:1px solid #6d6f72;border-radius:2px;padding:4px 14px;cursor:pointer}' +
    '@media (max-width:760px){.seq.kji-row,.kji-extra,.kji-extra .kji-xrow{gap:8px}}';
  document.head.appendChild(css);

  // ---- 원래 페이지 읽기 ----
  var main = document.querySelector('main');
  var blocks = main ? Array.prototype.filter.call(main.children, function (n) { return n.classList.contains('seq'); }) : [];
  var MODE = blocks.length ? 'seq' : 'extra';
  var items = [];          // 원래 이미지
  var origRows = [];       // [{ cls, keys, single }]
  blocks.forEach(function (b) {
    var cls = b.className.replace(/\bseq\b/, '').trim();
    var as = b.tagName === 'FIGURE' ? [b.querySelector('a')] : Array.prototype.map.call(b.querySelectorAll(':scope > figure'), function (f) { return f.querySelector('a'); });
    var keys = [];
    as.forEach(function (a) {
      if (!a) return;
      var img = a.querySelector('img');
      var key = img.getAttribute('src');
      keys.push(key);
      items.push({ key: key, a: a, w: +img.getAttribute('width') || 0, h: +img.getAttribute('height') || 0, tile: img.getAttribute('src'), src: img.getAttribute('src'), full: a.getAttribute('href') });
    });
    origRows.push({ cls: cls, keys: keys, single: b.tagName === 'FIGURE' });
  });
  var origBlocks = blocks.slice();
  var title = (document.querySelector('h1') || {}).textContent || SLUG;
  var entry = { key: 'page', title: title.trim(), imgs: items, year: null, category: MODE === 'seq' ? '' : '이 페이지 아래에 붙는 추가 이미지' };

  function addedImg(a) {
    var im = {
      key: a.key, added: a, w: a.w, h: a.h,
      tile: cld(a.id, 'c_limit,h_320,q_auto,f_auto'),
      src: cld(a.id, 'c_limit,w_1600,q_auto,f_auto'),
      full: cld(a.id, 'c_limit,w_2400,q_auto,f_auto'),
      srcset: [800, 1200, 1600, 2400].map(function (w) { return cld(a.id, 'c_limit,w_' + w + ',q_auto,f_auto') + ' ' + w + 'w'; }).join(', ')
    };
    return im;
  }
  function linkFor(im) {
    if (im.a) return im.a;
    var img = el('img', { src: im.src, srcset: im.srcset, sizes: '(max-width: 1240px) 100vw, 1200px', loading: 'lazy', decoding: 'async', alt: '', width: im.w || null, height: im.h || null });
    im.a = el('a', { href: im.full }, [img]);
    return im.a;
  }
  function rowsOf(ec) {
    var imgs = items.concat(((ec && ec.added) || []).filter(function (a) { return a && a.id; }).map(addedImg));
    var byKey = {}, used = {}, rows = [];
    imgs.forEach(function (im) { byKey[im.key] = im; });
    ((ec && ec.rows) || []).forEach(function (r) {
      var row = (r || []).map(function (k) { return byKey[k]; }).filter(function (im) { return im && !used[im.key]; });
      row.forEach(function (im) { used[im.key] = 1; });
      if (row.length) rows.push(row);
    });
    // 레이아웃에 없는 원래 이미지·추가 이미지는 원래 순서대로 뒤에
    if (!(ec && ec.rows)) origRows.forEach(function (o) {
      var row = o.keys.map(function (k) { return byKey[k]; }).filter(function (im) { return im && !used[im.key]; });
      row.forEach(function (im) { used[im.key] = 1; });
      if (row.length) rows.push(row);
    });
    imgs.forEach(function (im) { if (!used[im.key]) rows.push([im]); });
    return rows;
  }
  function ecOf(pc) { return ((pc || {}).entries || {}).page || null; }

  // ---- 적용 ----
  function sameAs(row) {
    return origRows.filter(function (o) { return o.keys.length === row.length && o.keys.every(function (k, i) { return row[i].key === k; }); })[0];
  }
  function fit(holder, im) {
    var set = function (w, h) { if (w && h) holder.style.flex = (w / h).toFixed(4) + ' 1 0'; };
    set(im.w, im.h);
    if (!im.w) { var img = holder.querySelector('img'); img.addEventListener('load', function () { set(img.naturalWidth, img.naturalHeight); }); }
  }
  function blockFor(row) {
    var o = sameAs(row);
    if (o) {
      if (o.single) return el('figure', { class: ('seq ' + o.cls).trim() }, [linkFor(row[0])]);
      return el('div', { class: ('seq ' + o.cls).trim() }, row.map(function (im) { return el('figure', null, [linkFor(im)]); }));
    }
    if (row.length === 1) {
      var from = origRows.filter(function (r) { return r.single && r.keys[0] === row[0].key; })[0];
      var cls = from ? from.cls.replace(/\bcont\b/, '').trim() : 'one';
      return el('figure', { class: 'seq ' + (cls || 'one') }, [linkFor(row[0])]);
    }
    return el('div', { class: 'seq kji-row' }, row.map(function (im) { var f = el('figure', null, [linkFor(im)]); fit(f, im); return f; }));
  }
  var extraBox = null;
  function extraHost() {
    if (extraBox) return extraBox;
    extraBox = el('section', { class: 'kji-extra', 'aria-label': '추가 이미지' });
    var foot = document.querySelector('body > footer');
    if (foot) foot.parentNode.insertBefore(extraBox, foot);
    else {
      var scripts = document.querySelectorAll('body > script'), first = scripts[0];
      document.body.insertBefore(extraBox, first || null);
    }
    return extraBox;
  }
  function apply(pc) {
    var ec = ecOf(pc), hidden = (ec && ec.hidden) || [];
    var rows = rowsOf(ec).map(function (r) { return r.filter(function (im) { return hidden.indexOf(im.key) < 0; }); }).filter(function (r) { return r.length; });
    if (MODE === 'seq') {
      Array.prototype.slice.call(main.children).forEach(function (n) { if (n.classList.contains('seq')) n.remove(); });
      rows.forEach(function (r) { main.appendChild(blockFor(r)); });
    } else {
      var box = extraHost();
      box.textContent = '';
      rows.forEach(function (r) {
        var x = el('div', { class: 'kji-xrow' }, r.map(function (im) { var a = linkFor(im); if (r.length > 1) fit(a, im); else a.style.flex = ''; return a; }));
        box.appendChild(x);
      });
      box.hidden = !rows.length;
    }
  }
  function restoreOriginal() {
    if (MODE === 'seq') {
      Array.prototype.slice.call(main.children).forEach(function (n) { if (n.classList.contains('seq')) n.remove(); });
      origBlocks.forEach(function (b, i) {
        // 원래 블록에 원래 링크를 되돌려 넣음
        var o = origRows[i], figs = b.tagName === 'FIGURE' ? [b] : Array.prototype.slice.call(b.querySelectorAll(':scope > figure'));
        o.keys.forEach(function (k, j) { var im = items.filter(function (x) { return x.key === k; })[0]; if (im && figs[j] && !figs[j].contains(im.a)) figs[j].appendChild(im.a); });
        main.appendChild(b);
      });
    } else if (extraBox) { extraBox.textContent = ''; extraBox.hidden = true; }
  }

  // 보드형: 추가 이미지 크게 보기
  if (MODE === 'extra') {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('.kji-extra a');
      if (!a || document.body.classList.contains('editing')) return;
      e.preventDefault();
      var list = Array.prototype.slice.call(document.querySelectorAll('.kji-extra a')), i = list.indexOf(a);
      var dlg = el('dialog', { class: 'kji-lb', 'aria-label': '크게 보기' });
      var img = el('img', { alt: '' }), cnt = el('span');
      function show(k) { i = (k + list.length) % list.length; img.src = list[i].getAttribute('href'); cnt.textContent = (i + 1) + ' / ' + list.length; }
      var prev = el('button', { type: 'button' }), next = el('button', { type: 'button' }), close = el('button', { type: 'button' });
      prev.textContent = '이전'; next.textContent = '다음'; close.textContent = '닫기';
      prev.onclick = function () { show(i - 1); }; next.onclick = function () { show(i + 1); }; close.onclick = function () { dlg.close(); };
      dlg.appendChild(img); dlg.appendChild(el('div', { class: 'bar' }, [prev, cnt, next, close]));
      dlg.addEventListener('close', function () { dlg.remove(); });
      dlg.addEventListener('keydown', function (ev) { if (ev.key === 'ArrowLeft') show(i - 1); else if (ev.key === 'ArrowRight') show(i + 1); });
      document.body.appendChild(dlg); dlg.showModal(); show(i);
    });
  }

  // ---- 시작 ----
  var t = new Promise(function (res) { setTimeout(function () { res({}); }, 2500); });
  var f = fetch(API + '/api/works', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
  Promise.race([f, t]).then(function (cfg) {
    var pc = ((cfg || {}).pages || {})[SLUG];
    if (pc) apply(pc);
    if (!EDIT) return;
    var host = MODE === 'seq' ? main : extraHost();
    if (MODE === 'extra') host.hidden = false;
    var s = document.createElement('script');
    s.src = HERE + 'edit/page-editor.js';
    s.onload = function () {
      window.KJIPageEditor({
        slug: SLUG, project: { title: entry.title }, all: [entry], layout: pc, api: API, single: true, archive: host,
        hint: MODE === 'seq'
          ? '이미지 끌기 = 순서·줄 이동. 이미지를 눌러 여러 장 고른 뒤 "한 줄로". "+ 이미지" = 올리기·Cloudinary 에서 추가.'
          : '이 페이지는 보드 배치라 원래 내용은 그대로 두고, 맨 아래 "추가 이미지" 영역만 편집합니다.',
        resolve: function (layout) {
          var ec = ecOf(layout) || {};
          return [{ e: entry, rows: rowsOf(layout ? ec : null), hidden: (ec.hidden || []).slice(), added: (ec.added || []).slice() }];
        },
        makeImg: addedImg,
        preview: function (layout) { if (layout) apply(layout); else restoreOriginal(); }
      });
    };
    document.body.appendChild(s);
  });
})();
