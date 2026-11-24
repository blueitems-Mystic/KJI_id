/* 상세 페이지 편집기 (works/<slug>/?edit=1)
 * - 게시물 순서: 게시물 머리의 ☰ 를 끌기
 * - 이미지 순서·한 줄 묶기: 이미지를 끌어 다른 줄에 넣거나 "새 줄" 칸에 놓기 / 여러 장 선택 → "한 줄로"
 * - 숨기기: 이미지의 "숨기기" (이 페이지에서만, 갤러리에는 그대로)
 * 저장값 = works-config.pages[slug] = { order, entries: { key: { rows, hidden } } } */
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
    var archive = document.getElementById('archive');
    var model = [];            // [{ e, rows: [[img]], hidden: [key] }]
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
        entries[m.e.key] = ent;
      });
      return { order: model.map(function (m) { return m.e.key; }), entries: entries };
    }

    // ---- 바 ----
    var previewBtn = el('button', { type: 'button', class: 'eb-btn', text: '미리보기' });
    var headsBtn = el('button', { type: 'button', class: 'eb-btn', text: '게시물만 보기', 'aria-pressed': 'false' });
    var resetBtn = el('button', { type: 'button', class: 'eb-btn', text: '기본 배치로' });
    var bar = E.bar({
      title: ctx.project.title + ' 편집',
      hint: '☰ 끌기 = 게시물 순서, 이미지 끌기 = 순서·줄 이동. 이미지를 눌러 여러 장 고른 뒤 "한 줄로".',
      api: ctx.api,
      extra: [previewBtn, headsBtn, resetBtn],
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
      draw();
    });
    headsBtn.addEventListener('click', function () {
      headsOnly = !headsOnly;
      headsBtn.setAttribute('aria-pressed', headsOnly ? 'true' : 'false');
      headsBtn.className = 'eb-btn' + (headsOnly ? ' fill' : '');
      root.classList.toggle('heads-only', headsOnly);
    });
    resetBtn.addEventListener('click', function () {
      if (!confirm('이 페이지의 순서·묶음·숨김을 모두 지우고 기본 배치(연도순)로 돌릴까요? 저장해야 반영됩니다.')) return;
      load(null); useDefault = true; bar.changed(); draw();
    });

    var root = el('div', { class: 'ed-root' });
    archive.parentNode.insertBefore(root, archive);
    if (ctx.partial) bar.status('갤러리 이미지를 일부 못 불러왔습니다. 이 상태로 저장하면 빠진 게시물 순서가 흐트러질 수 있으니 새로 고친 뒤 편집하세요.', 'err');

    // ---- 그리기 ----
    function draw() {
      root.hidden = mode !== 'edit';
      archive.hidden = mode === 'edit';
      if (mode === 'preview') {
        var layout = useDefault ? null : serialize();
        ctx.preview(layout);
        return;
      }
      root.textContent = '';
      var list = el('ol', { class: 'ed-list', 'aria-label': '게시물 순서' });
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
      var li = el('li', { class: 'ed-arc' });
      var sel = {};             // 선택된 이미지 key
      var shown = m.rows.reduce(function (n, r) { return n + r.filter(function (im) { return m.hidden.indexOf(im.key) < 0; }).length; }, 0);
      var total = m.rows.reduce(function (n, r) { return n + r.length; }, 0);
      var joinBtn = el('button', { type: 'button', class: 'eb-btn sm', text: '고른 이미지 한 줄로', disabled: true });
      var splitAll = el('button', { type: 'button', class: 'eb-btn sm', text: '모두 한 장씩', disabled: m.rows.every(function (r) { return r.length === 1; }) });
      var head = el('div', { class: 'ed-head' + (shown ? '' : ' all-hidden') }, [
        el('button', { type: 'button', class: 'ed-grip', 'aria-label': m.e.title + ' 순서 옮기기 (끌기)', title: '끌어서 게시물 순서 바꾸기', text: '☰' }),
        el('span', { class: 'ed-no' }),
        el('strong', { class: 'ed-title', text: m.e.title }),
        el('span', { class: 'ed-meta', text: [m.e.year, m.e.category, shown + '/' + total + '장' + (shown ? '' : ' · 페이지에서 안 보임')].filter(Boolean).join(' · ') }),
        el('span', { class: 'ed-tools' }, [joinBtn, splitAll])
      ]);
      var rowsBox = el('div', { class: 'ed-rows' });
      li.appendChild(head); li.appendChild(rowsBox);
      li.querySelector('.ed-no').textContent = model.indexOf(m) + 1;

      function redraw() { li.replaceWith(entryNode(m)); }

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
          var hideBtn = el('button', { type: 'button', class: 'ed-hide', text: hid ? '보이기' : '숨기기', 'aria-pressed': hid ? 'true' : 'false' });
          var tile = el('div', { class: 'ed-tile' + (hid ? ' is-hidden' : ''), 'data-key': im.key, tabindex: '0', role: 'checkbox', 'aria-checked': 'false', 'aria-label': m.e.title + ' 이미지' + (hid ? ' (숨김)' : '') }, [pic, hideBtn]);
          // 세로 높이 고정, 폭은 비율대로 (편집 화면은 작게)
          function fit(w, h) { if (w && h) { tile.style.aspectRatio = w + ' / ' + h; tile.style.width = 'auto'; } }
          fit(im.w, im.h);
          if (!im.w) pic.addEventListener('load', function () { fit(pic.naturalWidth, pic.naturalHeight); });
          hideBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
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
