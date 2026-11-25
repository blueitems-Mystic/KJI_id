/* 허브 배너 편집기 (works/?edit=1)
 * 칸(패널)마다: 그림 끌기 = 위치, 휠·두 손가락·슬라이더 = 확대, 이미지 바꾸기, 폭 −/+, 삭제, ⠿ 끌기 = 칸 순서
 * 배너마다: + 이미지 칸, + 빈 칸, 기본값으로 (works.json)
 * 저장값 = works-config.banners[postId] = { panels: [...] } */
(function () {
  var here = document.currentScript.src.replace(/[^/]*$/, '');

  function need(src, test) {
    return test() ? Promise.resolve() : new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  window.KJIHubEditor = function (ctx) {
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = here + 'edit.css'; document.head.appendChild(l);
    need(here + 'common.js', function () { return !!window.KJIEdit; })
      .then(function () { return window.KJIEdit.loadSortable(); })
      .then(function () { start(ctx); })
      .catch(function () { alert('편집 도구를 불러오지 못했습니다. 새로 고쳐 주세요.'); });
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function stripYear(s) { return (s || '').trim().replace(/\s*\b(?:19|20)\d{2}\s*$/, '').trim(); }

  function start(ctx) {
    var E = window.KJIEdit, el = E.el, Sortable = window.Sortable;
    var d = ctx.data, man = d.manual || {};
    var cloud = man.cloudName || 'duwi0pqm2';
    var touched = {};          // postId → 'edit' | 'default'
    var textTouched = {};      // postId 또는 '_site' → 'edit' | 'default'
    var galleryP = null;

    var mobileBtn = el('button', { type: 'button', class: 'eb-btn', text: '모바일 비율로 보기', 'aria-pressed': 'false' });
    mobileBtn.addEventListener('click', function () {
      var on = document.body.classList.toggle('preview-mobile');
      mobileBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      mobileBtn.className = 'eb-btn' + (on ? ' fill' : '');
      mobileBtn.textContent = on ? '데스크톱 비율로 보기' : '모바일 비율로 보기';
    });

    var bar = E.bar({
      title: '배너 편집',
      hint: '그림을 끌면 위치, 휠·두 손가락·슬라이더로 확대. ⠿ 를 끌면 칸 순서.',
      api: ctx.api,
      extra: [mobileBtn],
      collect: function (cfg) {
        Object.keys(touched).forEach(function (id) {
          var post = find(id);
          if (touched[id] === 'default') delete cfg.banners[id];
          else cfg.banners[id] = { panels: clean(post.banner.panels) };
        });
        cfg.texts.posts = cfg.texts.posts || {};
        Object.keys(textTouched).forEach(function (id) {
          var def = textTouched[id] === 'default';
          if (id === '_site') {
            if (def) delete cfg.texts.site;
            else cfg.texts.site = { title: d.site.title || '', intro: d.site.intro || '' };
            return;
          }
          var post = find(id);
          if (def) { delete cfg.texts.posts[id]; return; }
          var t = {};
          ['meta', 'title', 'summary', 'textAlign'].forEach(function (k) { t[k] = post[k] || ''; });
          cfg.texts.posts[id] = t;
        });
      },
      onReverted: function (cfg) {
        var b = cfg.banners || {};
        d.posts.forEach(function (post) {
          post.banner.panels = b[post.id] && b[post.id].panels && b[post.id].panels.length ? b[post.id].panels : clone(post.defaultPanels);
          var t = ((cfg.texts || {}).posts || {})[post.id] || {};
          ['meta', 'title', 'summary', 'textAlign'].forEach(function (k) { post[k] = typeof t[k] === 'string' ? t[k] : post.defaultText[k]; });
          redraw(post);
        });
        var ts = (cfg.texts || {}).site || {};
        d.site.title = typeof ts.title === 'string' ? ts.title : d.defaultSite.title;
        d.site.intro = typeof ts.intro === 'string' ? ts.intro : d.defaultSite.intro;
        siteForm.sync();
        touched = {}; textTouched = {};
      }
    });

    function find(id) { return d.posts.filter(function (p) { return p.id === id; })[0]; }
    function clean(panels) {
      return panels.map(function (p) {
        if (p.spacer) return { flex: p.flex || 1, spacer: true };
        var o = { src: p.src, flex: p.flex || 1, x: Math.round(p.x == null ? 50 : p.x), y: Math.round(p.y == null ? 50 : p.y), zoom: Math.round((p.zoom || 1) * 100) / 100 };
        if (p.srcSmall) o.srcSmall = p.srcSmall;
        if (p.alt) o.alt = p.alt;
        return o;
      });
    }
    function mark(post) { touched[post.id] = 'edit'; bar.changed(); }

    // ---- 이미지 후보: 이 게시물 ----
    function gallery() {
      if (!galleryP) galleryP = fetch(ctx.api + '/api/gallery', { cache: 'no-store' }).then(function (r) { return r.json(); });
      return galleryP;
    }
    function postImages(post) {
      var P = (d.projects || []).filter(function (p) { return p.id === post.id; })[0];
      if (!P) return pageImages(post);
      var dir = P.dir || P.id, out = [];
      (P.local || []).forEach(function (l) {
        l.images.forEach(function (im) { var u = dir + '/img/' + im.f; out.push({ src: u, thumb: u, label: l.title + ' · ' + im.f, alt: l.title }); });
      });
      (P.features || []).forEach(function (f) {
        f.images.forEach(function (im) { out.push({ src: im.src, thumb: im.src, label: f.title, alt: f.title }); });
      });
      if (!P.gallery) return Promise.resolve(out);
      var alias = P.projectAlias || man.projectAlias || {};
      var match = (P.gallery.match || []).map(norm);
      return gallery().then(function (g) {
        var gi = [];
        (g.groups || []).forEach(function (grp) {
          var pn = stripYear(grp.project);
          if (match.indexOf(norm(alias[pn] || pn)) < 0) return;
          (grp.images || []).forEach(function (im) {
            if (im.visible === false) return;
            var it = E.cldItem(g.cloudName || cloud, im.imageId, stripYear(grp.title) + ' · ' + im.imageId);
            it.alt = stripYear(grp.title);
            gi.push(it);
          });
        });
        return gi.concat(out);
      }).catch(function () { return out; });
    }
    // 컨셉군 완성 페이지: 그 페이지의 <img> 를 모음 (허브 기준 상대경로로)
    function pageImages(post) {
      var current = post.banner.panels.filter(function (p) { return !p.spacer; }).map(function (p) { return { src: p.src, srcSmall: p.srcSmall, thumb: p.srcSmall || p.src, label: '지금 배너 · ' + p.src.split('/').pop(), alt: p.alt }; });
      if (!post.href) return Promise.resolve(current);
      var pageUrl = new URL(post.href, location.href), hub = new URL('./', location.href).href;
      return fetch(pageUrl, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html'), seen = {}, out = [];
        Array.prototype.forEach.call(doc.querySelectorAll('img[src]'), function (img) {
          var abs = new URL(img.getAttribute('src'), pageUrl).href;
          if (seen[abs] || !/\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(abs) && abs.indexOf('res.cloudinary.com') < 0) return;
          seen[abs] = 1;
          var rel = abs.indexOf(hub) === 0 ? abs.slice(hub.length) : abs;
          out.push({ src: rel, thumb: rel, label: rel.split('/').pop(), alt: img.getAttribute('alt') || '' });
        });
        return current.concat(out);
      }).catch(function () { return current; });
    }
    function choose(post) {
      return E.pickImage([
        { label: '이 게시물', load: function () { return postImages(post); } },
        { label: 'Cloudinary 전체', load: function () { return E.cloudinaryAll(ctx.api, cloud); } }
      ], { api: ctx.api, folder: 'works/banners', cloud: cloud });
    }

    // ---- 배너마다 도구 ----
    function redraw(post) {
      var old = document.getElementById('work-' + post.id);
      var li = ctx.renderPost(post, d.posts.indexOf(post));
      old.replaceWith(li);
      decorate(post, li);
    }

    function decorate(post, li) {
      var banner = li.querySelector('.banner');
      var panels = banner.querySelectorAll('.panel');
      var tools = el('div', { class: 'bn-tools' }, [
        el('span', { class: 'bn-name', text: post.title }),
        el('button', { type: 'button', class: 'eb-btn sm', text: '+ 이미지 칸', onclick: function () {
          choose(post).then(function (it) {
            if (!it) return;
            post.banner.panels.push({ src: it.src, srcSmall: it.srcSmall, alt: it.alt || '', flex: 1, x: 50, y: 50, zoom: 1 });
            mark(post); redraw(post);
          });
        } }),
        el('button', { type: 'button', class: 'eb-btn sm', text: '+ 빈 칸', title: '글이 놓일 빈 자리 (모바일에서는 숨겨짐)', onclick: function () {
          post.banner.panels.push({ flex: 1, spacer: true }); mark(post); redraw(post);
        } }),
        el('button', { type: 'button', class: 'eb-btn sm', text: '기본값으로', title: 'works.json 에 적힌 원래 배너로', onclick: function () {
          if (!confirm(post.title + ' 배너를 works.json 기본값으로 돌릴까요? 저장해야 반영됩니다.')) return;
          post.banner.panels = clone(post.defaultPanels);
          touched[post.id] = 'default'; bar.changed(); redraw(post);
        } }),
        el('span', { class: 'bn-state', text: touched[post.id] === 'default' ? '기본값으로 돌림 (저장 전)' : touched[post.id] ? '바뀜 (저장 전)' : '' })
      ]);
      li.insertBefore(tools, li.firstChild);
      tools.insertBefore(textToggle(post, li), tools.querySelector('.bn-state'));

      post.banner.panels.forEach(function (p, i) { panelTools(post, p, panels[i]); });

      Sortable.create(banner, {
        handle: '.pn-grip', draggable: '.panel', animation: 150, ghostClass: 'ed-ghost',
        onEnd: function (ev) {
          if (ev.oldIndex === ev.newIndex) return;
          var m = post.banner.panels.splice(ev.oldIndex, 1)[0];
          post.banner.panels.splice(ev.newIndex, 0, m);
          mark(post); redraw(post);
        }
      });
    }

    // ---- 배너 글 (분류·제목·소개·글 위치) ----
    function field(label, input) { return el('label', { class: 'tx-field' }, [el('span', { text: label }), input]); }
    function swapCaption(post, li) {
      var fresh = ctx.renderPost(post, d.posts.indexOf(post)).querySelector('.caption');
      var old = li.querySelector('.caption');
      if (old && fresh) old.replaceWith(fresh);
    }
    function textToggle(post, li) {
      var open = !!openText[post.id];
      var btn = el('button', { type: 'button', class: 'eb-btn sm' + (open ? ' fill' : ''), text: '글 편집', 'aria-expanded': open ? 'true' : 'false' });
      btn.addEventListener('click', function () { openText[post.id] = !openText[post.id]; redraw(post); });
      if (open) setTimeout(function () { li.insertBefore(textForm(post, li), li.children[1]); });
      return btn;
    }
    var openText = {};
    function textForm(post, li) {
      function inp(k, multi) {
        var n = el(multi ? 'textarea' : 'input', multi ? { rows: '2' } : { type: 'text' });
        n.value = post[k] || '';
        n.addEventListener('input', function () { post[k] = n.value; textTouched[post.id] = 'edit'; bar.changed(); swapCaption(post, li); });
        return n;
      }
      var align = el('select', null, [el('option', { value: 'left', text: '왼쪽' }), el('option', { value: 'right', text: '오른쪽' })]);
      align.value = post.textAlign === 'right' ? 'right' : 'left';
      align.addEventListener('change', function () { post.textAlign = align.value; textTouched[post.id] = 'edit'; bar.changed(); swapCaption(post, li); });
      return el('div', { class: 'tx-form' }, [
        field('분류', inp('meta')), field('제목', inp('title')), field('글 위치', align),
        el('div', { class: 'tx-wide' }, [field('소개', inp('summary', true))]),
        el('button', { type: 'button', class: 'eb-btn sm', text: '글 기본값으로', title: 'works.json 에 적힌 원래 문구로', onclick: function () {
          ['meta', 'title', 'summary', 'textAlign'].forEach(function (k) { post[k] = post.defaultText[k]; });
          textTouched[post.id] = 'default'; bar.changed(); redraw(post);
        } })
      ]);
    }
    // 허브 머리글 (사이트 제목·소개)
    var siteForm = (function () {
      var t = el('input', { type: 'text' }), i = el('textarea', { rows: '2' });
      function sync() {
        t.value = d.site.title || ''; i.value = d.site.intro || '';
        document.getElementById('site-title').textContent = d.site.title || '';
        document.getElementById('site-intro').textContent = d.site.intro || '';
      }
      function upd() {
        d.site.title = t.value; d.site.intro = i.value;
        document.getElementById('site-title').textContent = t.value;
        document.getElementById('site-intro').textContent = i.value;
        textTouched._site = 'edit'; bar.changed();
      }
      t.addEventListener('input', upd); i.addEventListener('input', upd);
      var node = el('div', { class: 'tx-form site' }, [
        el('strong', { class: 'tx-title', text: '허브 머리글' }),
        field('사이트 제목', t), el('div', { class: 'tx-wide' }, [field('소개', i)]),
        el('button', { type: 'button', class: 'eb-btn sm', text: '기본값으로', onclick: function () {
          d.site.title = d.defaultSite.title; d.site.intro = d.defaultSite.intro; sync();
          textTouched._site = 'default'; bar.changed();
        } })
      ]);
      sync();
      return { node: node, sync: sync };
    })();
    var masthead = document.querySelector('.masthead');
    if (masthead) masthead.appendChild(siteForm.node);

    function panelTools(post, p, panel) {
      var img = panel.querySelector('img');
      var readout = el('span', { class: 'pn-readout' });
      function show() {
        readout.textContent = p.spacer ? '빈 칸 · 폭 ' + (p.flex || 1) : 'x ' + Math.round(p.x == null ? 50 : p.x) + '  y ' + Math.round(p.y == null ? 50 : p.y) + '  ×' + (p.zoom || 1).toFixed(2) + ' · 폭 ' + (p.flex || 1);
      }
      function widen(dlt) {
        p.flex = Math.max(1, Math.min(12, (p.flex || 1) + dlt));
        panel.style.flex = p.flex + ' 1 0'; show(); mark(post);
      }
      var zoom = el('input', { type: 'range', class: 'pn-zoom', min: '1', max: '4', step: '0.01', value: String(p.zoom || 1), 'aria-label': '확대' });
      zoom.addEventListener('input', function () { p.zoom = +zoom.value; ctx.applyCrop(img, p); show(); mark(post); });
      var bits = [
        el('button', { type: 'button', class: 'pn-grip', title: '끌어서 칸 순서 바꾸기', 'aria-label': '칸 순서 옮기기', text: '⠿' }),
        el('button', { type: 'button', class: 'pn-btn', text: p.spacer ? '이미지 넣기' : '이미지 바꾸기', onclick: function () {
          choose(post).then(function (it) {
            if (!it) return;
            p.src = it.src; p.srcSmall = it.srcSmall; p.alt = it.alt || p.alt || '';
            if (!it.srcSmall) delete p.srcSmall;
            if (p.spacer) { delete p.spacer; p.x = 50; p.y = 50; p.zoom = 1; }
            mark(post); redraw(post);
          });
        } }),
        el('button', { type: 'button', class: 'pn-btn', text: '−', 'aria-label': '칸 좁게', onclick: function () { widen(-1); } }),
        el('button', { type: 'button', class: 'pn-btn', text: '+', 'aria-label': '칸 넓게', onclick: function () { widen(1); } }),
        p.spacer ? null : zoom,
        el('button', { type: 'button', class: 'pn-btn danger', text: '삭제', onclick: function () {
          if (post.banner.panels.length < 2) { alert('배너에는 칸이 하나 이상 있어야 합니다.'); return; }
          post.banner.panels.splice(post.banner.panels.indexOf(p), 1); mark(post); redraw(post);
        } })
      ];
      var tb = el('div', { class: 'pn-tools' }, bits);
      panel.appendChild(tb);
      panel.appendChild(readout);
      show();
      if (p.spacer || !img) return;

      // 끌기 = 위치, 두 손가락 = 확대
      var pts = {}, start = null, pinch = null;
      function onTools(e) { return e.target.closest && e.target.closest('.pn-tools'); }
      panel.addEventListener('pointerdown', function (e) {
        if (onTools(e)) return;
        e.preventDefault();
        panel.setPointerCapture(e.pointerId);
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pts);
        if (ids.length === 2) {
          var a = pts[ids[0]], b = pts[ids[1]];
          pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: p.zoom || 1 }; start = null;
        } else if (ids.length === 1) {
          start = { px: e.clientX, py: e.clientY, x: p.x == null ? 50 : p.x, y: p.y == null ? 50 : p.y };
          panel.classList.add('dragging');
        }
      });
      panel.addEventListener('pointermove', function (e) {
        if (!pts[e.pointerId]) return;
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pts);
        if (pinch && ids.length === 2) {
          var a = pts[ids[0]], b = pts[ids[1]];
          p.zoom = Math.max(1, Math.min(4, Math.round(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist * 100) / 100));
          zoom.value = p.zoom;
        } else if (start) {
          var r = panel.getBoundingClientRect(), z = p.zoom || 1;
          // 끌면 그림이 손을 따라 움직이도록: 초점은 반대로 이동
          p.x = Math.max(0, Math.min(100, start.x - (e.clientX - start.px) / r.width * 100 / z));
          p.y = Math.max(0, Math.min(100, start.y - (e.clientY - start.py) / r.height * 100 / z));
        } else return;
        ctx.applyCrop(img, p); show(); mark(post);
      });
      function end(e) {
        delete pts[e.pointerId];
        if (Object.keys(pts).length < 2) pinch = null;
        if (!Object.keys(pts).length) { start = null; panel.classList.remove('dragging'); }
      }
      panel.addEventListener('pointerup', end);
      panel.addEventListener('pointercancel', end);
      panel.addEventListener('wheel', function (e) {
        if (onTools(e)) return;
        e.preventDefault();
        p.zoom = Math.max(1, Math.min(4, Math.round((p.zoom || 1) * (e.deltaY < 0 ? 1.06 : 1 / 1.06) * 100) / 100));
        zoom.value = p.zoom;
        ctx.applyCrop(img, p); show(); mark(post);
      }, { passive: false });
    }

    d.posts.forEach(function (post) { decorate(post, document.getElementById('work-' + post.id)); });
  }
})();
