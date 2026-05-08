import * as core from '@actions/core';
import { BrowserSession } from './core/browser';
import { purchaseAuto } from './core/purchase';
import { initLabels, createConsolidatedIssue, checkWinningIssues, type PurchaseMetadata } from './github/issues';

async function run() {
  const session = new BrowserSession();
  const purchases: PurchaseMetadata[] = []; // Track all successful purchases

  try {
    // Get inputs
    const id = core.getInput('dhlottery-id', { required: true });
    const pwd = core.getInput('dhlottery-password', { required: true });
    const amount = parseInt(core.getInput('game-count') || '5');

    console.log('[Main] Starting lotto purchase action');

    // Initialize browser and login
    console.log('[Main] Initializing browser session');
    await session.init({
      headless: true,
      args: ['--no-sandbox']
    });

    console.log('[Main] Logging in');
    await session.login(id, pwd);

    // Initialize GitHub labels
    console.log('[Main] Initializing GitHub labels');
    await initLabels();

    // Check previous purchases for winning
    console.log('[Main] Checking winning for previous purchases');
    await checkWinningIssues();

    console.log(`[Main] Running default auto purchase: ${amount} games`);
    const result = await purchaseAuto(session, amount);
    purchases.push({
      type: 'auto',
      numbers: result,
      timestamp: new Date().toISOString()
    });
    console.log(`[Main] Auto purchase successful: ${result.length} games`);

    console.log(`[Main] All purchases completed: ${purchases.length} total purchases`);
  } catch (error) {
    if (error instanceof Error) {
      console.error('[Main] Workflow error:', error.message);
      core.setFailed(error.message);
    } else {
      console.error('[Main] Workflow error:', error);
      core.setFailed(String(error));
    }
    // Continue to create issues for successful purchases
  } finally {
    // Create one consolidated issue for all successful purchases
    if (purchases.length > 0) {
      try {
        await createConsolidatedIssue(purchases);
        const totalGames = purchases.reduce((sum, p) => sum + p.numbers.length, 0);
        console.log(`[Main] Created consolidated issue for ${purchases.length} purchases (${totalGames} total games)`);
      } catch (error) {
        console.error(`[Main] Failed to create consolidated issue:`, error);
      }
    } else {
      console.log(`[Main] No successful purchases to create issue`);
    }

    // Close browser session
    console.log('[Main] Closing browser session');
    await session.close();

    console.log('[Main] Action completed');
  }
}

run();
