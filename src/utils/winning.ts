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

// Check the winning rank of a set of numbers (0 = no prize)
export function checkWinning(myNumbers: number[], winningNumbers: number[]): number {
  const mainWinningNumbers = winningNumbers.slice(0, 6);
  const bonusNumber = winningNumbers[6];

  const matchingCount = myNumbers.filter(n => mainWinningNumbers.includes(n)).length;

  if (matchingCount === 6) return 1;
  if (matchingCount === 5 && bonusNumber !== undefined && myNumbers.includes(bonusNumber)) return 2;
  if (matchingCount === 5) return 3;
  if (matchingCount === 4) return 4;
  if (matchingCount === 3) return 5;
  return 0;
}

// Generate QR check winning link
export function getCheckWinningLink(numbers: number[][], round: number): string {
  const nums = numbers.map(it => 'q' + it.map(n => String(n).padStart(2, '0')).join('')).join('');
  return `${URLS.CHECK_WINNING}?method=winQr&v=${round}${nums}`;
}
