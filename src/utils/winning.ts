import axios from 'axios';
import { URLS } from '../core/config';

// Fetch winning numbers for a specific round
export async function fetchWinningNumbers(round: number): Promise<number[]> {
  try {
    const response = await axios.get(
      `https://dhlottery.co.kr/lt645/selectPstLt645Info.do?srchStrLtEpsd=${round}&srchEndLtEpsd=${round}`
    );

    const item = response.data.data?.list?.[0];
    if (!item) {
      throw new Error(`No winning numbers found for round ${round}`);
    }

    // Return 7 numbers: 6 main winning numbers + 1 bonus number
    return [item.tm1WnNo, item.tm2WnNo, item.tm3WnNo, item.tm4WnNo, item.tm5WnNo, item.tm6WnNo, item.bnsWnNo];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Network error fetching winning numbers: ${error.message}`);
    }
    throw error;
  }
}

// Check if a set of numbers wins
export function checkWinning(
  myNumbers: number[],
  winningNumbers: number[]
): { rank: number; matchedNumbers: number[] } {
  const mainWinningNumbers = winningNumbers.slice(0, 6);
  const bonusNumber = winningNumbers[6];

  const matchedNumbers = myNumbers.filter(n => mainWinningNumbers.includes(n));
  const matchingCount = matchedNumbers.length;

  let rank = 0;

  if (matchingCount === 6) {
    rank = 1; // 1st prize
  } else if (matchingCount === 5 && myNumbers.includes(bonusNumber!)) {
    matchedNumbers.push(bonusNumber!);
    rank = 2; // 2nd prize
  } else if (matchingCount === 5) {
    rank = 3; // 3rd prize
  } else if (matchingCount === 4) {
    rank = 4; // 4th prize
  } else if (matchingCount === 3) {
    rank = 5; // 5th prize
  }

  return { rank, matchedNumbers };
}

// Generate QR check winning link
export function getCheckWinningLink(numbers: number[][], round: number): string {
  const nums = numbers.map(it => 'q' + it.map(n => String(n).padStart(2, '0')).join('')).join('');
  return `${URLS.CHECK_WINNING}?method=winQr&v=${round}${nums}`;
}
