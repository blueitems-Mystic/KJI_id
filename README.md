# Kim Jong-il (김종일) — Portfolio

레트로 RPG / 픽셀 게임 스타일을 모티프로 한 개인 포트폴리오 사이트.

- 🌐 **Live Site**: <https://blueitems-mystic.github.io/KJI_id/>
- 🖼️ **Gallery**: <https://blueitems-mystic.github.io/KJI_id/gallery.html>

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프론트엔드 | React 17 (CDN) + Babel Standalone |
| 스타일 | Tailwind CDN + 인라인 CSS (Press Start 2P / Gowun Dodum) |
| 백엔드 API | Cloudflare Worker (`gallery-worker/`) |
| 스토리지 | Cloudflare KV (`GALLERY_KV`) |
| 이미지 CDN | Cloudinary |
| 호스팅 | GitHub Pages |

빌드 단계 없음. 모든 JS는 브라우저에서 Babel Standalone으로 실시간 트랜스파일됩니다.

---

## 라이선스 / 저작권 — 권리 영역 분리

이 저장소는 두 가지 권리 영역으로 명확히 분리되어 있습니다.

### 1️⃣ 코드 (Code) — [MIT License](LICENSE)

다음 파일들은 MIT License로 자유롭게 사용 가능합니다:

- `index.html` — 포트폴리오 페이지 구조 / React 컴포넌트 / 상태 관리 로직
- `gallery.html` — 갤러리 SPA 구조 / 마소너리 그리드 / 라이트박스 로직
- `gallery-worker/**` — Cloudflare Worker 라우트 / Cloudinary 프록시 / KV 스키마
- 설정 파일 (`.gitignore`, `wrangler.toml` 등)

✅ **자유롭게 가능**
- 학습 / 분석 / 포크
- 본인 프로젝트에 코드 패턴 차용
- 수정 / 재배포 / 상업적 사용 (콘텐츠는 별개)

⚠️ **의무**
- 저작권 표시(`Copyright (c) 2026 Kim Jong-il`) 유지
- LICENSE 파일 또는 동일한 고지 포함

### 2️⃣ 콘텐츠 (Content) — © 2026 Kim Jong-il, All Rights Reserved

다음 항목은 **MIT 적용 대상이 아니며**, 무단 사용·복제·재배포·2차 가공이 금지됩니다:

| 항목 | 위치 |
|------|------|
| 사이트 시각 디자인 / UI 컨셉 (레트로 RPG·픽셀 게임 표현) | `index.html` 내 비주얼 |
| 프로필 이미지 | `KJI_Profilel00.gif` |
| 자기소개 / 경력 / 프로젝트 설명 텍스트 | `index.html` 본문 |
| 갤러리 이미지 · 영상 일체 | Cloudinary `kji-gallery/`, `kji-portfolio/` |
| 이름 · 개인 식별 정보 | "Kim Jong-il" / "김종일" 및 관련 표기 |

---

## 가져다 쓰는 방법

### ✅ 권장되는 사용 예시

- 코드 구조나 React 패턴을 학습 목적으로 분석
- Cloudflare Worker + Cloudinary 갤러리 백엔드 패턴을 본인 프로젝트에 응용
- 본인 콘텐츠로 교체하여 본인 포트폴리오로 활용

### 📋 본인 포트폴리오로 활용하려면 — 체크리스트

1. **`KJI_Profilel00.gif` 삭제** → 본인 프로필 이미지로 교체
2. **`index.html` 내 텍스트 전면 교체** — 이름 / 자기소개 / 경력 / 프로젝트 / 연락처
3. **`gallery.html` 갤러리 이미지 데이터 초기화** — Cloudinary 새 계정·폴더로 교체
4. **`gallery-worker/wrangler.toml`** — `CLOUDINARY_CLOUD_NAME`, `ALLOWED_ORIGIN`을 본인 값으로 변경
5. **본인 Cloudflare 계정에 Worker 새로 배포** + 시크릿 등록 (`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `ADMIN_TOKEN`)
6. **저작권 표시 유지** — `LICENSE` 파일과 README의 MIT 고지 그대로 둠

### 🚫 금지되는 사용 예시

- 콘텐츠(프로필 / 텍스트 / 이미지)를 그대로 둔 채 본인 사이트인 양 게시
- 디자인 / 레이아웃을 시각적으로 동일하게 복제
- "김종일" / "Kim Jong-il" 명의 사칭 또는 도용
- 갤러리에 게시된 작업물(이미지·영상)의 무단 재사용

---

## 빌드 & 배포

### GitHub Pages (자동)

```bash
git push origin main
```

→ 1~2분 후 <https://blueitems-mystic.github.io/KJI_id/> 자동 반영

### Cloudflare Worker (수동, 코드 변경 시만)

```bash
cd gallery-worker
npx wrangler deploy
```

---

## 문의

라이선싱·콘텐츠 사용·협업 관련 문의는 GitHub Issue 또는 저장소 소유자 프로필을 통해 연락해 주세요.
