import * as core from '@actions/core';
import { BrowserSession } from './core/browser';
import { purchaseAuto } from './core/purchase';
import { initLabels, createPurchaseIssue, checkWinningIssues } from './github/issues';

async function run() {
  const session = new BrowserSession();

  try {
    const id = core.getInput('dhlottery-id', { required: true });
    const pwd = core.getInput('dhlottery-password', { required: true });
    const amount = parseInt(core.getInput('game-count') || '5');

    console.log('[Main] Starting lotto purchase action');

    console.log('[Main] Initializing browser session');
    await session.init({
      headless: true,
      args: ['--no-sandbox']
    });

    console.log('[Main] Logging in');
    await session.login(id, pwd);

    console.log('[Main] Initializing GitHub labels');
    await initLabels();

    console.log('[Main] Checking winning for previous purchases');
    await checkWinningIssues();

    console.log(`[Main] Running auto purchase: ${amount} games`);
    const numbers = await purchaseAuto(session, amount);
    console.log(`[Main] Auto purchase successful: ${numbers.length} games`);

    await createPurchaseIssue(numbers);
  } catch (error) {
    if (error instanceof Error) {
      console.error('[Main] Workflow error:', error.message);
      core.setFailed(error.message);
    } else {
      console.error('[Main] Workflow error:', error);
      core.setFailed(String(error));
    }
  } finally {
    console.log('[Main] Closing browser session');
    await session.close();

    console.log('[Main] Action completed');
  }
}

run();
