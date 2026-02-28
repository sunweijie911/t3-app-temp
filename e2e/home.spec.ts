import { expect, test } from '@playwright/test';

test.describe('Home page', () => {
  test('should render the homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Create T3 App');
  });

  test('should display tRPC hello query result', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hello from tRPC')).toBeVisible();
  });
});
