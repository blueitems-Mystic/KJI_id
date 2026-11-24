(function () {
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // ---------- 데이터: 갤러리 API(Cloudinary) + 레포 이미지 + 연결 항목 ----------
  var YEAR_RE = /\s*\b((?:19|20)\d{2})\s*$/;
  function splitYear(s) {
    s = (s || '').trim();
    var m = s.match(YEAR_RE);
    return m ? { name: s.slice(0, m.index).trim(), year: +m[1] } : { name: s, year: null };
  }
  function cld(cloud, id, t) { return 'https://res.cloudinary.com/' + cloud + '/image/upload/' + t + '/' + id; }
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  function galleryEntries(g, P) {
    var cloud = g.cloudName || P.cloudName, alias = P.projectAlias || {}, skip = P.skipTitles || [];
    var match = (P.gallery.match || []).map(norm);
    return (g.groups || []).map(function (grp) {
      var t = splitYear(grp.title), p = splitYear(grp.project);
      var pname = norm(alias[p.name] || p.name);
      if (match.indexOf(pname) < 0) return null;
      var images = (grp.images || []).filter(function (i) { return i.visible !== false; }).map(function (i) { return i.imageId; });
      var mainId = grp.thumbnail && images.indexOf(grp.thumbnail.imageId) >= 0 ? grp.thumbnail.imageId : images[0];
      var ids = mainId ? [mainId].concat(images.filter(function (id) { return id !== mainId; })) : [];
      var year = t.year || p.year;
      var crop = grp.thumbnail && grp.thumbnail.imageId === mainId ? grp.thumbnail.crop : null;
      return {
        title: t.name, year: year, category: grp.category || '',
        sortYear: year || P.estimatedYear || 0, known: !!year, pos: grp.gridPosition || 0,
        thumb: function (w, h) {
          var tr = 'c_fill,w_' + w + ',h_' + h + ',q_auto,f_auto';
          if (crop && crop.width > 0 && crop.height > 0) tr = 'c_crop,x_' + Math.round(crop.x) + ',y_' + Math.round(crop.y) + ',w_' + Math.round(crop.width) + ',h_' + Math.round(crop.height) + '/' + tr;
          return cld(cloud, ids[0], tr);
        },
        imgs: ids.map(function (id) {
          return {
            full: cld(cloud, id, 'c_limit,w_2400,q_auto,f_auto'),
            src: cld(cloud, id, 'c_limit,w_1600,q_auto,f_auto'),
            srcset: [800, 1200, 1600, 2400].map(function (w) { return cld(cloud, id, 'c_limit,w_' + w + ',q_auto,f_auto') + ' ' + w + 'w'; }).join(', ')
          };
        })
      };
    }).filter(function (e) { return e && e.title && skip.indexOf(e.title) < 0 && e.imgs.length; });
  }

  // 레포 안 이미지 (<dir>/img, <dir>/th). 이 페이지(<slug>/)에서 보는 상대경로
  function localEntries(P) {
    return (P.local || []).map(function (l, i) {
      return {
        title: l.title, year: l.year || null, category: l.category || '',
        sortYear: l.sortYear || l.year || P.estimatedYear || 0, known: !!l.year, pos: 100000 + i,
        thumb: function () { return '../' + P.dir + '/th/' + l.images[0].f; },
        imgs: l.images.map(function (im) {
          var u = '../' + P.dir + '/img/' + im.f;
          return { full: u, src: u, w: im.w, h: im.h };
        })
      };
    });
  }

  // 다른 페이지로 이어지는 항목 (과정 페이지 등). top:true = 맨 위, after:"제목" = 그 게시물 바로 밑
  function featureEntries(P) {
    return (P.features || []).map(function (f) {
      return {
        title: f.title, year: f.year || null, category: f.category || '', link: f.link, linkLabel: f.linkLabel,
        sortYear: 0, known: !!f.year, pos: 0, top: !!f.top, after: f.after,
        thumb: function () { return '../' + f.thumb; },
        imgs: f.images.map(function (im) { var u = '../' + im.src; return { full: u, src: u, w: im.w, h: im.h }; })
      };
    });
  }

  function arrange(list) {
    return list.slice().sort(function (a, b) { return (b.sortYear - a.sortYear) || (b.known - a.known) || (a.pos - b.pos); });
  }
  // 수동 위치 조정: "제목" 또는 "제목 · 분류" 로 찾아 move 를 after 바로 밑으로. 규칙 순서대로 적용
  function placeAfter(list, rules) {
    function find(key) {
      var k = key.split(' · '), title = norm(k[0]), cat = (k[1] || '').trim();
      for (var i = 0; i < list.length; i++) if (norm(list[i].title) === title && (!cat || list[i].category === cat)) return i;
      return -1;
    }
    (rules || []).forEach(function (r) {
      var from = find(r.move);
      if (from < 0 || find(r.after) < 0) return;
      var e = list.splice(from, 1)[0];
      list.splice(find(r.after) + 1, 0, e);
    });
    return list;
  }
  function withFeatures(list, feats) {
    var tops = feats.filter(function (f) { return f.top; });
    feats.filter(function (f) { return !f.top; }).forEach(function (f) {
      var at = -1;
      list.forEach(function (e, i) { if (at < 0 && f.after && norm(e.title) === norm(f.after)) at = i; });
      if (at < 0) list.push(f); else list.splice(at + 1, 0, f);
    });
    return tops.concat(list);
  }

  var lb = { set: [], i: 0, title: '' };
  var dlg = document.getElementById('lb');
  function lbShow() {
    var img = document.getElementById('lb-img');
    img.src = lb.set[lb.i].src; img.alt = lb.set[lb.i].alt;
    document.getElementById('lb-count').textContent = (lb.i + 1) + ' / ' + lb.set.length;
    document.getElementById('lb-title').textContent = lb.title;
    var one = lb.set.length < 2;
    document.getElementById('lb-prev').hidden = one; document.getElementById('lb-next').hidden = one;
  }
  function lbStep(d) { lb.i = (lb.i + d + lb.set.length) % lb.set.length; lbShow(); }
  function lbOpen(set, i, title) { lb.set = set; lb.i = i; lb.title = title; lbShow(); if (!dlg.open) dlg.showModal(); }
  document.getElementById('lb-prev').addEventListener('click', function () { lbStep(-1); });
  document.getElementById('lb-next').addEventListener('click', function () { lbStep(1); });
  document.getElementById('lb-close').addEventListener('click', function () { dlg.close(); });
  document.getElementById('lb-stage').addEventListener('click', function (e) { if (e.target.id === 'lb-stage') dlg.close(); });
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbStep(1); }
  });
  dlg.addEventListener('close', function () { document.getElementById('lb-img').removeAttribute('src'); });

  function render(list) {
    var box = document.getElementById('archive');
    box.textContent = '';
    list.forEach(function (e, n) {
      var alt = e.title + (e.year ? ' (' + e.year + ')' : '');
      var meta = [e.year, e.category].filter(Boolean).join(' · ');
      var set = e.imgs.map(function (im, k) { return { src: im.full, alt: alt + ' ' + (k + 1) }; });
      var links = e.imgs.map(function (im, k) {
        var at = { src: im.src, alt: set[k].alt, decoding: 'async', loading: n === 0 && k === 0 ? 'eager' : 'lazy' };
        if (im.srcset) { at.srcset = im.srcset; at.sizes = '(max-width: 1200px) calc(100vw - 32px), 1120px'; }
        if (im.w) { at.width = im.w; at.height = im.h; }
        var a = el('a', { href: im.full, 'aria-label': alt + ' ' + (k + 1) + '번째 크게 보기' }, [el('img', at)]);
        a.addEventListener('click', function (ev) { ev.preventDefault(); lbOpen(set, k, alt); });
        return a;
      });
      var more = e.link ? el('p', { class: 'arc-link' }, [el('a', { class: 'kji-btn kji-btn-line', href: e.link, text: (e.linkLabel || '과정 자세히 보기') + ' →' })]) : null;
      box.appendChild(el('article', { class: 'arc', id: e.slug }, [
        el('header', { class: 'arc-head' }, [el('h2', { text: e.title }), meta ? el('p', { class: 'arc-meta', text: meta }) : null])
      ].concat(links, [more])));
    });
  }

  // ---------- 썸네일 인덱스 ----------
  // 게시물마다 주소용 이름 (#rick-blood). 같은 제목은 -2, -3
  function addSlugs(list) {
    var seen = {};
    list.forEach(function (e) {
      var s = e.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'work';
      seen[s] = (seen[s] || 0) + 1;
      e.slug = seen[s] > 1 ? s + '-' + seen[s] : s;
    });
    return list;
  }

  var WIDE = window.matchMedia('(min-width: 1500px)');
  var MOBILE = window.matchMedia('(max-width: 760px)');
  var $ = function (id) { return document.getElementById(id); };
  var idx = {};             // slug → { e, n, g, row, ov }
  var projs = [];           // { name, items, btn, ul }
  var total = 0;
  var jumpFix = null;       // 이동 직후 위쪽 이미지가 늦게 로드돼 밀리는 것 보정

  // 도착 위치: 넓은 화면은 위 24px, 그 밖은 상단 바(48px) 아래
  function offset() { return WIDE.matches ? 24 : 72; }
  function articleTop(id) {
    var a = $(id);
    return a ? a.getBoundingClientRect().top + window.pageYOffset - offset() : null;
  }
  function stopFix() { if (jumpFix) { clearTimeout(jumpFix.timer); jumpFix.ro.disconnect(); jumpFix = null; } }
  function jumpTo(id, flash) {
    var y = articleTop(id);
    if (y == null) return;
    stopFix();
    window.scrollTo(0, y);
    var ro = new ResizeObserver(function () {
      var y2 = articleTop(id);
      if (y2 != null && Math.abs(window.pageYOffset - y2) > 2) window.scrollTo(0, y2);
    });
    ro.observe($('archive'));
    jumpFix = { ro: ro, timer: setTimeout(stopFix, 4000) };
    setActive(id);
    showBar(true);
    if (flash) { var a = $(id); a.classList.remove('flash'); void a.offsetWidth; a.classList.add('flash'); }
  }
  // 사용자가 직접 스크롤하면 보정 중단
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) {
    window.addEventListener(t, function (ev) {
      if (!jumpFix) return;
      if (ev.target.closest && ev.target.closest('.toc, .topbar, .ov')) return;
      stopFix();
    }, { passive: true });
  });

  function go(id) {
    // 뒤로가기로 이전 위치 복귀: 현재 위치를 기록해 두고 새 주소를 쌓음
    history.replaceState({ y: window.pageYOffset }, '');
    history.pushState({ id: id }, '', '#' + id);
    jumpTo(id, true);
  }
  window.addEventListener('popstate', function (ev) {
    stopFix();
    var s = ev.state || {};
    if (typeof s.y === 'number') window.scrollTo(0, s.y);
    else if (location.hash.length > 1) jumpTo(decodeURIComponent(location.hash.slice(1)), true);
  });
  function toTop() {
    stopFix();
    history.replaceState({ y: window.pageYOffset }, '');
    history.pushState({ y: 0 }, '', location.pathname + location.search);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- 펼침: 현재 프로젝트만 자동으로 펼침. 직접 접은 건 프로젝트가 바뀔 때까지 존중
  function setOpen(p, open) {
    p.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    p.ul.hidden = !open;
  }
  var activeId = null, activeG = -1;
  function setActive(id) {
    if (id === activeId || !idx[id]) return;
    if (activeId && idx[activeId]) { idx[activeId].row.removeAttribute('aria-current'); idx[activeId].ov.removeAttribute('aria-current'); }
    activeId = id;
    var it = idx[id];
    it.row.setAttribute('aria-current', 'true');
    it.ov.setAttribute('aria-current', 'true');
    if (it.g !== activeG) {
      activeG = it.g;
      projs.forEach(function (p, i) { setOpen(p, i === activeG); });
    }
    var pct = ((it.n + 1) / total * 100) + '%';
    var cnt = (it.n + 1) + ' / ' + total;
    $('toc-count').textContent = cnt; $('tb-count').textContent = cnt;
    $('toc-prog').style.width = pct; $('tb-prog').style.width = pct;
    var proj = projs[it.g].name;
    $('toc-now').textContent = '';
    $('toc-now').appendChild(el('span', { text: proj + ' · ' }));
    $('toc-now').appendChild(document.createTextNode(it.e.title));
    $('tb-now').textContent = proj + ' · ' + it.e.title;
    // 목차 안에서만 따라 움직여 현재 줄이 항상 보이게 (페이지는 건드리지 않음)
    if (WIDE.matches && !it.row.closest('[hidden]')) {
      var sc = $('toc-list'), r = it.row.getBoundingClientRect(), sr = sc.getBoundingClientRect();
      if (r.top < sr.top + 48 || r.bottom > sr.bottom - 48) sc.scrollTop += (r.top - sr.top) - sr.height / 2 + r.height / 2;
    }
  }

  // ---- 상단 바(넓은 화면 아님): 목록 시작 지점을 지나면 표시, 모바일은 내릴 때 숨고 올릴 때 나타남
  var bar = $('topbar'), lastY = 0;
  function showBar(force) {
    var past = $('archive').getBoundingClientRect().top < 0;
    var y = window.pageYOffset, dy = y - lastY;
    var on = past;
    if (past && MOBILE.matches && !force && !jumpFix) {
      if (Math.abs(dy) < 6) return;           // 작은 흔들림은 무시 (lastY 유지)
      on = dy < 0;
    }
    bar.classList.toggle('on', on);
    lastY = y;
  }
  window.addEventListener('scroll', function () { showBar(false); }, { passive: true });

  function metaOf(e) { return [e.year, e.category, e.imgs.length + '장'].filter(Boolean).join(' · '); }

  var ov = $('ov');
  function openOv() {
    ov.showModal();
    var cur = activeId && idx[activeId].ov;
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  $('ov-close').addEventListener('click', function () { ov.close(); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ov]'), function (b) { b.addEventListener('click', openOv); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-top]'), function (b) { b.addEventListener('click', toTop); });

  function buildIndex(list, pname) {
    total = list.length;
    // 프로젝트별로 묶되, 묶음 순서와 묶음 안 순서는 페이지 순서(연도순) 그대로
    var at = {};
    list.forEach(function (e, n) {
      var k = pname;
      if (!(k in at)) { at[k] = projs.length; projs.push({ name: k, items: [] }); }
      projs[at[k]].items.push(e);
      idx[e.slug] = { e: e, n: n, g: at[k] };
    });
    $('ov-count').textContent = total + '개 작업';

    projs.forEach(function (p, gi) {
      var ulId = 'proj-' + gi;
      p.btn = el('button', { type: 'button', class: 'proj-btn', 'aria-expanded': 'false', 'aria-controls': ulId }, [
        el('span', { text: p.name }), el('span', { class: 'n', text: '· ' + p.items.length }), el('span', { class: 'chev', 'aria-hidden': 'true', text: '▸' })
      ]);
      p.btn.addEventListener('click', function () {
        var open = p.btn.getAttribute('aria-expanded') === 'true';
        if (open) setOpen(p, false);
        else if (gi === activeG) setOpen(p, true);
        else go(p.items[0].slug);
      });
      p.ul = el('ul', { class: 'proj-items', id: ulId, hidden: '' });
      var grid = el('ul', { class: 'ov-grid' });
      p.items.forEach(function (e) {
        var row = el('a', { class: 'item', href: '#' + e.slug }, [
          el('img', { src: e.thumb(96, 120), alt: '', loading: 'lazy', decoding: 'async', width: '48', height: '60' }),
          el('span', null, [el('span', { class: 'item-t', text: e.title }), el('span', { class: 'item-m', text: metaOf(e) })])
        ]);
        row.addEventListener('click', function (ev) { ev.preventDefault(); go(e.slug); });
        p.ul.appendChild(el('li', null, [row]));
        var card = el('a', { href: '#' + e.slug }, [
          el('img', { src: e.thumb(300, 375), alt: '', loading: 'lazy', decoding: 'async', width: '150', height: '188' }),
          el('span', { class: 'ov-t', text: e.title }), el('span', { class: 'ov-m', text: metaOf(e) })
        ]);
        card.addEventListener('click', function (ev) { ev.preventDefault(); ov.close(); go(e.slug); });
        grid.appendChild(el('li', null, [card]));
        idx[e.slug].row = row; idx[e.slug].ov = card;
      });
      $('toc-list').appendChild(el('section', { class: 'proj' }, [p.btn, p.ul]));
      $('ov-body').appendChild(el('section', { class: 'ov-group' }, [
        el('h3', { class: 'ov-label' }, [document.createTextNode(p.name), el('span', { class: 'n', text: p.items.length })]), grid
      ]));
    });

    $('toc').hidden = false; bar.hidden = false;
    document.body.classList.add('has-toc');

    // 화면 위쪽 40% 지점에 걸린 게시물 = 현재 게시물
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
    }, { rootMargin: '-40% 0px -59% 0px' });
    list.forEach(function (e) { io.observe($(e.slug)); });
    setActive(list[0].slug);

    var h = decodeURIComponent(location.hash.slice(1));
    if (h && idx[h]) jumpTo(h, true);
  }

  function fail(msg) {
    var s = document.getElementById('status');
    if (s) s.textContent = msg || '이미지를 불러오지 못했습니다. 페이지를 새로 고쳐 주세요.';
  }
  var SLUG = window.KJI_PROJECT;
  fetch('../works.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var P = (d.projects || []).filter(function (p) { return p.id === SLUG; })[0];
      if (!P) throw new Error('no project');
      P.dir = P.dir || P.id;
      var man = d.manual || {};
      P.cloudName = P.cloudName || man.cloudName; P.galleryApi = P.galleryApi || man.galleryApi;
      P.projectAlias = P.projectAlias || man.projectAlias; P.skipTitles = P.skipTitles || man.skipTitles;
      document.getElementById('title').textContent = P.title;
      document.getElementById('intro').textContent = P.summary || '';
      var pending = P.gallery
        ? fetch(P.galleryApi).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (g) { return galleryEntries(g, P); })
        : Promise.resolve([]);
      return pending.catch(function () { return null; }).then(function (ge) {
        var all = (ge || []).concat(localEntries(P));
        var list = addSlugs(withFeatures(placeAfter(arrange(all), P.placeAfter), featureEntries(P)));
        if (!list.length) return fail();
        render(list);
        buildIndex(list, P.title);
        if (ge === null) document.getElementById('archive').appendChild(el('p', { class: 'status', text: '일부 이미지를 불러오지 못했습니다. 새로 고침하면 다시 시도합니다.' }));
      });
    })
    .catch(function () { fail(); });
})();
