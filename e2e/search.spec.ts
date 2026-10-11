import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('search, watch events, open a contact with evidence, deep search, export', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('City').fill('Charleroi');
  await page.getByLabel('Position').fill('Développeur .NET');
  await page.getByRole('button', { name: 'Start search' }).click();

  // Events stream into the log while rows appear.
  const log = page.getByRole('log');
  await expect(log).toContainText('COMPANY_DISCOVERED');
  await expect(page.locator('main').getByText(/stopped: sources exhausted/)).toBeVisible({ timeout: 90_000 });
  await expect(log).toContainText('CONTACT_VALIDATED');

  const rows = page.getByRole('region', { name: 'Contacts' }).locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('Marie Dupont');

  // Every field on the detail page links to its evidence.
  await page.getByRole('link', { name: 'Paul Martin' }).click();
  await expect(page.getByRole('heading', { name: /Paul Martin/ })).toBeVisible();
  const evidence = page.getByRole('region', { name: /Evidence for/ });
  await expect(evidence.first()).toBeVisible();
  await expect(evidence.first().getByRole('link').first()).toHaveAttribute('href', /^https?:\/\//);

  // Deep search renders its before/after diff.
  await page.getByRole('button', { name: 'Run deep search' }).click();
  await expect(page.getByText(/Deep search: Paul Martin: .*corroborated/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('table', { name: 'Before and after this deep search' }).first()).toBeVisible();

  // Back to the results and download the spreadsheet.
  await page.goBack();
  await expect(rows).toHaveCount(5);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export all (.xlsx)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^contacts_charleroi_developpeur-net_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const file = readFileSync((await download.path())!);
  expect(file.subarray(0, 2).toString()).toBe('PK');
});

test('the privacy page states the retention period', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByText(/deleted automatically 180 days after/)).toBeVisible();
});

test('erasing a contact removes it everywhere, Back included', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('City').fill('Charleroi');
  await page.getByLabel('Position').fill('Développeur .NET');
  await page.getByRole('button', { name: 'Start search' }).click();
  await expect(page.locator('main').getByText(/stopped:/)).toBeVisible({ timeout: 90_000 });

  await page.getByRole('link', { name: 'Hugo Lambert' }).click();
  await page.getByRole('button', { name: 'Erase this contact…' }).click();
  await page.getByRole('button', { name: 'Erase and blocklist' }).click();
  const rows = page.getByRole('region', { name: 'Contacts' }).locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Hugo Lambert' })).toHaveCount(0);

  await page.goBack();
  await expect(page.getByRole('alert')).toHaveText('This contact does not exist or was erased.');
  await expect(page.getByRole('region', { name: 'Engine log' })).not.toContainText('Hugo Lambert');
});
