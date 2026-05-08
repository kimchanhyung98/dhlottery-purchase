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

// Create a GitHub Issue for an auto-purchased round
export async function createPurchaseIssue(numbers: number[][]): Promise<void> {
  const octokit = getOctokit();
  const repo = getRepo();

  const round = getNextLottoRound();
  const body = buildIssueBody(numbers, round);

  await octokit.rest.issues.create({
    ...repo,
    title: `제${round}회 ${numbers.length}게임`,
    body,
    labels: [LABELS.waiting]
  });

  console.log(`Created issue for ${numbers.length} games in round ${round}`);
}

// Get all waiting issues (open issues with the waiting label)
async function getWaitingIssues() {
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

// Check winning for all waiting issues
export async function checkWinningIssues(): Promise<void> {
  console.log('[Issues] Checking winning for waiting issues');

  const issues = await getWaitingIssues();
  console.log(`[Issues] Found ${issues.length} waiting issues`);

  if (issues.length === 0) {
    console.log('[Issues] No waiting issues to check');
    return;
  }

  const currentRound = getLastLottoRound();

  for (const issue of issues) {
    try {
      const { round, numbers } = parseIssueBody(issue.body || '');
      console.log(`[Issues] Checking issue #${issue.number} with ${numbers.length} games`);

      if (round > currentRound) {
        console.log(`[Issues] Issue #${issue.number}: Round ${round} not drawn yet (current: ${currentRound})`);
        continue;
      }

      const winningNumbers = await fetchWinningNumbers(round);
      const ranks = numbers.map(nums => checkWinning(nums, winningNumbers));

      await updateIssueWithResults(issue.number, ranks);

      console.log(`[Issues] Issue #${issue.number} updated with ranks:`, ranks);
    } catch (error) {
      console.error(`[Issues] Error checking issue #${issue.number}:`, error);
    }
  }

  console.log('[Issues] Finished checking all waiting issues');
}

// Update issue with winning results
async function updateIssueWithResults(issueNumber: number, ranks: number[]): Promise<void> {
  const octokit = getOctokit();
  const repo = getRepo();
  const context = getContext();

  const labels = ranks.map(rankToLabel);
  const allLost = ranks.every(r => r === 0);

  if (allLost) {
    await octokit.rest.issues.update({
      ...repo,
      issue_number: issueNumber,
      state: 'closed',
      labels
    });
    return;
  }

  const winningGames = ranks.filter(r => r > 0).length;
  await octokit.rest.issues.createComment({
    ...repo,
    issue_number: issueNumber,
    body: `@${context.repo.owner} ${winningGames}게임에 당첨됐습니다!`
  });

  const winningLabels = labels.filter(l => l !== LABELS.losing);
  await octokit.rest.issues.update({
    ...repo,
    issue_number: issueNumber,
    labels: winningLabels
  });
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

// Helper: Parse issue body — extracts round from heading and numbers from table rows.
// Throws on any unparseable row or body; callers handle the error and skip updating/closing the issue.
function parseIssueBody(body: string): { round: number; numbers: number[][] } {
  const roundMatch = body.match(/##\s*제(\d+)회/);
  const round = roundMatch?.[1] ? Number(roundMatch[1]) : 0;

  const candidateRows = body.split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
  const validRowRe = /^\|\s*\d+\s*\|\s*([\d,\s]+?)\s*\|\s*$/;

  const numbers: number[][] = candidateRows.map(row => {
    const match = row.match(validRowRe);
    if (!match) {
      throw new Error(`Malformed purchase row: "${row}"`);
    }
    const nums = match[1]!.split(',').map(s => Number(s.trim()));
    if (nums.length !== 6 || !nums.every(n => Number.isInteger(n) && n >= 1 && n <= 45)) {
      throw new Error(`Invalid lotto numbers in row: "${row}"`);
    }
    return nums;
  });

  if (round === 0 || numbers.length === 0) {
    throw new Error(`Unparseable issue body (round=${round}, rows=${numbers.length})`);
  }

  return { round, numbers };
}

// Helper: Build issue body — "## 제{round}회 구매 내역" + table + winning link
function buildIssueBody(numbers: number[][], round: number): string {
  const link = getCheckWinningLink(numbers, round);

  const rows = numbers
    .map((nums, idx) => `| ${idx + 1} | ${nums.map(n => String(n).padStart(2, '0')).join(', ')} |`)
    .join('\n');

  return `## 제${round}회 구매 내역\n\n| # | 번호 |\n| --- | --- |\n${rows}\n\n[당첨 확인하기](${link})`;
}
