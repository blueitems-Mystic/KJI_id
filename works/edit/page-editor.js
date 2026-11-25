/* 상세 페이지 편집기 (works/<slug>/?edit=1)
 * - 게시물 순서: 게시물 머리의 ☰ 를 끌기
 * - 이미지 순서·한 줄 묶기: 이미지를 끌어 다른 줄에 넣거나 "새 줄" 칸에 놓기 / 여러 장 선택 → "한 줄로"
 * - 숨기기: 이미지의 "숨기기" (이 페이지에서만, 갤러리에는 그대로)
 * - 새 블록: 바의 "+ 새 블록" → 제목 + 이미지 추가. 블록 삭제: 새 블록은 지워지고, 원래 블록은 숨김(되살리기 가능)
 * - 줄 삭제: 그 줄의 원래 이미지는 숨김, 추가한 이미지는 뺌
 * 저장값 = works-config.pages[slug] = { order, entries: { key: { rows, hidden, added, removed, block: { title } } } } */
(function () {
  var here = document.currentScript.src.replace(/[^/]*$/, '');

  function need(src, test) {
    return test() ? Promise.resolve() : new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function css() {
    if (document.querySelector('link[data-edit-css]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = here + 'edit.css'; l.setAttribute('data-edit-css', '');
    document.head.appendChild(l);
  }

  window.KJIPageEditor = function (ctx) {
    css();
    need(here + 'common.js', function () { return !!window.KJIEdit; })
      .then(function () { return window.KJIEdit.loadSortable(); })
      .then(function () { start(ctx); })
      .catch(function () {
        var s = document.getElementById('status');
        if (s) s.textContent = '편집 도구를 불러오지 못했습니다. 새로 고쳐 주세요.';
      });
  };

  function start(ctx) {
    var E = window.KJIEdit, el = E.el, Sortable = window.Sortable;
    var archive = ctx.archive || document.getElementById('archive');
    var model = [];            // [{ e, rows: [[img]], hidden: [key], added, removed, block }]
    var useDefault = false;    // "기본 배치로" 누른 상태 = 저장 시 이 페이지 편집값 삭제
    var mode = 'edit';         // edit | preview
    var headsOnly = false;

    function load(layout) { model = ctx.resolve(layout); useDefault = !layout; }
    load(ctx.layout);

    function serialize() {
      var entries = {};
      model.forEach(function (m) {
        var ent = { rows: m.rows.map(function (r) { return r.map(function (im) { return im.key; }); }) };
        if (m.hidden.length) ent.hidden = m.hidden.slice();
        if (m.added && m.added.length) ent.added = m.added.slice();
        if (m.removed) ent.removed = true;
        if (m.block) ent.block = { title: m.block.title };
        entries[m.e.key] = ent;
      });
      return { order: model.map(function (m) { return m.e.key; }), entries: entries };
    }

    // ---- 바 ----
    var previewBtn = el('button', { type: 'button', class: 'eb-btn', text: '미리보기' });
    var headsBtn = el('button', { type: 'button', class: 'eb-btn', text: '게시물만 보기', 'aria-pressed': 'false' });
    var resetBtn = el('button', { type: 'button', class: 'eb-btn', text: '기본 배치로' });
    var newBtn = el('button', { type: 'button', class: 'eb-btn fill', text: '+ 새 블록', title: '제목이 있는 새 이미지 블록을 맨 아래에 만듭니다' });
    var bar = E.bar({
      title: ctx.project.title + ' 편집',
      hint: ctx.hint || '☰ 끌기 = 게시물 순서, 이미지 끌기 = 순서·줄 이동. 이미지를 눌러 여러 장 고른 뒤 "한 줄로". "+ 이미지" = 올리기·Cloudinary 에서 추가. "+ 새 블록" / "블록 삭제" = 블록 만들기·지우기.',
      api: ctx.api,
      extra: ctx.single ? [newBtn, previewBtn, resetBtn] : [newBtn, previewBtn, headsBtn, resetBtn],
      collect: function (cfg) {
        if (useDefault) delete cfg.pages[ctx.slug];
        else cfg.pages[ctx.slug] = serialize();
      },
      onReverted: function (cfg) { load((cfg.pages || {})[ctx.slug]); draw(); bar.clean(); }
    });
    function changed() { useDefault = false; bar.changed(); }

    previewBtn.addEventListener('click', function () {
      mode = mode === 'edit' ? 'preview' : 'edit';
      previewBtn.textContent = mode === 'edit' ? '미리보기' : '편집으로';
      previewBtn.className = 'eb-btn' + (mode === 'preview' ? ' fill' : '');
      headsBtn.hidden = mode === 'preview';
      newBtn.hidden = mode === 'preview';
      draw();
    });
    newBtn.addEventListener('click', function () {
      var t = prompt('새 블록 제목', '새 블록');
      if (t === null) return;
      t = t.trim() || '새 블록';
      var key = 'n:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var m = { e: { key: key, title: t, category: '', imgs: [], created: true }, rows: [], hidden: [], added: [], removed: false, block: { title: t } };
      model.push(m);
      changed(); draw();
      var li = root.querySelectorAll('.ed-arc')[model.length - 1];
      if (li) {
        li.scrollIntoView({ block: 'center' });
        var add = li.querySelector('.ed-add');
        if (add) add.click();      // 바로 이미지 고르기
      }
    });
    headsBtn.addEventListener('click', function () {
      headsOnly = !headsOnly;
      headsBtn.setAttribute('aria-pressed', headsOnly ? 'true' : 'false');
      headsBtn.className = 'eb-btn' + (headsOnly ? ' fill' : '');
      root.classList.toggle('heads-only', headsOnly);
    });
    resetBtn.addEventListener('click', function () {
      if (!confirm('이 페이지의 순서·묶음·숨김·추가한 이미지·새 블록을 모두 지우고 원래 배치로 돌릴까요? 저장해야 반영됩니다. (올린 파일은 Cloudinary 에 남습니다)')) return;
      load(null); useDefault = true; bar.changed(); draw();
    });

    var root = el('div', { class: 'ed-root' });
    archive.parentNode.insertBefore(root, archive);
    if (ctx.partial) bar.status('갤러리 이미지를 일부 못 불러왔습니다. 이 상태로 저장하면 빠진 게시물 순서가 흐트러질 수 있으니 새로 고친 뒤 편집하세요.', 'err');

    // ---- 그리기 ----
    function draw() {
      root.hidden = mode !== 'edit';
      archive.hidden = mode === 'edit';
      if (ctx.hideInEdit) ctx.hideInEdit().forEach(function (n) { n.hidden = mode === 'edit'; });
      if (mode === 'preview') {
        var layout = useDefault ? null : serialize();
        ctx.preview(layout);
        return;
      }
      root.textContent = '';
      var list = el('ol', { class: 'ed-list' + (ctx.single ? ' single' : ''), 'aria-label': '게시물 순서' });
      model.forEach(function (m, i) { list.appendChild(entryNode(m, i)); });
      root.appendChild(list);
      Sortable.create(list, {
        handle: '.ed-grip', animation: 150, delay: 120, delayOnTouchOnly: true, draggable: '.ed-arc', ghostClass: 'ed-ghost',
        scroll: true, scrollSensitivity: 120, scrollSpeed: 18, forceAutoScrollFallback: true,
        onEnd: function (ev) {
          if (ev.oldIndex === ev.newIndex) return;
          var m = model.splice(ev.oldIndex, 1)[0];
          model.splice(ev.newIndex, 0, m);
          changed(); renumber(list);
        }
      });
    }
    function renumber(list) {
      Array.prototype.forEach.call(list.children, function (li, i) { li.querySelector('.ed-no').textContent = i + 1; });
    }

    function entryNode(m) {
      var isPage = ctx.single && !m.e.created;
      var li = el('li', { class: 'ed-arc' + (isPage ? ' is-page' : '') + (m.e.created ? ' is-new' : '') + (m.removed ? ' is-removed' : '') });
      function redraw() { li.replaceWith(entryNode(m)); }
      var canRemove = m.e.created || !isPage || ctx.canRemovePage;
      var delBtn = canRemove ? el('button', { type: 'button', class: 'eb-btn sm danger', text: m.removed ? '되살리기' : '블록 삭제',
        title: m.e.created ? '새로 만든 블록을 지웁니다' : '이 블록을 페이지에서 숨깁니다 (되살리기 가능)' }) : null;
      if (delBtn) delBtn.addEventListener('click', function () {
        if (m.removed) { m.removed = false; changed(); redraw(); return; }
        if (m.e.created) {
          if (!confirm('"' + m.e.title + '" 블록을 지울까요? 저장해야 반영됩니다. (올린 파일은 Cloudinary 에 남습니다)')) return;
          model.splice(model.indexOf(m), 1);
          changed(); draw(); return;
        }
        m.removed = true; changed(); redraw();
      });
      if (m.removed) {
        li.appendChild(el('div', { class: 'ed-head all-hidden' }, [
          el('button', { type: 'button', class: 'ed-grip', 'aria-label': m.e.title + ' 순서 옮기기 (끌기)', title: '끌어서 게시물 순서 바꾸기', text: '☰' }),
          el('span', { class: 'ed-no', text: String(model.indexOf(m) + 1) }),
          el('strong', { class: 'ed-title', text: m.e.title }),
          el('span', { class: 'ed-meta', text: '삭제됨 · 페이지에서 안 보임' }),
          el('span', { class: 'ed-tools' }, [delBtn])
        ]));
        return li;
      }
      var sel = {};             // 선택된 이미지 key
      var shown = m.rows.reduce(function (n, r) { return n + r.filter(function (im) { return m.hidden.indexOf(im.key) < 0; }).length; }, 0);
      var total = m.rows.reduce(function (n, r) { return n + r.length; }, 0);
      var joinBtn = el('button', { type: 'button', class: 'eb-btn sm', text: '고른 이미지 한 줄로', disabled: true });
      var addBtn = el('button', { type: 'button', class: 'eb-btn sm fill ed-add', text: '+ 이미지', title: '새로 올리거나 Cloudinary 에서 골라 이 게시물에 추가' });
      var renBtn = m.e.created ? el('button', { type: 'button', class: 'eb-btn sm', text: '제목' }) : null;
      if (renBtn) renBtn.addEventListener('click', function () {
        var t = prompt('블록 제목', m.e.title);
        if (t === null || !t.trim()) return;
        m.e.title = m.block.title = t.trim();
        changed(); redraw();
      });
      addBtn.addEventListener('click', function () {
        E.chooseImages({ api: ctx.api, folder: 'works/' + ctx.slug }).then(function (items) {
          if (!items || !items.length) return;
          m.added = m.added || [];
          var have = {};
          m.rows.forEach(function (r) { r.forEach(function (im) { have[im.key] = 1; }); });
          items.forEach(function (it) {
            var a = { key: 'u:' + it.id, id: it.id, w: it.w || undefined, h: it.h || undefined };
            if (have[a.key]) return;
            have[a.key] = 1;
            m.added.push(a);
            m.rows.push([ctx.makeImg(a)]);
          });
          changed(); redraw();
        });
      });
      var splitAll = el('button', { type: 'button', class: 'eb-btn sm', text: '모두 한 장씩', disabled: m.rows.every(function (r) { return r.length === 1; }) });
      var head = el('div', { class: 'ed-head' + (shown || !total ? '' : ' all-hidden') }, [
        el('button', { type: 'button', class: 'ed-grip', 'aria-label': m.e.title + ' 순서 옮기기 (끌기)', title: '끌어서 게시물 순서 바꾸기', text: '☰' }),
        el('span', { class: 'ed-no' }),
        el('strong', { class: 'ed-title', text: m.e.title }),
        el('span', { class: 'ed-meta', text: [m.e.year, m.e.category, (total ? shown + '/' + total + '장' + (shown ? '' : ' · 페이지에서 안 보임') : '아직 이미지 없음 · "+ 이미지"로 추가')].filter(Boolean).join(' · ') }),
        el('span', { class: 'ed-tools' }, [addBtn, joinBtn, splitAll, renBtn, delBtn])
      ]);
      var rowsBox = el('div', { class: 'ed-rows' });
      li.appendChild(head); li.appendChild(rowsBox);
      li.querySelector('.ed-no').textContent = model.indexOf(m) + 1;

      // DOM 순서 → model
      function readDom() {
        var imgs = {};
        m.rows.forEach(function (r) { r.forEach(function (im) { imgs[im.key] = im; }); });
        m.rows = Array.prototype.map.call(rowsBox.querySelectorAll('.ed-row'), function (row) {
          return Array.prototype.map.call(row.querySelectorAll('.ed-tile'), function (t) { return imgs[t.dataset.key]; });
        }).filter(function (r) { return r.length; });
        changed(); redraw();
      }

      m.rows.concat([[]]).forEach(function (r, ri) {
        var isNew = ri === m.rows.length;
        var row = el('div', { class: 'ed-row' + (isNew ? ' new' : '') + (r.length > 1 ? ' multi' : ''), 'data-hint': isNew ? '여기로 끌어 놓으면 새 줄' : '' });
        r.forEach(function (im) {
          var hid = m.hidden.indexOf(im.key) >= 0;
          var pic = el('img', { src: im.tile || im.src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
          var isAdded = !!im.added;
          var hideBtn = isAdded
            ? el('button', { type: 'button', class: 'ed-hide', text: '빼기', title: '추가한 이미지를 이 페이지에서 뺍니다 (Cloudinary 파일은 남음)' })
            : el('button', { type: 'button', class: 'ed-hide', text: hid ? '보이기' : '숨기기', 'aria-pressed': hid ? 'true' : 'false' });
          var tile = el('div', { class: 'ed-tile' + (hid ? ' is-hidden' : '') + (isAdded ? ' is-added' : ''), 'data-key': im.key, tabindex: '0', role: 'checkbox', 'aria-checked': 'false', 'aria-label': m.e.title + ' 이미지' + (hid ? ' (숨김)' : '') }, [pic, hideBtn]);
          // 세로 높이 고정, 폭은 비율대로 (편집 화면은 작게)
          function fit(w, h) { if (w && h) { tile.style.aspectRatio = w + ' / ' + h; tile.style.width = 'auto'; } }
          fit(im.w, im.h);
          if (!im.w) pic.addEventListener('load', function () { fit(pic.naturalWidth, pic.naturalHeight); });
          hideBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (isAdded) {
              m.added = m.added.filter(function (a) { return a.key !== im.key; });
              m.rows = m.rows.map(function (r) { return r.filter(function (x) { return x.key !== im.key; }); }).filter(function (r) { return r.length; });
              changed(); redraw(); return;
            }
            var at = m.hidden.indexOf(im.key);
            if (at >= 0) m.hidden.splice(at, 1); else m.hidden.push(im.key);
            changed(); redraw();
          });
          function toggle() {
            sel[im.key] = !sel[im.key];
            tile.classList.toggle('sel', !!sel[im.key]);
            tile.setAttribute('aria-checked', sel[im.key] ? 'true' : 'false');
            joinBtn.disabled = Object.keys(sel).filter(function (k) { return sel[k]; }).length < 2;
          }
          tile.addEventListener('click', toggle);
          tile.addEventListener('keydown', function (ev) { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggle(); } });
          row.appendChild(tile);
        });
        if (!isNew) {
          row.appendChild(el('button', { type: 'button', class: 'ed-split ed-rowdel', text: '줄 삭제', title: '원래 이미지는 숨기고, 추가한 이미지는 뺍니다', onclick: function () {
            r.forEach(function (im) {
              if (im.added) m.added = m.added.filter(function (a) { return a.key !== im.key; });
              else if (m.hidden.indexOf(im.key) < 0) m.hidden.push(im.key);
            });
            var at = m.rows.indexOf(r), keep = r.filter(function (im) { return !im.added; });
            if (keep.length) m.rows[at] = keep; else m.rows.splice(at, 1);
            changed(); redraw();
          } }));
        }
        if (r.length > 1) {
          row.appendChild(el('button', { type: 'button', class: 'ed-split', text: '줄 풀기', title: '이 줄의 이미지를 한 장씩 나눕니다', onclick: function () {
            var at = m.rows.indexOf(r);
            m.rows.splice.apply(m.rows, [at, 1].concat(r.map(function (im) { return [im]; })));
            changed(); redraw();
          } }));
        }
        rowsBox.appendChild(row);
        Sortable.create(row, {
          group: 'imgs-' + m.e.key, draggable: '.ed-tile', animation: 150, delay: 150, delayOnTouchOnly: true, ghostClass: 'ed-ghost',
          filter: '.ed-hide', preventOnFilter: false,
          scroll: true, forceAutoScrollFallback: true,
          onEnd: function (ev) { if (ev.from !== ev.to || ev.oldIndex !== ev.newIndex) readDom(); }
        });
      });

      joinBtn.addEventListener('click', function () {
        var keys = Object.keys(sel).filter(function (k) { return sel[k]; });
        if (keys.length < 2) return;
        // 첫 번째로 고른 이미지가 있던 자리에, 페이지 순서대로 모음
        var firstRow = -1, picked = [];
        m.rows.forEach(function (r, ri) { r.forEach(function (im) { if (keys.indexOf(im.key) >= 0) { if (firstRow < 0) firstRow = ri; picked.push(im); } }); });
        var rest = m.rows.map(function (r) { return r.filter(function (im) { return keys.indexOf(im.key) < 0; }); });
        var before = rest.slice(0, firstRow).filter(function (r) { return r.length; });
        var after = rest.slice(firstRow).filter(function (r) { return r.length; });
        m.rows = before.concat([picked], after);
        changed(); redraw();
      });
      splitAll.addEventListener('click', function () {
        m.rows = [].concat.apply([], m.rows).map(function (im) { return [im]; });
        changed(); redraw();
      });
      return li;
    }

    draw();
  }
})();
