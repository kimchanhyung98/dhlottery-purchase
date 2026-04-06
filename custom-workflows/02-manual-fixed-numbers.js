/**
 * 02. 고정 번호 수동 구매 예제
 *
 * 아래 NUMBERS 배열만 바꿔서 사용하세요.
 * 각 게임은 1~45 사이 숫자 6개로 구성해야 하고, 중복이 있으면 안 됩니다.
 * 한 번에 최대 5게임까지 구매할 수 있습니다.
 * 이 실행이 끝나면 구매 결과는 GitHub Issue 1개로 정리됩니다.
 */

const NUMBERS = [
  [3, 11, 15, 29, 35, 44],
  [7, 9, 23, 28, 33, 41]
];

export default async ({ purchaseManual }) => {
  console.log('=== 02-manual-fixed-numbers 시작 ===');
  console.log('고정 번호로 수동 구매를 진행합니다.');

  const purchased = await purchaseManual(NUMBERS);

  console.log('구매 완료:', purchased);
};
