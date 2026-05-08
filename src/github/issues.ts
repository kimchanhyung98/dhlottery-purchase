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
      const { round, numbers: allNumbers } = parseIssueBody(issue.body || '');
      console.log(`[Issues] Checking issue #${issue.number} with ${allNumbers.length} games`);

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

// Helper: Parse issue body — extracts round from heading and numbers from table rows
function parseIssueBody(body: string): { round: number; numbers: number[][] } {
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

// Helper: Build issue body — "## 제{round}회 구매 내역" + table + winning link
function buildIssueBody(purchases: PurchaseMetadata[], round: number): string {
  const allNumbers = purchases.flatMap(p => p.numbers);
  const link = getCheckWinningLink(allNumbers, round);

  const rows = allNumbers
    .map((nums, idx) => `| ${idx + 1} | ${nums.map(n => String(n).padStart(2, '0')).join(', ')} |`)
    .join('\n');

  return `## 제${round}회 구매 내역\n\n| # | 번호 |\n| --- | --- |\n${rows}\n\n[당첨 확인하기](${link})`;
}
