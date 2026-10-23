# 읽고 싶은 책 아카이브

서울대 도서관과 평택시립 배다리도서관에서 빌릴 책을 고르는 서재입니다.

로컬에서 보려면 저장소 루트에서 `python3 -m http.server` 를 실행한 뒤 브라우저로 엽니다.

## 데이터

- `data/books.json` — `[분류, 제목, 저자, 표지]`
- `data/avail.json` — 도서관별 대출 상태

분류는 `H` 인문·사회·AI, `W` 일·자기계발, `N`(또는 `F`) 소설·에세이·시입니다.

## 갱신과 배포

`scripts/refresh.py` 가 소장 현황을 다시 받아 `data/avail.json` 에 씁니다. GitHub Actions가 매일 22:00 KST 무렵 이 스크립트를 실행합니다.

사이트는 `.github/workflows/pages.yml` 로 GitHub Pages에 배포됩니다. 저장소 설정에서 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 둡니다.
