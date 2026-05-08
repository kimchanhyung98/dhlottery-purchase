# 🎰 동행복권 로또 자동구매

**실제 동행복권 계정으로 로또 6/45를 자동 구매하는 GitHub Action입니다.**

매주 정해진 시간에 GitHub Actions가 실행되어, 실제 동행복권 사이트에 로그인하고 로또를 자동 구매합니다. 구매 결과는 GitHub Issue로 기록되며, 추첨 후 당첨 여부도 자동으로 확인됩니다.

## ✨ 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🤖 **자동번호 구매** | 게임 수만 정하면 번호는 자동 생성 |
| 📋 **결과 기록** | 구매 내역이 GitHub Issue에 자동 정리 |
| 🏆 **당첨 확인** | 기존 구매 이슈를 기준으로 당첨 여부 자동 확인 |

## 🚀 바로 시작

> **⚠️ 동행복권 예치금이 미리 충전되어 있어야 구매가 진행됩니다.**
> 예치금이 없으면 워크플로우는 실행되지만 구매에 실패합니다.

### 방법 1: Fork (가장 간단)

> **📢 참고**: Fork한 저장소는 **public**이므로, **구매 이력(GitHub Issue)이 누구나 볼 수 있습니다.**
> 구매 이력을 비공개로 유지하고 싶다면 아래 **방법 2**를 사용하세요.

1. 이 저장소를 **Fork**합니다.
2. Fork한 저장소의 **Actions** 탭에서 **I understand my workflows, go ahead and enable them**을 눌러 활성화합니다.
3. **Settings > Secrets and variables > Actions > Repository secrets**에서 **New repository secret** 버튼을 눌러 시크릿을 추가합니다. (아래 표 참고)
4. **Actions** 탭에서 `lotto-purchase.yml`의 **Enable workflow**를 누릅니다.
5. 바로 테스트하려면 **Run workflow**를 누릅니다.

### 방법 2: Clone → 내 Private 저장소로 Push

구매 이력을 비공개로 유지하고 싶다면 이 방법을 추천합니다.

1. GitHub에서 **New Repository**를 만들고 **Private**을 선택합니다. (README 추가 체크 해제)
2. 아래 명령어를 실행합니다.

```bash
git clone https://github.com/kkd927/lotto-purchase-action.git
cd lotto-purchase-action

# 위에서 만든 private 저장소로 remote 변경
git remote set-url origin https://github.com/<내-계정>/<내-저장소>.git
git push -u origin main
```

이후 설정은 Fork 방식과 동일합니다. (시크릿 추가 → 워크플로우 활성화)

> **💡 Tip**: Private 저장소의 GitHub Actions는 월 무료 한도(2,000분)가 적용됩니다.
> 이 워크플로우는 1회 실행에 약 1~2분이므로, 매주 실행해도 충분합니다.

### 시크릿 설정

**Settings > Secrets and variables > Actions > Repository secrets > New repository secret** 버튼을 눌러 아래 항목을 추가합니다.

| Name | 필수 여부 | 설명 |
| --- | :---: | --- |
| `DHLOTTERY_ID` | ✅ 필수 | 동행복권 로그인 아이디 |
| `DHLOTTERY_PASSWORD` | ✅ 필수 | 동행복권 로그인 비밀번호 |

> **💡 참고**: `GITHUB_TOKEN`은 GitHub가 자동으로 제공하므로 직접 추가할 필요가 없습니다.

## 🔒 비밀번호는 안전한가요?

**안전합니다.** 동행복권 아이디와 비밀번호는 [GitHub Actions Secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)에 저장됩니다.

- Secrets는 **암호화**되어 저장되며, 한 번 등록하면 누구도 다시 볼 수 없습니다.
- 워크플로우 실행 로그에서도 `***`로 자동 마스킹되어 **절대 노출되지 않습니다.**
- Fork한 다른 사람도, 저장소 관리자 본인도 등록된 값을 확인할 수 없습니다.

자세한 보안 정책은 [SECURITY.md](./SECURITY.md)를 참고하세요.

## 🛠️ 워크플로우 예제

기본 워크플로우는 [lotto-purchase.yml](./.github/workflows/lotto-purchase.yml)에 포함되어 있습니다.

```yaml
- uses: ./
  with:
    dhlottery-id: ${{ secrets.DHLOTTERY_ID }}
    dhlottery-password: ${{ secrets.DHLOTTERY_PASSWORD }}
    github-token: ${{ github.token }}
    game-count: '5'
```

## 🔗 링크

- 기본 워크플로우: [.github/workflows/lotto-purchase.yml](./.github/workflows/lotto-purchase.yml)
- 기여 가이드: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 보안 정책: [SECURITY.md](./SECURITY.md)
- 라이선스: MIT
