# portfolio-web

개인용 자산관리 앱 프론트엔드 (Phase 1: 로그인, 거래입력, 대시보드)

## 설정 방법

1. `js/config.js` 파일을 열어 아래 두 값을 본인 Supabase 프로젝트 값으로 교체합니다.
   - `SUPABASE_URL` — Project Settings → API Keys 의 Project URL
   - `SUPABASE_ANON_KEY` — 같은 화면의 anon/publishable 키

2. Supabase 대시보드 → Authentication → URL Configuration 에서
   **Site URL**과 **Redirect URLs**에 GitHub Pages 배포 주소를 등록합니다.
   (예: `https://<계정명>.github.io/portfolio-web/`)
   등록하지 않으면 매직링크 클릭 후 로그인이 정상 처리되지 않습니다.

3. 이 폴더 전체를 `portfolio-web` 저장소의 `main` 브랜치 루트에 커밋·푸시합니다.

4. GitHub 저장소 Settings → Pages 에서 배포된 주소로 접속해 확인합니다.

## 사용 순서 (최초 1회)

1. 이메일로 로그인
2. **계좌·종목** 탭에서 계좌 1개 이상, 종목 1개 이상 등록
3. **거래입력** 탭에서 실제 거래 내역 입력
4. **대시보드** 탭에서 보유 현황 확인

> 환율(`fx_rates`)과 종가(`prices_daily`)는 아직 자동 수집되지 않습니다 (Phase 2 이후).
> 지금은 SQL Editor에서 수동으로 한 행씩 넣어 테스트하세요:
> ```sql
> insert into fx_rates (rate_date, pair, rate) values (current_date, 'USD/KRW', 1400);
> insert into prices_daily (asset_id, price_date, close) values ('<asset_id>', current_date, 190.5);
> ```
