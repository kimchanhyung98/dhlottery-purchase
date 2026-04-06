# 커스텀 워크플로우 가이드

이 폴더에는 바로 복사해서 쓰기 쉬운 예제 4개가 들어 있습니다.

모든 예제는 아래 형식을 따릅니다.

- `export default async (api) => {}`
- 성공한 구매는 실행 종료 후 GitHub Issue 1개로 정리됩니다.

처음이면 보통 `01 -> 02 -> 03 -> 04` 순서로 보는 것을 추천합니다.

## 어떤 예제를 쓰면 되나

| 파일                          | 용도                                      | 수정 포인트                         |
| ----------------------------- | ----------------------------------------- | ----------------------------------- |
| `01-auto-basic.js`            | 가장 먼저 실행해보기 좋은 기본 예제       | `GAME_COUNT`                        |
| `02-manual-fixed-numbers.js`  | 고정 번호를 직접 넣어 수동 구매할 때      | `NUMBERS`                           |
| `03-auto-plus-manual.js`      | 자동 구매와 수동 구매를 함께 쓰고 싶을 때 | `AUTO_GAME_COUNT`, `MANUAL_NUMBERS` |
| `04-gemini-recommendation.js` | Gemini API로 추천 번호를 받아 구매할 때   | `MODEL`, `FALLBACK_NUMBERS`         |

## workflow에 연결하는 방법

`.github/workflows/lotto-purchase.yml`에서 `workflow-file` 한 줄만 바꿔서 사용하면 됩니다.

```yaml
- uses: ./
  with:
    dhlottery-id: ${{ secrets.DHLOTTERY_ID }}
    dhlottery-password: ${{ secrets.DHLOTTERY_PASSWORD }}
    github-token: ${{ github.token }}
    workflow-file: custom-workflows/01-auto-basic.js
```

예제 교체 예시:

```yaml
workflow-file: custom-workflows/01-auto-basic.js
# workflow-file: custom-workflows/02-manual-fixed-numbers.js
# workflow-file: custom-workflows/03-auto-plus-manual.js
```

## 지원 포맷

- 권장: `.js` 또는 `.mjs` + `export default async (api) => {}`
- 대안: `.cjs` + `module.exports = async (api) => {}`

## 사용 가능한 API

### `purchaseAuto(amount)`

자동 구매를 실행합니다.

```javascript
const numbers = await purchaseAuto(5);
```

- `amount`: 구매 수량 (`1`~`5`)
- 반환값: `Promise<number[][]>`

### `purchaseManual(numbers)`

수동 구매를 실행합니다.

```javascript
await purchaseManual([
  [1, 2, 3, 4, 5, 6],
  [7, 8, 9, 10, 11, 12]
]);
```

- `numbers`: 6개 숫자로 이루어진 게임 배열
- 한 번에 최대 `5`게임까지 구매할 수 있습니다.
- 반환값: `Promise<number[][]>`

### `generateExcluding(exclude, count)`

특정 번호들을 제외하고 랜덤 번호를 생성합니다.

```javascript
const excluded = [[1, 2, 3, 4, 5, 6]];
const manualNumbers = generateExcluding(excluded, 3);
```

- `exclude`: 제외할 번호 세트 배열
- `count`: 생성할 게임 수
- 반환값: `number[][]`
- 주의: 이 함수는 조합을 제외하는 것이 아니라, `exclude`에 들어 있는 숫자들을 이후 게임에서 아예 사용하지 않습니다.

## Gemini 예제

`04-gemini-recommendation.js`를 쓰려면 `GEMINI_API_KEY`가 필요합니다.

```yaml
- uses: ./
  with:
    dhlottery-id: ${{ secrets.DHLOTTERY_ID }}
    dhlottery-password: ${{ secrets.DHLOTTERY_PASSWORD }}
    github-token: ${{ github.token }}
    workflow-file: custom-workflows/04-gemini-recommendation.js
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Gemini 응답이 비어 있거나 형식이 맞지 않으면 예제 파일 안의 `FALLBACK_NUMBERS`를 사용합니다.

## 작성 팁

- 가장 단순한 시작점은 `01-auto-basic.js`입니다.
- 번호를 직접 넣고 싶으면 `02-manual-fixed-numbers.js`를 복사해서 배열만 바꾸면 됩니다.
- 여러 전략을 섞고 싶으면 `03-auto-plus-manual.js`를 기준으로 수정하면 됩니다.
- `purchaseAuto`와 `purchaseManual`은 한 workflow 안에서 여러 번 호출해도 됩니다.

## 자주 막히는 경우

- `module is not defined in ES module scope`

원인:

- `.js` 파일에서 `module.exports`를 사용한 경우일 가능성이 큽니다.

해결:

- `.js`를 유지하고 `export default async (api) => {}`로 변경
- `module.exports`를 유지하고 파일 확장자를 `.cjs`로 변경
