# 읽고 싶은 책 아카이브

서울대 도서관과 평택시립 배다리도서관에서 빌릴 책을 고르는 서재입니다.

로컬에서 보려면 저장소 루트에서 `python3 -m http.server` 를 실행한 뒤 브라우저로 엽니다.

## 데이터

- `data/books.json` — `[분류, 제목, 저자, 표지]`. 소개 글이 있으면 다섯째 칸
- `data/avail.json` — 도서관별 대출 상태

배경은 이 서재를 위해 만든 그림 `assets/library_bg.jpg` 입니다.

소개 글은 `KAKAO_REST_API_KEY` 를 두고 `python3 scripts/fetch_blurbs.py` 를 실행하면 카카오 책 검색의 `contents` 가 채워집니다. 키가 없으면 파일을 바꾸지 않습니다.

`python3 scripts/cover_colors.py` 는 표지에서 책등 색을 뽑아 `#rrggbb` 로 넣습니다. 표지가 없는 책은 기본 색을 씁니다.

분류는 `H` 인문·사회·AI, `W` 일·자기계발, `N`(또는 `F`) 소설·에세이·시입니다.

## 갱신과 배포

`scripts/refresh.py` 가 소장 현황을 다시 받아 `data/avail.json` 에 씁니다. GitHub Actions가 매일 22:00 KST 무렵 이 스크립트를 실행합니다.

사이트는 `.github/workflows/pages.yml` 로 GitHub Pages에 배포됩니다. 사이트가 아직 없으면 워크플로가 대신 만들 수 없어서, 처음 한 번은 저장소 설정에서 직접 켭니다.

1. https://github.com/jhdsny/book-archive/settings/pages 를 연다.
2. **Build and deployment** 아래 **Source** 를 **GitHub Actions** 로 고른다.
3. https://github.com/jhdsny/book-archive/actions/workflows/pages.yml 에서 가장 최근 실행을 열고 **Re-run all jobs** 를 누른다.
