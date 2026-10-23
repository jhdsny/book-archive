# 읽고 싶은 책 아카이브

서울대 도서관과 평택시립 배다리도서관에서 빌릴 책을 고르는 서재입니다.

로컬에서 보려면 저장소 루트에서 `python3 -m http.server` 를 실행한 뒤 브라우저로 엽니다.

## 데이터

- `data/books.json` — `[분류, 제목, 저자, 표지]`. 뒤에 소개 글, 책등 색 `#rrggbb`, 청구기호 `kdc:813.62` 가 올 수 있다
- `data/avail.json` — 도서관별 대출 상태

배경은 이 서재를 위해 만든 그림 `assets/library_bg.jpg` 입니다.

소개 글은 `KAKAO_REST_API_KEY` 를 두고 `python3 scripts/fetch_blurbs.py` 를 실행하면 카카오 책 검색의 `contents` 가 채워집니다. 키가 없으면 파일을 바꾸지 않습니다.

`python3 scripts/cover_colors.py` 는 표지에서 책등 색을 뽑아 `#rrggbb` 로 넣습니다. 표지가 없는 책은 기본 색을 씁니다.

첫째 칸의 `H` `W` `N` 은 예전 분류다. 서가에 보이는 분류는 한국십진분류다.

## 갱신과 배포

`scripts/refresh.py` 가 소장 현황을 `data/avail.json` 에, 한국십진분류 청구기호를 `data/books.json` 에 씁니다. 청구기호는 서울대 목록에 한국십진분류가 있으면 그것을 쓰고, 없으면 배다리 청구기호, 그래도 없으면 국립중앙도서관 소장을 본다. 서울대는 중앙도서관(관정관 포함)에 대출 가능한 책이 있을 때만 대출가능이고, 분관은 세지 않습니다. GitHub Actions가 매일 22:00 KST 무렵 이 스크립트를 실행합니다.

사이트는 `.github/workflows/pages.yml` 로 GitHub Pages에 배포됩니다. 사이트가 아직 없으면 워크플로가 대신 만들 수 없어서, 처음 한 번은 저장소 설정에서 직접 켭니다.

1. https://github.com/jhdsny/book-archive/settings/pages 를 연다.
2. **Build and deployment** 아래 **Source** 를 **GitHub Actions** 로 고른다.
3. https://github.com/jhdsny/book-archive/actions/workflows/pages.yml 에서 가장 최근 실행을 열고 **Re-run all jobs** 를 누른다.
