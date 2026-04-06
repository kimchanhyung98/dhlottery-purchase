/**
 * 03. 자동 + 수동 조합 예제
 *
 * 자동 구매 후, 직접 지정한 번호를 추가로 구매합니다.
 * custom workflow에서 API를 조합하는 가장 기본적인 패턴입니다.
 * 이 실행이 끝나면 구매 결과는 GitHub Issue 1개로 정리됩니다.
 */

const AUTO_GAME_COUNT = 2;

const MANUAL_NUMBERS = [
  [5, 12, 18, 27, 34, 42],
  [1, 14, 19, 22, 31, 45]
];

export default async ({ purchaseAuto, purchaseManual }) => {
  console.log('=== 03-auto-plus-manual 시작 ===');

  console.log(`자동 구매 ${AUTO_GAME_COUNT}게임을 진행합니다.`);
  const autoPurchased = await purchaseAuto(AUTO_GAME_COUNT);
  console.log('자동 구매 완료:', autoPurchased);

  console.log(`수동 구매 ${MANUAL_NUMBERS.length}게임을 진행합니다.`);
  const manualPurchased = await purchaseManual(MANUAL_NUMBERS);
  console.log('수동 구매 완료:', manualPurchased);
};
