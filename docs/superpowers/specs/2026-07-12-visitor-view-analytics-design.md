---
date: 2026-07-12
type: spec
status: approved
cssclass: twk-spec
tags: [spec, analytics, worker, durable-object, portfolio, gallery]
topic: visitor-view-analytics
---

# 방문자/뷰 카운트 + 관리자 대시보드 — 설계 스펙

> 승인: 종일군 (2026-07-12). 카운팅 코어 = Durable Object(SQLite), KV = 공개 표시용 캐시.

## 1. 목표 / 비목표

**목표**
- 메인(`index.html`) 상단 HUD에 **오늘 방문자 / 총 방문자** 표시 (KST 자정 기준).
- 갤러리 **이미지별 뷰카운트**: 라이트박스 열람 시 카운트, 라이트박스엔 개별 이미지 뷰수 / 그리드 카드엔 그룹 합계 배지.
- 관리자 페이지(`gallery.html?admin=1`)에 **통계 대시보드 패널**: 방문자 추이·이미지 뷰 랭킹.

**비목표 (YAGNI)**
- 리퍼러/국가/브라우저 등 리치 지표 → 후속(선택): CF Web Analytics 무료 비콘. 이번 범위 밖.
- `project.html` 포스트 뷰카운트 → 이번 범위 밖(요청은 "갤러리" 게시물).
- 실시간(ms) 정확도 → 헤더는 ~60초 캐시 허용.

## 2. 아키텍처 결정

- **카운팅 코어 = Cloudflare Durable Object (SQLite 백엔드)**. 원자적·정확·영구. 무료 플랜 포함(`new_sqlite_classes`).
- **KV(`GALLERY_KV`) = 공개 읽기 캐시**(~60초 TTL). 헤더/카드가 매 로드마다 DO를 때리지 않게. **KV를 원시 카운터로 쓰지 않음** — `키당 1write/sec` + last-write-wins 로 카운트 유실되기 때문(무결성 위반).
- 방문자 계수는 **서버측 유니크 dedup**(무결성 중요). 이미지 뷰는 **클라이언트 세션 dedup + 서버 raw 증가**(vanity 지표, 저부담).

## 3. Durable Object — `StatsCounter`

바인딩명 `STATS`, 클래스 `StatsCounter`, 단일 전역 인스턴스(`idFromName("global")`).

### SQLite 스키마
```sql
CREATE TABLE IF NOT EXISTS daily_visitors (date TEXT, hash TEXT, PRIMARY KEY(date, hash));
CREATE TABLE IF NOT EXISTS daily_counts  (date TEXT PRIMARY KEY, uniques INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS image_views   (image_id TEXT PRIMARY KEY, group_id TEXT, views INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS totals        (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0);
```

### 내부 연산 (DO fetch 라우팅, JSON in/out)
- `recordVisit(date, hash)` →
  `INSERT OR IGNORE INTO daily_visitors(date,hash)`. `sql`의 변경 행이 있으면(신규 유니크):
  `INSERT INTO daily_counts(date,uniques) VALUES(?,1) ON CONFLICT(date) DO UPDATE SET uniques=uniques+1;`
  `INSERT INTO totals(k,v) VALUES('total_visits',1) ON CONFLICT(k) DO UPDATE SET v=v+1;`
  반환 `{ today: <daily_counts.uniques for date>, total: <totals.total_visits> }`.
  **정의:** `당일 = 해당 KST 날짜의 유니크 수`, `총 = 일별 유니크의 누적합`(= total_visits).
- `recordImageView(imageId, groupId)` →
  `INSERT INTO image_views(image_id,group_id,views) VALUES(?,?,1) ON CONFLICT(image_id) DO UPDATE SET views=views+1, group_id=COALESCE(excluded.group_id, image_views.group_id);`
  반환 `{ imageId, views }`.
- `getSummary(date)` → `{ today, total }` (today=daily_counts.uniques 또는 0, total=totals.total_visits 또는 0).
- `getGalleryViews()` → `SELECT group_id, sum(views) FROM image_views GROUP BY group_id` → `{ [groupId]: views }`.
- `getDashboard(date)` →
  ```
  {
    visitors: { today, total },
    trend:    [ { date, uniques } ... ],   // daily_counts ORDER BY date DESC LIMIT 30 (오름차순으로 반환)
    topImages:[ { imageId, groupId, views } ... ], // image_views ORDER BY views DESC LIMIT 20
    totalImageViews: <sum(views)>
  }
  ```
- **Pruning(경량):** 새 date가 daily_visitors에 처음 등장할 때만 `DELETE FROM daily_visitors WHERE date < <today-90d>` 실행. daily_counts/totals는 영구 보존. (알람 불필요)

## 4. Worker 라우트 (if-체인, 기존 컨벤션 준수)

기존 `postsJson()`/`corsResponse()`/`checkAuth()` 재사용. 모든 응답 `corsResponse(env, request, ...)` 래핑.

| 메서드·경로 | 인증 | 요청 | 응답 |
|---|---|---|---|
| `POST /api/stats/hit` | 없음(public) | `{type:"visit"}` **또는** `{type:"imageView", imageId, groupId?}` | visit→`{today,total}` / imageView→`{imageId,views}` / 잘못된 type→400 |
| `GET /api/stats/summary` | 없음 | — | `{today,total,asOf}` (KV `stats:summary` fresh<60s면 그대로, 아니면 DO 새로고침 후 KV write) |
| `GET /api/stats/gallery` | 없음 | — | `{groups:{[groupId]:views}, asOf}` (KV `stats:gallery` ~60s 캐시) |
| `GET /api/admin/stats` | **checkAuth** | — | §3 `getDashboard` 페이로드 + `generatedAt` |

**서버측 방문자 해시 (POST /api/stats/hit, type=visit):**
```
ip   = request.headers.get('cf-connecting-ip') || ''
ua   = request.headers.get('user-agent') || ''
date = KST 날짜 = new Date(Date.now()+9*3600*1000).toISOString().slice(0,10)
salt = env.STATS_SALT || 'kji'
hash = hex( SHA-256( `${ip}|${ua}|${date}|${salt}` ) )   // 원본 IP 저장 안 함, 쿠키無
```
DO 호출: `env.STATS.get(env.STATS.idFromName("global"))` → `stub.fetch(...)`.

**KV 캐시 갱신 정책(1write/sec 회피):** `summary`/`gallery` 는 read 시 TTL(60s) 초과일 때만 KV write → 트래픽과 무관하게 KV write ≤ ~1/분/키.

## 5. wrangler.toml 변경

```toml
compatibility_date = "2025-03-01"   # SQLite DO 지원 위해 상향 (배포 시 검증)

[[durable_objects.bindings]]
name = "STATS"
class_name = "StatsCounter"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["StatsCounter"]
```
- (선택) `wrangler secret put STATS_SALT` — 없으면 `'kji'` 폴백. IP 열거 방지용.
- 기존 `GALLERY_KV`/`[vars]` 유지.

## 6. 프론트엔드 통합

### `index.html` — 방문자 HUD
- `API_BASE` 상수(604) 재사용. 마운트 useEffect(2311 부근에 형제 추가): `POST /api/stats/hit {type:'visit'}` → `{today,total}` state.
- **표시 위치:** HUD 행 `.hero-hud-top`(1940–1953). 픽셀 폰트(`'Press Start 2P','Gowun Dodum',sans-serif`)로 **오늘/총 방문자** 셀 통합. 레트로 RPG 톤 유지, 레이아웃 파손 금지. API 실패 시 `--` 폴백(크래시 금지).

### `gallery.html` — 카드 배지 / 라이트박스 / 관리자 패널
- **카드 배지:** `loadGallery()`에서 `GET /api/stats/gallery` 추가 fetch → views 맵을 `MasonryGrid`에 전달 → 각 `.masonry-item`에 그룹 합계 픽셀 배지(우상단 등). 값 없으면 숨김.
- **라이트박스:** `openLightbox`/네비게이션에서 현재 이미지 표시 시 —
  - 세션 dedup: `sessionStorage`의 `viewedImages` Set에 없으면 `POST /api/stats/hit {type:'imageView', imageId, groupId}` (응답 `views`).
  - 표시: 라이트박스 UI에 현재 이미지 뷰수. 세션 재열람은 in-memory 맵 캐시로 표시(재증가 금지). 로딩 전엔 숨김/`…`.
- **관리자 통계 패널:** `AdminApp` `.admin-layout`(2623–2684)에 "📊 통계" 섹션/탭 추가. `api('/api/admin/stats')` 호출(Bearer 자동). 렌더:
  - 방문자 타일(오늘/총), 최근 30일 추이(**차트 라이브러리 없이** 픽셀 막대 리스트 — RPG 테마 일치), 이미지 뷰 랭킹 top20(`imageId`→그룹 타이틀 조인은 `adminConfig.groups`로). 로딩/에러 상태 처리.
  - **주의:** 대시보드 시각화는 기존 레트로 픽셀 미학에 맞춘 경량 구현. 범용 dataviz 팔레트/차트 라이브러리 도입 금지(테마 충돌 + 번들 무의존 원칙).

## 7. 정의·엣지케이스
- **당일/총 방문자:** 당일=KST 날짜 유니크, 총=일별 유니크 누적합. 자정(KST) 넘어가면 당일 리셋(새 date 버킷).
- **이미지 뷰 dedup:** 세션당 이미지 1회(클라). 두 탭/세션은 각각 카운트 — 허용(vanity).
- **그룹 삭제/이미지 이동:** image_views는 imageId 키라 그룹 재편성에도 데이터 보존. 삭제된 이미지 뷰는 랭킹에 남을 수 있음 → 관리자 패널에서 현재 config에 없는 imageId는 "(삭제됨)" 표기 또는 필터(구현 재량, 크래시 금지).
- **CORS:** 신규 라우트 모두 `corsResponse` 경유(기존 PROD_ORIGINS 화이트리스트 그대로 적용).

## 8. 검증 계획 (포폴군 직접)
1. `wrangler dev` 로컬 또는 배포 후 `POST /api/stats/hit {type:visit}` 2회 → 같은 IP/UA/일자면 `today`/`total` 불변(dedup 실측).
2. 서로 다른 UA로 호출 → `today` +1 (유니크 실측).
3. `POST imageView` × N → `image_views` 증가, `GET /api/stats/gallery` 반영.
4. `GET /api/admin/stats` (Bearer) → trend/topImages 구조 검증.
5. KST 날짜 경계 로직 검증(오프셋 계산 단위 테스트 or 수동).
6. 브라우저: 메인 HUD 숫자 노출 / 갤러리 카드 배지 / 라이트박스 뷰수 / 관리자 패널 렌더 실측.

## 9. 구현 분담
- **codex 서브에이전트:** §3 DO + §4 라우트 + §5 wrangler (`gallery-worker/src/index.js`, `wrangler.toml`). 난이도 높음.
- **Claude 서브에이전트 A:** §6 `index.html` HUD 위젯.
- **Claude 서브에이전트 B:** §6 `gallery.html` 카드 배지 + 라이트박스 + 관리자 패널.
- **포폴군:** 스펙·검증·배포·문서 싱크.

## 10. 게이트(gotchas) — 배포 전 검증 필수
- DO(SQLite)는 무료 플랜에서 `new_sqlite_classes` 필수. `compatibility_date` SQLite-DO 지원 날짜 이상인지 확인(2025-03-01로 상향).
- 첫 배포 시 마이그레이션 `tag="v1"` 적용 — 롤백 시 tag 관리 주의.
- KV write는 TTL 게이트로만(트래픽당 write 금지).
- DO stub fetch는 내부 URL 스킴 필요(`https://do/...` 형태) — 구현 시 경로 라우팅 규약 통일.
