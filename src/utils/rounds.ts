import { THOUSAND_ROUND_DATE, WEEK_TO_MILLISECOND } from '../core/config';

// Get the next lotto round number
export function getNextLottoRound(): number {
  const standardDate = new Date(THOUSAND_ROUND_DATE);
  const now = new Date();
  const additionalRound = Math.floor((now.getTime() - standardDate.getTime()) / WEEK_TO_MILLISECOND) + 1;
  return 1000 + additionalRound;
}

// Get the last (current) lotto round number
export function getLastLottoRound(): number {
  const standardDate = new Date(THOUSAND_ROUND_DATE);
  const now = new Date();
  const additionalRound = Math.floor((now.getTime() - standardDate.getTime()) / WEEK_TO_MILLISECOND);
  return 1000 + additionalRound;
}
