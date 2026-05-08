# 🎰 동행복권 로또 자동구매

**실제 동행복권 계정으로 로또 6/45를 자동 구매하는 GitHub Action입니다.**

매주 정해진 시간에 GitHub Actions가 실행되어, 실제 동행복권 사이트에 로그인하고 로또를 자동 구매합니다. 
구매 결과는 GitHub Issue로 기록되며, 추첨 후 당첨 여부도 자동으로 확인됩니다.

## ✨ 주요 기능

| 기능             | 설명                         |
|----------------|----------------------------|
| 🤖 **자동번호 구매** | 게임 수만 정하면 번호는 자동 생성        |
| 📋 **결과 기록**   | 구매 내역이 GitHub Issue에 자동 정리 |
| 🏆 **당첨 확인**   | 기존 구매 이슈를 기준으로 당첨 여부 자동 확인 |

## 🚀 바로 시작

> **⚠️ 동행복권 예치금이 미리 충전되어 있어야 구매가 진행됩니다.**  
> 예치금이 없으면 워크플로우는 실행되지만 구매에 실패합니다.

### 1. 시크릿 설정

이 저장소의 **Settings > Secrets and variables > Actions > Repository secrets**에서 아래 값을 추가합니다.

| Name                 | 필수 여부 | 설명            |
|----------------------|:-----:|---------------|
| `DHLOTTERY_ID`       | ✅ 필수  | 동행복권 로그인 아이디  |
| `DHLOTTERY_PASSWORD` | ✅ 필수  | 동행복권 로그인 비밀번호 |

### 2. 워크플로우 실행

**Actions** 탭에서 `lotto-purchase.yml`을 활성화합니다.
바로 테스트하려면 **Run workflow**를 누릅니다.

## 🔗 링크

- 기본 워크플로우: [.github/workflows/lotto-purchase.yml](./.github/workflows/lotto-purchase.yml)
- 기여 가이드: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 보안 정책: [SECURITY.md](./SECURITY.md)
- 라이선스: MIT
