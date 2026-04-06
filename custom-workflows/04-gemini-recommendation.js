/**
 * 04. Gemini 추천 번호 예제
 *
 * GEMINI_API_KEY 환경변수가 필요합니다.
 * Gemini가 추천한 번호 1게임을 수동 구매합니다.
 * 응답이 비어 있거나 형식이 맞지 않으면 FALLBACK_NUMBERS를 사용합니다.
 *
 * 필요 설정:
 * - GitHub Secrets에 GEMINI_API_KEY 추가 필요
 * - workflow yml에서 env: GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }} 설정
 *
 * 이 실행이 끝나면 구매 결과는 GitHub Issue 1개로 정리됩니다.
 */
const MODEL = 'gemini-2.5-flash';
const FALLBACK_NUMBERS = [3, 7, 12, 23, 31, 42];

export default async ({ purchaseManual }) => {
  console.log('=== 04-gemini-recommendation 시작 ===');

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 없습니다. workflow env에 secrets.GEMINI_API_KEY를 연결해 주세요.');
  }

  let numbers = FALLBACK_NUMBERS;

  try {
    const recommended = await requestGeminiNumbers();
    if (recommended) {
      numbers = recommended;
      console.log('Gemini 추천 번호를 사용합니다:', numbers);
    } else {
      console.log('Gemini 응답을 해석하지 못해 기본 번호를 사용합니다:', numbers);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Gemini 호출에 실패해 기본 번호를 사용합니다: ${message}`);
  }

  const purchased = await purchaseManual([numbers]);
  console.log('구매 완료:', purchased);
};

async function requestGeminiNumbers() {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: '로또 번호 1게임을 추천해 주세요. 1부터 45 사이 숫자 6개를 중복 없이 골라서 쉼표로만 답변해 주세요. 예: 3, 7, 12, 23, 31, 42'
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API 요청 실패 (${response.status})`);
  }

  const data = await response.json();
  const text =
    data.candidates
      ?.flatMap(candidate => candidate.content?.parts ?? [])
      .map(part => part.text ?? '')
      .join('\n') ?? '';

  console.log('Gemini 응답:', text);

  return parseRecommendedNumbers(text);
}

function parseRecommendedNumbers(text) {
  const numbers = text
    .match(/\d+/g)
    ?.map(Number)
    .filter(num => num >= 1 && num <= 45);

  if (!numbers) {
    return null;
  }

  const uniqueNumbers = [...new Set(numbers)].slice(0, 6).sort((a, b) => a - b);

  if (uniqueNumbers.length !== 6) {
    return null;
  }

  return uniqueNumbers;
}
