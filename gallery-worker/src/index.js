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
  const folders = (result.folders || []).map(f => f.path || f.name).sort();

  // KV에 캐싱
  await env.GALLERY_KV.put(CACHE_KEY, JSON.stringify({ folders, fetchedAt: Math.floor(Date.now() / 1000) }));

  return new Response(JSON.stringify({ folders }), {
    headers: { "Content-Type": "application/json" },
  });
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
  const folder = formData.get("folder") || "";

  if (!file) {
    return new Response(JSON.stringify({ error: "file required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const uploadData = new FormData();
  uploadData.append("file", file);
  uploadData.append("folder", folder);
  uploadData.append("api_key", env.CLOUDINARY_API_KEY);

  const timestamp = Math.floor(Date.now() / 1000);
  uploadData.append("timestamp", timestamp.toString());

  // Generate SHA-1 signature
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
