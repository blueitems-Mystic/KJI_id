export class StatsCounter {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this._init();
  }

  _init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_visitors (date TEXT, hash TEXT, PRIMARY KEY(date, hash))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_counts  (date TEXT PRIMARY KEY, uniques INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS image_views   (image_id TEXT PRIMARY KEY, group_id TEXT, views INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS totals        (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0)");
    // works 방문 기록 — 상세(works_views/works_items)는 WORKS_KEEP_DAYS 보관, 합계 테이블은 영구
    this.sql.exec("CREATE TABLE IF NOT EXISTS works_views (pv TEXT PRIMARY KEY, vid TEXT NOT NULL, date TEXT NOT NULL, ts INTEGER NOT NULL, page TEXT NOT NULL, ref TEXT, device TEXT, country TEXT, ms INTEGER NOT NULL DEFAULT 0, scroll INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS works_views_date ON works_views(date)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS works_views_vid ON works_views(vid, date)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS works_items (pv TEXT NOT NULL, item TEXT NOT NULL, page TEXT NOT NULL, date TEXT NOT NULL, ms INTEGER NOT NULL DEFAULT 0, opens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(pv, item))");
    this.sql.exec("CREATE INDEX IF NOT EXISTS works_items_date ON works_items(date)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS works_daily (date TEXT PRIMARY KEY, visitors INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS works_pages (page TEXT PRIMARY KEY, title TEXT, views INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS works_item_totals (page TEXT NOT NULL, item TEXT NOT NULL, label TEXT, views INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, opens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(page, item))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS works_meta (k TEXT PRIMARY KEY, v TEXT)");
  }

  // ── works 방문 기록 ──────────────────────────────
  // ev.t = "v"(페이지 열림) | "u"(누적 체류시간 갱신, 같은 pv 로 여러 번 와도 안전: 늘어난 만큼만 더함)
  worksTrack({ date, ts, vid, device, country, ev }) {
    const MAX_MS = 30 * 60 * 1000; // 페이지 하나에 30분 넘는 체류는 자리 비움으로 보고 자름
    const one = (q, ...a) => [...this.sql.exec(q, ...a)][0];

    if (ev.t === "v") {
      const lastPrune = one("SELECT v FROM works_meta WHERE k='prune'")?.v;
      if (lastPrune !== date) {
        const cutoff = new Date(Date.parse(date) - WORKS_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
        this.sql.exec("DELETE FROM works_views WHERE date < ?", cutoff);
        this.sql.exec("DELETE FROM works_items WHERE date < ?", cutoff);
        this.sql.exec("INSERT INTO works_meta(k,v) VALUES('prune',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", date);
      }
      const seen = one("SELECT 1 AS x FROM works_views WHERE vid=? AND date=? LIMIT 1", vid, date);
      const cur = this.sql.exec(
        "INSERT OR IGNORE INTO works_views(pv,vid,date,ts,page,ref,device,country) VALUES(?,?,?,?,?,?,?,?)",
        ev.pv, vid, date, ts, ev.page, ev.ref, device, country
      );
      if (cur.rowsWritten > 0) {
        this.sql.exec(
          "INSERT INTO works_daily(date,visitors,views) VALUES(?,?,1) ON CONFLICT(date) DO UPDATE SET visitors=visitors+excluded.visitors, views=views+1",
          date, seen ? 0 : 1
        );
        this.sql.exec(
          "INSERT INTO works_pages(page,title,views) VALUES(?,?,1) ON CONFLICT(page) DO UPDATE SET views=views+1, title=COALESCE(excluded.title, works_pages.title)",
          ev.page, ev.title
        );
      }
      return { ok: true };
    }

    if (ev.t === "u") {
      const row = one("SELECT vid,date,page,ms,scroll FROM works_views WHERE pv=?", ev.pv);
      if (!row || row.vid !== vid || row.page !== ev.page) return { ok: false };
      const ms = Math.min(ev.ms, MAX_MS);
      const dms = Math.max(0, ms - row.ms);
      if (dms > 0 || ev.scroll > row.scroll) {
        this.sql.exec("UPDATE works_views SET ms=MAX(ms,?), scroll=MAX(scroll,?) WHERE pv=?", ms, ev.scroll, ev.pv);
        if (dms > 0) this.sql.exec("UPDATE works_pages SET ms=ms+? WHERE page=?", dms, row.page);
      }
      for (const it of ev.items) {
        const ims = Math.min(it.ms, MAX_MS);
        const prev = one("SELECT ms,opens FROM works_items WHERE pv=? AND item=?", ev.pv, it.key) || { ms: 0, opens: 0 };
        const d = Math.max(0, ims - prev.ms), dOpen = Math.max(0, it.opens - prev.opens);
        if (!d && !dOpen && prev.ms) continue;
        this.sql.exec(
          "INSERT INTO works_items(pv,item,page,date,ms,opens) VALUES(?,?,?,?,?,?) ON CONFLICT(pv,item) DO UPDATE SET ms=MAX(ms,excluded.ms), opens=MAX(opens,excluded.opens)",
          ev.pv, it.key, row.page, row.date, ims, it.opens
        );
        const newView = prev.ms < WORKS_ITEM_VIEW_MS && ims >= WORKS_ITEM_VIEW_MS ? 1 : 0;
        this.sql.exec(
          "INSERT INTO works_item_totals(page,item,label,views,ms,opens) VALUES(?,?,?,?,?,?) ON CONFLICT(page,item) DO UPDATE SET views=views+excluded.views, ms=ms+excluded.ms, opens=opens+excluded.opens, label=COALESCE(excluded.label, works_item_totals.label)",
          row.page, it.key, it.label, newView, d, dOpen
        );
      }
      return { ok: true };
    }
    return { ok: false };
  }

  // days = 숫자(상세 테이블 기준) | 0 = 전체 기간(합계 테이블 기준, 방문자 목록은 보관 기간 안만)
  getWorksStats({ today, days, offset }) {
    const all = (q, ...a) => [...this.sql.exec(q, ...a)];
    const keep = days > 0 ? Math.min(days, WORKS_KEEP_DAYS) : WORKS_KEEP_DAYS;
    const from = new Date(Date.parse(today) - (keep - 1) * 86400000).toISOString().slice(0, 10);
    const dailyFrom = days > 0 ? from : "0000-00-00";
    const titles = Object.fromEntries(all("SELECT page,title FROM works_pages").map(r => [r.page, r.title]));
    const labels = {};
    for (const r of all("SELECT page,item,label FROM works_item_totals")) labels[r.page + "\u0000" + r.item] = r.label;

    const daily = all("SELECT date,visitors,views FROM works_daily WHERE date>=? ORDER BY date", dailyFrom);

    let pages, items;
    if (days > 0) {
      pages = all(
        "SELECT page, COUNT(*) AS views, COUNT(DISTINCT vid||date) AS visitors, SUM(ms) AS ms, AVG(scroll) AS scroll FROM works_views WHERE date>=? GROUP BY page ORDER BY views DESC",
        from
      ).map(r => ({ page: r.page, title: titles[r.page] || null, views: r.views, visitors: r.visitors, ms: r.ms, avgMs: r.views ? Math.round(r.ms / r.views) : 0, scroll: Math.round(r.scroll || 0) }));
      items = all(
        "SELECT page, item, SUM(CASE WHEN ms>=? THEN 1 ELSE 0 END) AS views, SUM(ms) AS ms, SUM(opens) AS opens FROM works_items WHERE date>=? GROUP BY page,item ORDER BY ms DESC LIMIT 200",
        WORKS_ITEM_VIEW_MS, from
      );
    } else {
      pages = all("SELECT page,title,views,ms FROM works_pages ORDER BY views DESC")
        .map(r => ({ page: r.page, title: r.title, views: r.views, visitors: null, ms: r.ms, avgMs: r.views ? Math.round(r.ms / r.views) : 0, scroll: null }));
      items = all("SELECT page,item,views,ms,opens FROM works_item_totals ORDER BY ms DESC LIMIT 200");
    }
    items = items.map(r => ({ page: r.page, item: r.item, label: labels[r.page + "\u0000" + r.item] || r.item, views: r.views, ms: r.ms, avgMs: r.views ? Math.round(r.ms / r.views) : 0, opens: r.opens }));

    // 유입: 방문자-일마다 첫 페이지의 ref
    const entries = all(
      "SELECT v.ref AS ref, v.page AS page, v.device AS device, v.country AS country FROM works_views v JOIN (SELECT vid, date, MIN(ts) AS t FROM works_views WHERE date>=? GROUP BY vid, date) f ON v.vid=f.vid AND v.date=f.date AND v.ts=f.t",
      from
    );
    const tally = (key) => {
      const m = {};
      for (const e of entries) { const k = key(e) || ""; m[k] = (m[k] || 0) + 1; }
      return Object.entries(m).map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n).slice(0, 20);
    };

    const LIMIT = 40;
    const visitorRows = all(
      "SELECT vid, date, MIN(ts) AS first, MAX(ts) AS last, COUNT(*) AS views, SUM(ms) AS ms, MAX(device) AS device, MAX(country) AS country FROM works_views WHERE date>=? GROUP BY vid, date ORDER BY first DESC LIMIT ? OFFSET ?",
      from, LIMIT + 1, offset
    );
    const visitors = visitorRows.slice(0, LIMIT).map(v => {
      const views = all("SELECT pv, ts, page, ref, ms, scroll FROM works_views WHERE vid=? AND date=? ORDER BY ts", v.vid, v.date).map(p => ({
        ts: p.ts, page: p.page, ref: p.ref, ms: p.ms, scroll: p.scroll,
        items: all("SELECT item, ms, opens FROM works_items WHERE pv=? ORDER BY ms DESC LIMIT 8", p.pv)
          .map(i => ({ item: i.item, label: labels[p.page + "\u0000" + i.item] || i.item, ms: i.ms, opens: i.opens })),
      }));
      return { id: v.vid.slice(0, 6), date: v.date, first: v.first, last: v.last, views: v.views, ms: v.ms, device: v.device, country: v.country, path: views };
    });

    return {
      today, days, from: days > 0 ? from : null, keepDays: WORKS_KEEP_DAYS, itemViewMs: WORKS_ITEM_VIEW_MS,
      daily, pages, items,
      referrers: tally(e => e.ref), landing: tally(e => e.page), devices: tally(e => e.device), countries: tally(e => e.country),
      visitors, more: visitorRows.length > LIMIT, offset,
    };
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const readBody = async () => request.method === "GET" ? {} : await request.json();

    if (path === "/recordVisit" && request.method === "POST") {
      const body = await readBody();
      return Response.json(this.recordVisit(body.date, body.hash));
    }
    if (path === "/recordImageView" && request.method === "POST") {
      const body = await readBody();
      return Response.json(this.recordImageView(body.imageId, body.groupId));
    }
    if (path === "/getSummary" && (request.method === "GET" || request.method === "POST")) {
      const body = await readBody();
      return Response.json(this.getSummary(body.date));
    }
    if (path === "/getGalleryViews" && (request.method === "GET" || request.method === "POST")) {
      return Response.json(this.getGalleryViews());
    }
    if (path === "/getDashboard" && (request.method === "GET" || request.method === "POST")) {
      const body = await readBody();
      return Response.json(this.getDashboard(body.date));
    }
    if (path === "/reset" && request.method === "POST") {
      return Response.json(this.reset());
    }
    if (path === "/worksTrack" && request.method === "POST") {
      return Response.json(this.worksTrack(await readBody()));
    }
    if (path === "/getWorksStats" && request.method === "POST") {
      return Response.json(this.getWorksStats(await readBody()));
    }

    return new Response("Not Found", { status: 404 });
  }

  recordVisit(date, hash) {
    const existing = this.sql.exec("SELECT COUNT(*) AS count FROM daily_visitors WHERE date=?", date).one();
    const isNewDate = (existing?.count || 0) === 0;
    const cur = this.sql.exec("INSERT OR IGNORE INTO daily_visitors(date,hash) VALUES(?,?)", date, hash);

    if (cur.rowsWritten > 0) {
      if (isNewDate) {
        const cutoff = new Date(Date.now() + 9 * 3600 * 1000 - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        this.sql.exec("DELETE FROM daily_visitors WHERE date < ?", cutoff);
      }
      this.sql.exec("INSERT INTO daily_counts(date,uniques) VALUES(?,1) ON CONFLICT(date) DO UPDATE SET uniques=uniques+1", date);
      this.sql.exec("INSERT INTO totals(k,v) VALUES('total_visits',1) ON CONFLICT(k) DO UPDATE SET v=v+1");
    }

    return this.getSummary(date);
  }

  recordImageView(imageId, groupId) {
    this.sql.exec(
      "INSERT INTO image_views(image_id,group_id,views) VALUES(?,?,1) ON CONFLICT(image_id) DO UPDATE SET views=views+1, group_id=COALESCE(excluded.group_id, image_views.group_id)",
      imageId,
      groupId ?? null
    );
    const row = this.sql.exec("SELECT views FROM image_views WHERE image_id=?", imageId).one();
    return { imageId, views: row?.views || 0 };
  }

  getSummary(date) {
    // NOTE: cursor.one() throws when zero rows match, so use array-spread and index [0]
    // to correctly yield 0 for the empty state (fresh DB / no visits for `date` yet).
    const todayRow = [...this.sql.exec("SELECT uniques FROM daily_counts WHERE date=?", date)][0];
    const totalRow = [...this.sql.exec("SELECT v FROM totals WHERE k='total_visits'")][0];
    return {
      today: todayRow?.uniques || 0,
      total: totalRow?.v || 0,
    };
  }

  getGalleryViews() {
    const rows = [...this.sql.exec("SELECT group_id, sum(views) AS views FROM image_views GROUP BY group_id")];
    const groups = {};
    for (const row of rows) {
      if (row.group_id !== null) groups[row.group_id] = row.views;
    }
    return groups;
  }

  getDashboard(date) {
    const visitors = this.getSummary(date);
    const trend = [...this.sql.exec("SELECT date,uniques FROM daily_counts ORDER BY date DESC LIMIT 30")]
      .reverse()
      .map(row => ({ date: row.date, uniques: row.uniques }));
    const topImages = [...this.sql.exec("SELECT image_id,group_id,views FROM image_views ORDER BY views DESC LIMIT 20")]
      .map(row => ({ imageId: row.image_id, groupId: row.group_id, views: row.views }));
    const totalImageViewsRow = this.sql.exec("SELECT sum(views) AS views FROM image_views").one();
    return {
      visitors,
      trend,
      topImages,
      totalImageViews: totalImageViewsRow?.views || 0,
    };
  }

  reset() {
    // Admin-only wipe of all analytics data (visitors + image views). Irreversible.
    this.sql.exec("DELETE FROM daily_visitors");
    this.sql.exec("DELETE FROM daily_counts");
    this.sql.exec("DELETE FROM image_views");
    this.sql.exec("DELETE FROM totals");
    return { ok: true, reset: true };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return corsResponse(env, request, new Response(null, { status: 204 }));
    }

    try {
      // Route dispatch
      if (path === "/api/gallery" && method === "GET") {
        return corsResponse(env, request, await handleGetGallery(env));
      }

      if (path === "/api/config" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleGetConfig(env));
      }

      if (path === "/api/config" && method === "PUT") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handlePutConfig(request, env));
      }

      if (path === "/api/folders" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleListFolders(env));
      }

      if (path === "/api/images" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleListImages(env));
      }

      if (path === "/api/upload" && method === "POST") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleUpload(request, env));
      }

      if (path.startsWith("/api/images/") && method === "DELETE") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        const publicId = decodeURIComponent(path.replace("/api/images/", ""));
        return corsResponse(env, request, await handleDeleteImage(publicId, env));
      }

      // --- Works (컨셉아트 허브) 레이아웃 ---

      if (path === "/api/works" && method === "GET") {
        return corsResponse(env, request, await handleGetWorks(env));
      }

      if (path === "/api/works" && method === "PUT") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handlePutWorks(request, env));
      }

      if (path === "/api/works/revert" && method === "POST") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleRevertWorks(env));
      }

      // --- Portfolio endpoints ---

      if (path === "/api/portfolio/content" && method === "GET") {
        return corsResponse(env, request, await handleGetPortfolioContent(env));
      }

      if (path === "/api/portfolio/draft" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleGetPortfolioDraft(env));
      }

      if (path === "/api/portfolio/draft" && method === "PUT") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handlePutPortfolioDraft(request, env));
      }

      if (path === "/api/portfolio/publish" && method === "POST") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handlePublishPortfolio(env));
      }

      if (path === "/api/portfolio/history" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleListPortfolioHistory(env));
      }

      if (path.startsWith("/api/portfolio/history/") && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        const ts = decodeURIComponent(path.replace("/api/portfolio/history/", ""));
        return corsResponse(env, request, await handleGetPortfolioHistoryItem(ts, env));
      }

      if (path === "/api/portfolio/upload" && method === "POST") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handlePortfolioUpload(request, env));
      }

      // ───────────── Posts (프로젝트 게시판) ─────────────
      if (path === "/api/posts" && method === "GET") {
        return corsResponse(env, request, await handleListPosts(env));
      }
      if (path === "/api/posts/featured" && method === "GET") {
        return corsResponse(env, request, await handleGetFeaturedPost(env));
      }
      if (path === "/api/admin/posts" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleAdminListPosts(env));
      }
      if (path === "/api/posts" && method === "POST") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        return corsResponse(env, request, await handleCreatePost(request, env));
      }
      if (path.startsWith("/api/posts/") && method === "GET") {
        const id = decodeURIComponent(path.slice("/api/posts/".length));
        return corsResponse(env, request, await handleGetPost(id, request, env));
      }
      if (path.startsWith("/api/posts/") && method === "PUT") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        const id = decodeURIComponent(path.slice("/api/posts/".length));
        return corsResponse(env, request, await handleUpdatePost(id, request, env));
      }
      if (path.startsWith("/api/posts/") && method === "DELETE") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        const id = decodeURIComponent(path.slice("/api/posts/".length));
        return corsResponse(env, request, await handleDeletePost(id, env));
      }

      if (path === "/api/stats/hit" && method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return corsResponse(env, request, postsJson({ error: "Invalid JSON" }, 400));
        }
        const stub = getStatsStub(env);

        if (body.type === "visit") {
          const ip = request.headers.get("cf-connecting-ip") || "";
          const ua = request.headers.get("user-agent") || "";
          const date = kstDate();
          const salt = env.STATS_SALT || "kji";
          const hash = await sha256Hex(`${ip}|${ua}|${date}|${salt}`);
          const res = await stub.fetch("https://do/recordVisit", {
            method: "POST",
            body: JSON.stringify({ date, hash }),
          });
          const { today, total } = await res.json();
          return corsResponse(env, request, postsJson({ today, total }));
        }

        if (body.type === "imageView") {
          if (typeof body.imageId !== "string" || !body.imageId.trim()) {
            return corsResponse(env, request, postsJson({ error: "imageId required" }, 400));
          }
          const res = await stub.fetch("https://do/recordImageView", {
            method: "POST",
            body: JSON.stringify({ imageId: body.imageId, groupId: body.groupId ?? null }),
          });
          const { imageId, views } = await res.json();
          return corsResponse(env, request, postsJson({ imageId, views }));
        }

        return corsResponse(env, request, postsJson({ error: "invalid type" }, 400));
      }

      if (path === "/api/stats/summary" && method === "GET") {
        const cached = await env.GALLERY_KV.get("stats:summary", { type: "json" });
        if (cached && Date.now() - cached.asOf < 60000) {
          return corsResponse(env, request, postsJson(cached));
        }
        const stub = getStatsStub(env);
        const res = await stub.fetch("https://do/getSummary", {
          method: "POST",
          body: JSON.stringify({ date: kstDate() }),
        });
        const { today, total } = await res.json();
        const payload = { today, total, asOf: Date.now() };
        await env.GALLERY_KV.put("stats:summary", JSON.stringify(payload), { expirationTtl: 60 });
        return corsResponse(env, request, postsJson(payload));
      }

      if (path === "/api/stats/gallery" && method === "GET") {
        const cached = await env.GALLERY_KV.get("stats:gallery", { type: "json" });
        if (cached && Date.now() - cached.asOf < 60000) {
          return corsResponse(env, request, postsJson(cached));
        }
        const stub = getStatsStub(env);
        const res = await stub.fetch("https://do/getGalleryViews");
        const groups = await res.json();
        const payload = { groups, asOf: Date.now() };
        await env.GALLERY_KV.put("stats:gallery", JSON.stringify(payload), { expirationTtl: 60 });
        return corsResponse(env, request, postsJson(payload));
      }

      if (path === "/api/admin/stats" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        const stub = getStatsStub(env);
        const res = await stub.fetch("https://do/getDashboard", {
          method: "POST",
          body: JSON.stringify({ date: kstDate() }),
        });
        const dashboard = await res.json();
        return corsResponse(env, request, postsJson({ ...dashboard, generatedAt: new Date().toISOString() }));
      }

      // works 방문 기록 수집 (works/track.js 의 sendBeacon, text/plain JSON). 응답은 안 읽으므로 204
      if (path === "/api/works/track" && method === "POST") {
        return await handleWorksTrack(request, env);
      }
      if (path === "/api/admin/works-stats" && method === "GET") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        const d = url.searchParams.get("days");
        const days = d === "all" ? 0 : [1, 7, 30, 90, 180].includes(Number(d)) ? Number(d) : 30;
        const offset = Math.max(0, Math.min(100000, parseInt(url.searchParams.get("offset") || "0", 10) || 0));
        const res = await getStatsStub(env).fetch("https://do/getWorksStats", {
          method: "POST",
          body: JSON.stringify({ today: kstDate(), days, offset }),
        });
        return corsResponse(env, request, postsJson({ ...(await res.json()), generatedAt: new Date().toISOString() }));
      }

      if (path === "/api/admin/stats/reset" && method === "POST") {
        const authErr = checkAuth(request, env);
        if (authErr) return corsResponse(env, request, authErr);
        const stub = getStatsStub(env);
        const res = await stub.fetch("https://do/reset", { method: "POST" });
        const out = await res.json();
        // 리셋 즉시 반영되도록 공개 캐시 무효화
        await env.GALLERY_KV.delete("stats:summary");
        await env.GALLERY_KV.delete("stats:gallery");
        return corsResponse(env, request, postsJson(out));
      }

      return corsResponse(env, request, new Response("Not Found", { status: 404 }));
    } catch (err) {
      return corsResponse(env, request, new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }));
    }
  },
};

// 로컬 개발 + 프로덕션 오리진 화이트리스트 — request origin 기반 동적 매칭.
// env.ALLOWED_ORIGIN (wrangler.toml) 은 화이트리스트 미스 시 폴백 기본값.
const DEV_ORIGINS = new Set([
  "http://127.0.0.1:8000",
  "http://localhost:8000",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

const PROD_ORIGINS = new Set([
  "https://blueitems-mystic.github.io",
  "https://kji.blueitems.net",
]);

function corsResponse(env, request, response) {
  const headers = new Headers(response.headers);
  const reqOrigin = request.headers.get("Origin") || "";
  const allowed = PROD_ORIGINS.has(reqOrigin) || DEV_ORIGINS.has(reqOrigin) || reqOrigin === env.ALLOWED_ORIGIN;
  const allowOrigin = allowed ? reqOrigin : env.ALLOWED_ORIGIN;
  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function checkAuth(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

function getStatsStub(env) {
  const id = env.STATS.idFromName("global");
  return env.STATS.get(id);
}

// ── works 방문 기록 ──
const WORKS_KEEP_DAYS = 180;      // 방문자별 상세 보관 기간 (종일군 결정 2026-11-24)
const WORKS_ITEM_VIEW_MS = 1000;  // 게시물이 화면에 1초 이상 보이면 '봤다'로 셈
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|curl|wget|python|scrapy/i;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

function cleanStr(v, max) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
  return s || null;
}
function cleanMs(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 24 * 3600 * 1000) : 0;
}

async function handleWorksTrack(request, env) {
  const done = new Response(null, { status: 204 });
  const origin = request.headers.get("Origin") || "";
  if (!(PROD_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))) return done;
  const ua = request.headers.get("user-agent") || "";
  if (!ua || BOT_UA.test(ua)) return done;
  const raw = await request.text();
  if (raw.length > 32000) return done;
  let b;
  try { b = JSON.parse(raw); } catch { return done; }
  const pv = cleanStr(b?.pv, 40), page = cleanStr(b?.page, 160);
  if (!pv || !page || (b.t !== "v" && b.t !== "u")) return done;

  const ev = { t: b.t, pv, page };
  if (b.t === "v") {
    ev.title = cleanStr(b.title, 120);
    ev.ref = cleanStr(b.ref, 200);
  } else {
    ev.ms = cleanMs(b.ms);
    ev.scroll = Math.max(0, Math.min(100, Math.round(Number(b.scroll) || 0)));
    ev.items = (Array.isArray(b.items) ? b.items : []).slice(0, 150).map(it => ({
      key: cleanStr(it?.[0], 120), ms: cleanMs(it?.[1]), opens: Math.max(0, Math.min(500, Math.round(Number(it?.[2]) || 0))), label: cleanStr(it?.[3], 120),
    })).filter(it => it.key);
  }

  const ip = request.headers.get("cf-connecting-ip") || "";
  const date = kstDate();
  const salt = env.STATS_SALT || "kji";
  // 방문자 ID = IP·브라우저·날짜·솔트 해시. 날짜가 바뀌면 같은 사람도 다른 ID (IP 원문은 저장 안 함)
  const vid = (await sha256Hex(`works|${ip}|${ua}|${date}|${salt}`)).slice(0, 20);
  const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "desktop";
  const country = cleanStr(request.cf?.country, 4);
  await getStatsStub(env).fetch("https://do/worksTrack", {
    method: "POST",
    body: JSON.stringify({ date, ts: Date.now(), vid, device, country, ev }),
  });
  return done;
}

function kstDate() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- Cloudinary helper ---

async function cloudinaryRequest(method, path, env, body) {
  const auth = btoa(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`);
  const url = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}${path}`;
  const opts = {
    method,
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

// --- Handlers ---

async function handleGetGallery(env) {
  const raw = await env.GALLERY_KV.get("gallery-config");
  if (!raw) {
    return new Response(JSON.stringify({
      categories: ["캐릭터", "배경", "프랍", "UI", "ETC"],
      groups: [],
    }), { headers: { "Content-Type": "application/json" } });
  }
  const config = JSON.parse(raw);
  const publicGroups = config.groups.map(g => ({
    id: g.id,
    title: g.title,
    project: g.project,
    category: g.category,
    description: g.description,
    gridPosition: g.gridPosition,
    gridSize: g.gridSize,
    thumbnail: g.thumbnail,
    images: g.images.filter(img => img.visible),
  }));
  return new Response(JSON.stringify({
    categories: config.categories,
    groups: publicGroups,
    cloudName: env.CLOUDINARY_CLOUD_NAME,
  }), { headers: { "Content-Type": "application/json" } });
}

async function handleGetConfig(env) {
  const raw = await env.GALLERY_KV.get("gallery-config");
  if (!raw) {
    return new Response(JSON.stringify({
      categories: ["캐릭터", "배경", "프랍", "UI", "ETC"],
      groups: [],
      hiddenImages: [],
    }), { headers: { "Content-Type": "application/json" } });
  }
  return new Response(raw, { headers: { "Content-Type": "application/json" } });
}

async function handlePutConfig(request, env) {
  const body = await request.json();
  if (!body.categories || !Array.isArray(body.categories)) {
    return new Response(JSON.stringify({ error: "categories array required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (!body.groups || !Array.isArray(body.groups)) {
    return new Response(JSON.stringify({ error: "groups array required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  await env.GALLERY_KV.put("gallery-config", JSON.stringify(body));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleListFolders(env) {
  const CACHE_KEY = "folder-list-cache";
  const CACHE_TTL = 3600; // 1시간 (초)

  // KV 캐시 확인
  const cached = await env.GALLERY_KV.get(CACHE_KEY, { type: "json" });
  if (cached && cached.fetchedAt && (Date.now() / 1000 - cached.fetchedAt) < CACHE_TTL) {
    return new Response(JSON.stringify({ folders: cached.folders }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Cloudinary에서 폴더 목록 조회
  const result = await cloudinaryRequest("GET", "/folders", env);
  // 실패 응답(키 오류 등)은 캐싱하지 않는다 — 빈 목록이 TTL 동안 남는 것 방지
  if (result.error || !Array.isArray(result.folders)) {
    return new Response(JSON.stringify({ error: result.error?.message || "folder list failed" }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }
  const folders = result.folders.map(f => f.path || f.name).sort();

  // KV에 캐싱
  await env.GALLERY_KV.put(CACHE_KEY, JSON.stringify({ folders, fetchedAt: Math.floor(Date.now() / 1000) }));

  return new Response(JSON.stringify({ folders }), {
    headers: { "Content-Type": "application/json" },
  });
}

// --- Works 레이아웃 (works.json 위에 덮어쓰는 편집값) ---
// KV "works-config" = { version, updatedAt, banners: {postId: {panels}}, pages: {projectId: {order, entries}} }
// 저장할 때마다 직전 값을 "works-config:prev" 에 한 벌 보관 (되돌리기용)

const WORKS_MAX_BYTES = 512 * 1024;

function jsonResponse(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", ...extra },
  });
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

async function handleGetWorks(env) {
  const raw = await env.GALLERY_KV.get("works-config");
  return new Response(raw || "{}", {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handlePutWorks(request, env) {
  const text = await request.text();
  if (text.length > WORKS_MAX_BYTES) return jsonResponse({ error: "too large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return jsonResponse({ error: "invalid JSON" }, 400); }
  if (!isPlainObject(body)) return jsonResponse({ error: "object required" }, 400);
  if (body.banners !== undefined && !isPlainObject(body.banners)) return jsonResponse({ error: "banners must be object" }, 400);
  if (body.pages !== undefined && !isPlainObject(body.pages)) return jsonResponse({ error: "pages must be object" }, 400);
  if (body.texts !== undefined && !isPlainObject(body.texts)) return jsonResponse({ error: "texts must be object" }, 400);
  for (const [id, b] of Object.entries(body.banners || {})) {
    if (!isPlainObject(b) || !Array.isArray(b.panels)) return jsonResponse({ error: `banners.${id}.panels array required` }, 400);
  }
  const prev = await env.GALLERY_KV.get("works-config");
  // texts(허브 문구)를 안 보내는 예전 편집기가 저장해도 기존 문구가 지워지지 않게 유지
  let texts = body.texts;
  if (texts === undefined && prev) { try { texts = JSON.parse(prev).texts; } catch { texts = undefined; } }
  const config = { version: 1, banners: body.banners || {}, pages: body.pages || {}, texts: texts || {}, updatedAt: new Date().toISOString() };
  if (prev) await env.GALLERY_KV.put("works-config:prev", prev);
  await env.GALLERY_KV.put("works-config", JSON.stringify(config));
  return jsonResponse({ ok: true, updatedAt: config.updatedAt });
}

async function handleRevertWorks(env) {
  const prev = await env.GALLERY_KV.get("works-config:prev");
  if (!prev) return jsonResponse({ error: "no previous version" }, 404);
  const cur = await env.GALLERY_KV.get("works-config");
  await env.GALLERY_KV.put("works-config", prev);
  if (cur) await env.GALLERY_KV.put("works-config:prev", cur);
  return new Response(prev, { headers: { "Content-Type": "application/json" } });
}

async function handleListImages(env) {
  const result = await cloudinaryRequest("POST", "/resources/search", env, {
    expression: "resource_type:image",
    max_results: 500,
    sort_by: [{ created_at: "desc" }],
  });
  const images = (result.resources || []).map(r => ({
    publicId: r.public_id,
    url: r.secure_url,
    width: r.width,
    height: r.height,
    format: r.format,
    folder: r.folder,
    createdAt: r.created_at,
    bytes: r.bytes,
  }));
  return new Response(JSON.stringify({ images }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleUpload(request, env) {
  const formData = await request.formData();
  const file = formData.get("file");
  const folder = (formData.get("folder") || "").trim();

  if (!file) {
    return new Response(JSON.stringify({ error: "file required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const uploadData = new FormData();
  uploadData.append("file", file);
  if (folder) uploadData.append("folder", folder);
  uploadData.append("api_key", env.CLOUDINARY_API_KEY);

  const timestamp = Math.floor(Date.now() / 1000);
  uploadData.append("timestamp", timestamp.toString());

  // Generate SHA-1 signature
  // Cloudinary는 빈 값 파라미터를 서명 문자열에서 뺀다 → 빈 folder는 서명에 넣지 않는다
  const signParams = folder ? `folder=${folder}&timestamp=${timestamp}` : `timestamp=${timestamp}`;
  const signStr = `${signParams}${env.CLOUDINARY_API_SECRET}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(signStr);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  uploadData.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: uploadData }
  );
  const result = await res.json();

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error.message }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    publicId: result.public_id,
    url: result.secure_url,
    width: result.width,
    height: result.height,
    format: result.format,
    folder: result.folder,
  }), { headers: { "Content-Type": "application/json" } });
}

async function handleDeleteImage(publicId, env) {
  const result = await cloudinaryRequest("DELETE", "/resources/image/upload", env, {
    public_ids: [publicId],
  });
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

// --- Portfolio handlers ---

async function handleGetPortfolioContent(env) {
  const raw = await env.GALLERY_KV.get("portfolio:published");
  if (!raw) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(raw, {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleGetPortfolioDraft(env) {
  const raw = await env.GALLERY_KV.get("portfolio:draft");
  if (!raw) {
    // draft 없으면 published 복사본 반환 (첫 편집 진입 케이스)
    const published = await env.GALLERY_KV.get("portfolio:published");
    if (!published) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(published, {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(raw, {
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePutPortfolioDraft(request, env) {
  const body = await request.json();
  if (!body || typeof body !== "object") {
    return new Response(JSON.stringify({ error: "object body required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!body.version || !body.sections) {
    return new Response(JSON.stringify({ error: "version and sections required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // updatedAt 서버 측 스탬프
  body.updatedAt = new Date().toISOString();
  await env.GALLERY_KV.put("portfolio:draft", JSON.stringify(body));
  return new Response(JSON.stringify({ ok: true, updatedAt: body.updatedAt }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePublishPortfolio(env) {
  const draft = await env.GALLERY_KV.get("portfolio:draft");
  if (!draft) {
    return new Response(JSON.stringify({ error: "no draft to publish" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. 기존 published 가 있으면 history 스냅샷 저장
  const currentPublished = await env.GALLERY_KV.get("portfolio:published");
  const timestamp = new Date().toISOString();
  if (currentPublished) {
    await env.GALLERY_KV.put(`portfolio:history:${timestamp}`, currentPublished);
  }

  // 2. draft → published 복사
  await env.GALLERY_KV.put("portfolio:published", draft);

  // 3. 링 버퍼: 최근 10 개만 유지, 오래된 것 삭제
  const listResult = await env.GALLERY_KV.list({ prefix: "portfolio:history:" });
  const keys = listResult.keys
    .map(k => k.name)
    .sort() // ISO 8601 문자열이므로 사전순 = 시간순
    .reverse(); // 최신이 앞

  const KEEP = 10;
  if (keys.length > KEEP) {
    const toDelete = keys.slice(KEEP);
    await Promise.all(toDelete.map(k => env.GALLERY_KV.delete(k)));
  }

  return new Response(JSON.stringify({
    ok: true,
    publishedAt: timestamp,
    historyCount: Math.min(keys.length, KEEP),
  }), { headers: { "Content-Type": "application/json" } });
}

async function handleListPortfolioHistory(env) {
  const listResult = await env.GALLERY_KV.list({ prefix: "portfolio:history:" });
  const items = listResult.keys
    .map(k => ({
      timestamp: k.name.replace("portfolio:history:", ""),
      key: k.name,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // 최신 먼저
  return new Response(JSON.stringify({ items }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleGetPortfolioHistoryItem(timestamp, env) {
  const raw = await env.GALLERY_KV.get(`portfolio:history:${timestamp}`);
  if (!raw) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(raw, {
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePortfolioUpload(request, env) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file) {
    return new Response(JSON.stringify({ error: "file required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const folder = "kji-portfolio";
  const uploadData = new FormData();
  uploadData.append("file", file);
  uploadData.append("folder", folder);
  uploadData.append("api_key", env.CLOUDINARY_API_KEY);

  const timestamp = Math.floor(Date.now() / 1000);
  uploadData.append("timestamp", timestamp.toString());

  const signStr = `folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(signStr);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  uploadData.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: uploadData }
  );
  const result = await res.json();

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error.message }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    publicId: result.public_id,
    url: result.secure_url,
    width: result.width,
    height: result.height,
    format: result.format,
  }), { headers: { "Content-Type": "application/json" } });
}

// ───────────────────────── Posts (프로젝트 게시판) ─────────────────────────

const POSTS_INDEX_KEY = "posts:index";

function postsJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function postKey(id) {
  return `post:${id}`;
}

function postMeta(post) {
  return {
    id: post.id,
    title: post.title,
    titleEmoji: post.titleEmoji ?? null,
    subtitle: post.subtitle ?? null,
    excerpt: post.excerpt ?? "",
    coverImage: post.coverImage ?? null,
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt ?? null,
  };
}

async function readPostsIndex(env) {
  const raw = await env.GALLERY_KV.get(POSTS_INDEX_KEY);
  if (!raw) return { updatedAt: null, featuredId: null, posts: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { updatedAt: null, featuredId: null, posts: [] };
  }
}

async function writePostsIndex(env, index) {
  index.updatedAt = new Date().toISOString();
  index.posts.sort((a, b) =>
    String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt))
  );
  await env.GALLERY_KV.put(POSTS_INDEX_KEY, JSON.stringify(index));
}

function validatePostBody(body) {
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return "title (non-empty string) is required";
  }
  if (!Array.isArray(body.blocks)) {
    return "blocks (array) is required";
  }
  return null;
}

// GET /api/posts — 공개 목록 (published만)
async function handleListPosts(env) {
  const index = await readPostsIndex(env);
  const posts = index.posts.filter((p) => p.status === "published");
  return postsJson({ featuredId: index.featuredId, posts });
}

// GET /api/posts/featured — featured(없으면 최신 published) 포스트 전문
async function handleGetFeaturedPost(env) {
  const index = await readPostsIndex(env);
  const published = index.posts.filter((p) => p.status === "published");
  const meta = published.find((p) => p.id === index.featuredId) || published[0];
  if (!meta) return postsJson({ error: "No published posts" }, 404);
  const raw = await env.GALLERY_KV.get(postKey(meta.id));
  if (!raw) return postsJson({ error: "Post not found" }, 404);
  return new Response(raw, { headers: { "Content-Type": "application/json" } });
}

// GET /api/posts/{id} — 단건 (draft는 관리자 토큰 있을 때만)
async function handleGetPost(id, request, env) {
  const raw = await env.GALLERY_KV.get(postKey(id));
  if (!raw) return postsJson({ error: "Post not found" }, 404);
  let post;
  try {
    post = JSON.parse(raw);
  } catch {
    return postsJson({ error: "Corrupted post" }, 500);
  }
  if (post.status !== "published") {
    const authErr = checkAuth(request, env);
    if (authErr) return postsJson({ error: "Post not found" }, 404);
  }
  return postsJson(post);
}

// GET /api/admin/posts — draft 포함 인덱스 (로그인 검증 겸용)
async function handleAdminListPosts(env) {
  const index = await readPostsIndex(env);
  return postsJson(index);
}

// POST /api/posts — 생성
async function handleCreatePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return postsJson({ error: "Invalid JSON" }, 400);
  }
  const invalid = validatePostBody(body);
  if (invalid) return postsJson({ error: invalid }, 400);

  const now = new Date().toISOString();
  const datePart = now.slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  const status = body.status === "published" ? "published" : "draft";
  const post = {
    id: `p_${datePart}_${rand}`,
    title: body.title,
    titleEmoji: body.titleEmoji ?? null,
    subtitle: body.subtitle ?? null,
    status,
    excerpt: body.excerpt ?? "",
    coverImage: body.coverImage ?? null,
    createdAt: now,
    updatedAt: now,
    publishedAt: status === "published" ? now : null,
    blocks: body.blocks,
  };
  await env.GALLERY_KV.put(postKey(post.id), JSON.stringify(post));

  const index = await readPostsIndex(env);
  index.posts = index.posts.filter((p) => p.id !== post.id);
  index.posts.push(postMeta(post));
  if (body.featured === true && status === "published") index.featuredId = post.id;
  await writePostsIndex(env, index);
  return postsJson(post, 201);
}

// PUT /api/posts/{id} — 전체 교체
async function handleUpdatePost(id, request, env) {
  const raw = await env.GALLERY_KV.get(postKey(id));
  if (!raw) return postsJson({ error: "Post not found" }, 404);
  let existing;
  try {
    existing = JSON.parse(raw);
  } catch {
    return postsJson({ error: "Corrupted post" }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return postsJson({ error: "Invalid JSON" }, 400);
  }
  const invalid = validatePostBody(body);
  if (invalid) return postsJson({ error: invalid }, 400);

  const now = new Date().toISOString();
  const status = body.status === "published" ? "published" : "draft";
  const post = {
    ...existing,
    title: body.title,
    titleEmoji: body.titleEmoji ?? null,
    subtitle: body.subtitle ?? null,
    status,
    excerpt: body.excerpt ?? "",
    coverImage: body.coverImage ?? null,
    updatedAt: now,
    publishedAt:
      status === "published" ? existing.publishedAt || now : existing.publishedAt,
    blocks: body.blocks,
  };
  await env.GALLERY_KV.put(postKey(id), JSON.stringify(post));

  const index = await readPostsIndex(env);
  index.posts = index.posts.filter((p) => p.id !== id);
  index.posts.push(postMeta(post));
  if (body.featured === true && status === "published") {
    index.featuredId = id;
  } else if (index.featuredId === id && (body.featured === false || status !== "published")) {
    index.featuredId = null;
  }
  await writePostsIndex(env, index);
  return postsJson(post);
}

// DELETE /api/posts/{id}
async function handleDeletePost(id, env) {
  // 인덱스 먼저 갱신 — 중간 실패 시 "목록에 남는 유령 포스트"보다 "인덱스 밖 고아 키"가 안전
  const index = await readPostsIndex(env);
  index.posts = index.posts.filter((p) => p.id !== id);
  if (index.featuredId === id) index.featuredId = null;
  await writePostsIndex(env, index);
  await env.GALLERY_KV.delete(postKey(id));
  return postsJson({ ok: true });
}
