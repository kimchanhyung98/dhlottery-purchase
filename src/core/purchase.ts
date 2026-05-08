import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Page } from 'playwright';
import type { BrowserSession } from './browser';
import { GOTO_TIMEOUT, PURCHASE_PAGE_READY_TIMEOUT, PURCHASE_RESULT_TIMEOUT, URLS, SELECTORS } from './config';

dayjs.extend(utc);
dayjs.extend(timezone);

// Validate purchase availability (time-based)
function validatePurchaseAvailability(): void {
  const now = dayjs.tz(Date.now(), 'Asia/Seoul');
  const isSaturday = now.day() === 6;

  const resetTime = (d: dayjs.Dayjs) => d.hour(0).minute(0).second(0).millisecond(0);
  const openingTime = resetTime(dayjs.tz(Date.now(), 'Asia/Seoul')).hour(6);
  const closingTime = isSaturday
    ? resetTime(dayjs.tz(Date.now(), 'Asia/Seoul')).hour(20)
    : resetTime(dayjs.tz(Date.now(), 'Asia/Seoul')).hour(24);

  if (now.isBefore(openingTime) || now.isAfter(closingTime)) {
    throw new Error('구매 가능 시간이 아닙니다 (평일/일요일: 06:00-24:00, 토요일: 06:00-20:00)');
  }
}

async function waitForVisible(page: Page, selector: string, timeout: number): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

async function dismissEnvironmentAlert(page: Page): Promise<void> {
  const alertConfirm = page.locator(SELECTORS.ENVIRONMENT_ALERT_CONFIRM).first();
  const isVisible = await alertConfirm.isVisible({ timeout: 2000 }).catch(() => false);

  if (!isVisible) {
    return;
  }

  console.log('[Purchase] Closing environment alert');
  await alertConfirm.click().catch(() => undefined);
  await page.waitForTimeout(500);
}

async function getPurchaseDiagnostics(page: Page): Promise<string> {
  const title = await page.title().catch(() => 'unknown');
  const bodySnippet = await page
    .locator('body')
    .innerText()
    .then(text => text.replace(/\s+/g, ' ').slice(0, 300))
    .catch(() => '');

  return [`URL: ${page.url()}`, `title: ${title}`, `bodySnippet: ${bodySnippet || 'none'}`].join(', ');
}

async function openPurchasePage(session: BrowserSession): Promise<Page> {
  const page = session.getPage();
  const readySelector = SELECTORS.PURCHASE_TYPE_RANDOM_BTN;

  console.log('[Purchase] Navigating to lotto game page');
  await session.navigate(URLS.LOTTO_645);

  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await dismissEnvironmentAlert(page);

    const isReady = await waitForVisible(page, readySelector, PURCHASE_PAGE_READY_TIMEOUT);
    if (isReady) {
      return page;
    }

    if (attempt < 2) {
      console.warn('[Purchase] Purchase page not ready for auto mode, retrying once');
      await page.reload({ waitUntil: 'load', timeout: GOTO_TIMEOUT });
    }
  }

  throw new Error(`Failed to load purchase page for auto mode (${await getPurchaseDiagnostics(page)})`);
}

async function waitForPurchaseResults(page: Page): Promise<void> {
  const loaded = await waitForVisible(page, SELECTORS.PURCHASE_NUMBER_LIST, PURCHASE_RESULT_TIMEOUT);
  if (!loaded) {
    throw new Error(`Failed to load purchase results (${await getPurchaseDiagnostics(page)})`);
  }
}

// Auto purchase function
export async function purchaseAuto(session: BrowserSession, amount: number): Promise<number[][]> {
  if (!session.isAuthenticated()) {
    throw new Error('Not authenticated. Login first');
  }

  // Validate amount
  amount = Math.max(1, Math.min(5, amount));

  // Validate purchase time
  validatePurchaseAvailability();

  const page = await openPurchasePage(session);

  // Click auto purchase button
  console.log('[Purchase] Clicking auto purchase button');
  await page.click(SELECTORS.PURCHASE_TYPE_RANDOM_BTN);

  // Select amount
  console.log(`[Purchase] Selecting amount: ${amount}`);
  await page.selectOption(SELECTORS.PURCHASE_AMOUNT_SELECT, String(amount));
  await page.click(SELECTORS.PURCHASE_AMOUNT_CONFIRM_BTN);

  // Purchase
  console.log('[Purchase] Clicking purchase button');
  await page.click(SELECTORS.PURCHASE_BTN);
  await page.click(SELECTORS.PURCHASE_CONFIRM_BTN);

  // Wait for results
  console.log('[Purchase] Waiting for purchase results');
  await waitForPurchaseResults(page);

  // Parse results
  const result = await page.$$eval(SELECTORS.PURCHASE_NUMBER_LIST, elems => {
    return elems.map(it => Array.from(it.children).map(child => Number((child as any).innerHTML)));
  });

  if (result.length === 0 || result.some(nums => nums.length === 0)) {
    throw new Error('Failed to parse purchase results');
  }

  console.log('[Purchase] Auto purchase completed:', result);
  return result;
}
