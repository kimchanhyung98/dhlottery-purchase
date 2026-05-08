import { getOctokit, getRepo, getContext } from './client';
import { fetchWinningNumbers, checkWinning, getCheckWinningLink } from '../utils/winning';
import { getLastLottoRound, getNextLottoRound } from '../utils/rounds';

// Labels for GitHub Issues
const LABELS = {
  waiting: ':hourglass:',
  losing: ':skull_and_crossbones:',
  winning_1st: ':confetti_ball: :1st_place_medal:',
  winning_2nd: ':confetti_ball: :2nd_place_medal:',
  winning_3rd: ':confetti_ball: :3rd_place_medal:',
  winning_4th: ':tada: :four:',
  winning_5th: ':tada: :five:'
};

// Initialize labels
export async function initLabels(): Promise<void> {
  const octokit = getOctokit();
  const repo = getRepo();

  const allLabels = (await octokit.rest.issues.listLabelsForRepo(repo)).data;
  const existingLabelNames = new Set(allLabels.map(label => label.name));

  // Only ensure the labels used by this action exist.
  // Never delete unrelated repository labels such as bug/enhancement.
  await Promise.allSettled(
    Object.entries(LABELS)
      .filter(([, name]) => !existingLabelNames.has(name))
      .map(([description, name]) => octokit.rest.issues.createLabel({ name, description, ...repo }))
  );
}

// Purchase metadata interface
export interface PurchaseMetadata {
  type: 'auto' | 'manual';
  numbers: number[][];
  timestamp: string;
}

// Create a GitHub Issue for purchases of the upcoming round
export async function createConsolidatedIssue(purchases: PurchaseMetadata[]): Promise<void> {
  const octokit = getOctokit();
  const repo = getRepo();

  const round = getNextLottoRound();
  const totalGames = purchases.reduce((sum, p) => sum + p.numbers.length, 0);

  const body = buildIssueBody(purchases, round);

  await octokit.rest.issues.create({
    ...repo,
    title: `제${round}회 ${totalGames}게임`,
    body,
    labels: [LABELS.waiting]
  });

  console.log(`Created issue for ${purchases.length} purchases (${totalGames} total games) for round ${round}`);
}

// Get all waiting issues (bug fix: get ALL open issues with waiting label)
export async function getWaitingIssues() {
  const octokit = getOctokit();
  const repo = getRepo();

  const issues = await octokit.rest.issues.listForRepo({
    ...repo,
    state: 'open',
    labels: LABELS.waiting,
    per_page: 100
  });

  return issues.data;
}

// Winning result for an issue
export interface WinningResult {
  issueNumber: number;
  round: number;
  ranks: number[];
}

// Check winning for all waiting issues
export async function checkWinningIssues(): Promise<WinningResult[]> {
  console.log('[Issues] Checking winning for waiting issues');
  const winningResults: WinningResult[] = [];

  const issues = await getWaitingIssues();
  console.log(`[Issues] Found ${issues.length} waiting issues`);

  if (issues.length === 0) {
    console.log('[Issues] No waiting issues to check');
    return winningResults;
  }

  const currentRound = getLastLottoRound();

  for (const issue of issues) {
    try {
      const body = issue.body || '';
      let round: number;
      let allNumbers: number[][];

      // Detect format and parse accordingly
      if (isNewFormat(body)) {
        const parsed = parseNewIssueBody(body);
        round = parsed.round;
        allNumbers = parsed.numbers;
        console.log(`[Issues] Checking issue #${issue.number} with ${allNumbers.length} games`);
      } else if (isConsolidatedFormat(body)) {
        const parsed = parseConsolidatedIssueBody(body);
        round = parsed.round;
        allNumbers = parsed.purchases.flatMap(p => p.numbers);
        console.log(
          `[Issues] Checking consolidated issue #${issue.number} with ${parsed.purchases.length} purchases (${allNumbers.length} games)`
        );
      } else {
        const parsed = parseIssueBody(body);
        round = parsed.round;
        allNumbers = parsed.numbers;
        console.log(`[Issues] Checking legacy issue #${issue.number} with ${allNumbers.length} games`);
      }

      // Skip if winning numbers not available yet
      if (round > currentRound) {
        console.log(`[Issues] Issue #${issue.number}: Round ${round} not drawn yet (current: ${currentRound})`);
        continue;
      }

      console.log(`[Issues] Checking issue #${issue.number} for round ${round}`);

      // Fetch winning numbers
      const winningNumbers = await fetchWinningNumbers(round);

      // Check each game
      const ranks = allNumbers.map(nums => {
        const result = checkWinning(nums, winningNumbers);
        return result.rank;
      });

      // Update issue with results
      await updateIssueWithResults(issue.number, ranks);

      // Track winning results for notifications
      const hasWinning = ranks.some(r => r > 0);
      if (hasWinning) {
        winningResults.push({ issueNumber: issue.number, round, ranks });
      }

      console.log(`[Issues] Issue #${issue.number} updated with ranks:`, ranks);
    } catch (error) {
      console.error(`[Issues] Error checking issue #${issue.number}:`, error);
    }
  }

  console.log('[Issues] Finished checking all waiting issues');
  return winningResults;
}

// Update issue with winning results
async function updateIssueWithResults(issueNumber: number, ranks: number[]): Promise<void> {
  const octokit = getOctokit();
  const repo = getRepo();
  const context = getContext();

  // Convert ranks to labels
  const labels = ranks.map(rankToLabel);

  // Check if all games lost
  const allLost = ranks.every(r => r === 0);

  if (allLost) {
    // Close issue if all games lost
    await octokit.rest.issues.update({
      ...repo,
      issue_number: issueNumber,
      state: 'closed',
      labels
    });
  } else {
    // Add comment and update labels if won
    const winningGames = ranks.filter(r => r > 0).length;
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: `@${context.repo.owner} ${winningGames}게임에 당첨됐습니다!`
    });

    // Remove losing labels and keep only winning ones
    const winningLabels = labels.filter(l => l !== LABELS.losing);
    await octokit.rest.issues.update({
      ...repo,
      issue_number: issueNumber,
      labels: winningLabels
    });
  }
}

// Helper: Convert rank to label
function rankToLabel(rank: number): string {
  const labelMap = [
    LABELS.losing, // rank 0
    LABELS.winning_1st, // rank 1
    LABELS.winning_2nd, // rank 2
    LABELS.winning_3rd, // rank 3
    LABELS.winning_4th, // rank 4
    LABELS.winning_5th // rank 5
  ];

  return labelMap[rank] ?? LABELS.losing;
}

// Helper: Detect current "## 제{round}회 구매 내역" format
function isNewFormat(body: string): boolean {
  return /^##\s*제\d+회\s*구매 내역/m.test(body);
}

// Helper: Parse current format — extracts round from heading and numbers from table rows
function parseNewIssueBody(body: string): { round: number; numbers: number[][] } {
  const roundMatch = body.match(/##\s*제(\d+)회/);
  const round = roundMatch?.[1] ? Number(roundMatch[1]) : 0;

  const numbers: number[][] = [];
  const rowRe = /^\|\s*\d+\s*\|\s*([\d,\s]+?)\s*\|\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(body)) !== null) {
    const nums = match[1]!.split(',').map(s => Number(s.trim()));
    if (nums.length === 6 && nums.every(n => Number.isInteger(n) && n >= 1 && n <= 45)) {
      numbers.push(nums);
    }
  }

  return { round, numbers };
}

// Helper: Detect legacy "## Purchase #N" consolidated format
function isConsolidatedFormat(body: string): boolean {
  return body.includes('## Purchase');
}

// Helper: Extract value after the first ":" — preserves colons inside the value (e.g. URLs)
function getFieldValue(line: string): string {
  return line.split(':').slice(1).join(':').trim();
}

// Helper: Parse consolidated issue body (new format)
function parseConsolidatedIssueBody(body: string): {
  workflowRun: string;
  round: number;
  purchases: Array<{
    type: 'auto' | 'manual';
    timestamp: string;
    numbers: number[][];
    link: string;
  }>;
} {
  const lines = body.split('\n');

  // Parse header
  const workflowRun = getFieldValue(lines[0] || '');
  const round = Number(getFieldValue(lines[1] || ''));

  // Parse purchases
  const purchases: Array<{
    type: 'auto' | 'manual';
    timestamp: string;
    numbers: number[][];
    link: string;
  }> = [];

  let currentPurchase: any = null;

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.startsWith('## Purchase')) {
      // Save previous purchase if exists
      if (currentPurchase) {
        purchases.push(currentPurchase);
      }
      // Start new purchase
      currentPurchase = {};
    } else if (currentPurchase && line.includes(':')) {
      const key = line.split(':')[0]?.trim();
      const value = getFieldValue(line);

      if (key === 'timestamp') {
        currentPurchase.timestamp = value;
      } else if (key === 'type') {
        currentPurchase.type = value as 'auto' | 'manual';
      } else if (key === 'numbers') {
        currentPurchase.numbers = JSON.parse(value || '[]');
      } else if (key === 'link') {
        currentPurchase.link = value;
      }
    }
  }

  // Save last purchase
  if (currentPurchase) {
    purchases.push(currentPurchase);
  }

  return { workflowRun, round, purchases };
}

// Helper: Parse issue body (legacy format — kept only to read pre-existing issues)
function parseIssueBody(body: string): { date: string; round: number; numbers: number[][]; link: string } {
  const lines = body.split('\n');

  return {
    date: getFieldValue(lines[0] || ''),
    round: Number(getFieldValue(lines[1] || '')),
    numbers: JSON.parse(getFieldValue(lines[2] || '') || '[]'),
    link: getFieldValue(lines[3] || '')
  };
}

// Helper: Build issue body — "## 제{round}회 구매 내역" + table + winning link
function buildIssueBody(purchases: PurchaseMetadata[], round: number): string {
  const allNumbers = purchases.flatMap(p => p.numbers);
  const link = getCheckWinningLink(allNumbers, round);

  const rows = allNumbers
    .map((nums, idx) => `| ${idx + 1} | ${nums.map(n => String(n).padStart(2, '0')).join(', ')} |`)
    .join('\n');

  return `## 제${round}회 구매 내역\n\n| # | 번호 |\n| --- | --- |\n${rows}\n\n[당첨 확인하기](${link})`;
}
