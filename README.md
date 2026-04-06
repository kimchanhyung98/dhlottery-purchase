# 🎰 동행복권 로또 자동구매

GitHub Actions로 동행복권 로또 6/45를 자동 구매하는 프로젝트입니다.

이 저장소는 fork만 하면 바로 써볼 수 있게 만들어져 있습니다.

- 매주 자동 5게임 구매하는 기본 workflow 파일이 이미 포함되어 있습니다.
- 구매 결과는 GitHub Issue로 정리되며, 추첨 후 당첨 여부도 자동으로 확인됩니다.

## 🚀 바로 시작

1. 이 저장소를 **Fork**합니다.
2. fork한 저장소의 **Actions** 탭으로 이동합니다.
3. 안내 문구가 보이면 **I understand my workflows, go ahead and enable them** 을 눌러 활성화합니다.
4. **Settings > Secrets and variables > Actions** 에 아래 시크릿을 추가합니다.

| Name                 | 필수 여부 | 설명             |
| -------------------- | :-------: |----------------|
| `DHLOTTERY_ID`       |  ✅ 필수  | 동행복권 로그인 아이디   |
| `DHLOTTERY_PASSWORD` |  ✅ 필수  | 동행복권 로그인 비밀번호  |
| `TELEGRAM_BOT_TOKEN` |   선택    | 알림용 텔레그램 봇 토큰  |
| `TELEGRAM_CHAT_ID`   |   선택    | 알림용 텔레그램 채팅 ID |

5. **Actions** 탭에서 `lotto-purchase.yml` workflow를 엽니다.
6. 비활성화 상태라면 **Enable workflow** 를 누릅니다.
7. 바로 실행하려면 **Run workflow** 를 누릅니다.

💡 참고:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 추가하면 구매/당첨 알림을 받을 수 있습니다. 설정하지 않으면 텔레그램 알림만 비활성화됩니다.
- public repo를 fork한 경우 `schedule` 실행은 기본 비활성화될 수 있으니, 필요하면 fork 후 직접 활성화해야 합니다.
- 동행복권 예치금은 미리 충전되어 있어야 합니다.
- `GITHUB_TOKEN`은 GitHub가 자동으로 제공하므로 직접 추가할 필요가 없습니다.

## 🛠️ 워크플로우 예제

기본 workflow는 [lotto-purchase.yml](./.github/workflows/lotto-purchase.yml)에 이미 포함되어 있습니다.

기본값은 자동 5게임 구매 예제이며, `workflow-file` 한 줄만 바꿔서 다른 예제로 교체할 수 있습니다.

```yaml
workflow-file: custom-workflows/01-auto-basic.js
# workflow-file: custom-workflows/02-manual-fixed-numbers.js
# workflow-file: custom-workflows/03-auto-plus-manual.js
```

`custom-workflows/` 폴더에 바로 복사해서 쓰기 쉬운 예제가 들어 있습니다.

- `01-auto-basic.js`: 자동 5게임 구매
- `02-manual-fixed-numbers.js`: 고정 번호 수동 구매
- `03-auto-plus-manual.js`: 자동 구매 + 수동 구매 조합
- `04-gemini-recommendation.js`: Gemini API 연동 예제

예제별 사용법과 커스텀 workflow에서 사용할 수 있는 API 설명은 [custom-workflows/README.md](./custom-workflows/README.md)를 참고하세요.

## 🔗 링크

- 기여 가이드: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 보안 정책: [SECURITY.md](./SECURITY.md)
- 라이선스: MIT
