const { test, expect } = require('@playwright/test');

const PROJECT_IDENTIFIER = 'e2e-dashboard';
const DASHBOARD_PATH = `/projects/${PROJECT_IDENTIFIER}/dashboard`;

function isDashboardRelatedRequest(url) {
  return [
    `/projects/${PROJECT_IDENTIFIER}/dashboard`,
    `/projects/${PROJECT_IDENTIFIER}/dashboard/data`,
    '/plugin_assets/redmine_progress_dashboard/',
  ].some((pattern) => url.includes(pattern));
}

test('ダッシュボードの必須リクエストがエラーなく、主要パネルが表示される', async ({ page }) => {
  const requestErrors = [];

  page.on('requestfailed', (request) => {
    if (!isDashboardRelatedRequest(request.url())) return;
    const failure = request.failure();
    requestErrors.push(
      `REQUEST_FAILED ${request.method()} ${request.url()} (${failure ? failure.errorText : 'unknown'})`
    );
  });

  page.on('response', (response) => {
    if (!isDashboardRelatedRequest(response.url())) return;
    if (response.status() < 400) return;
    requestErrors.push(`HTTP_${response.status()} ${response.request().method()} ${response.url()}`);
  });

  await page.goto('/login');
  await page.fill('#username', 'admin');
  await page.fill('#password', 'Admin!23456');
  await page.click('input[name="login"]');

  await page.goto(DASHBOARD_PATH);

  const dataResponse = await page.waitForResponse(
    (response) =>
      response.url().includes(`/projects/${PROJECT_IDENTIFIER}/dashboard/data`) &&
      response.request().method() === 'GET',
  );

  expect(dataResponse.status()).toBe(200);

  await page.waitForLoadState('networkidle');

  await expect(page.getByText(/Completion Rate|完了率/)).toBeVisible();
  await expect(page.getByText(/Burndown Chart|バーンダウンチャート/)).toBeVisible();
  await expect(page.getByText(/Status Distribution|ステータス分布/)).toBeVisible();

  expect(requestErrors, requestErrors.join('\n')).toEqual([]);
});
