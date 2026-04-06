// Generate random lotto numbers
export function generateRandomNumbers(count: number = 1): number[][] {
  const result: number[][] = [];

  for (let i = 0; i < count; i++) {
    // Generate 6 unique numbers from 1-45
    const numbers = Array.from({ length: 45 }, (_, idx) => idx + 1)
      .sort(() => Math.random() - 0.5)
      .slice(0, 6)
      .sort((a, b) => a - b);

    result.push(numbers);
  }

  return result;
}

// Generate random numbers excluding specific number sets
export function generateExcluding(exclude: number[][], count: number): number[][] {
  const result: number[][] = [];

  // Flatten all excluded numbers
  const excludedNumbers = new Set(exclude.flat());

  for (let i = 0; i < count; i++) {
    // Generate available numbers (1-45 minus excluded)
    const available = Array.from({ length: 45 }, (_, idx) => idx + 1).filter(num => !excludedNumbers.has(num));

    if (available.length < 6) {
      throw new Error('Not enough numbers available after exclusion');
    }

    // Pick 6 random numbers from available
    const numbers = available
      .sort(() => Math.random() - 0.5)
      .slice(0, 6)
      .sort((a, b) => a - b);

    result.push(numbers);
  }

  return result;
}

// Validate lotto numbers
export function validateLottoNumbers(numbers: number[][]): boolean {
  if (numbers.length === 0 || numbers.length > 5) {
    return false;
  }

  for (const gameNumbers of numbers) {
    if (gameNumbers.length !== 6) {
      return false;
    }

    // Check all numbers are integers between 1-45
    for (const num of gameNumbers) {
      if (!Number.isInteger(num) || num < 1 || num > 45) {
        return false;
      }
    }

    // Check for duplicates
    if (new Set(gameNumbers).size !== 6) {
      return false;
    }
  }

  return true;
}
