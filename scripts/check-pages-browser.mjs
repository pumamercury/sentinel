const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const folder = resolve(process.argv[2]);
const origin = process.argv[3] || 'http://127.0.0.1:5174';
const owner = JSON.parse(
  readFileSync(join(folder, 'test-accounts.json'), 'utf8'),
).accounts.find((a) => a.role === 'owner');
const claims = JSON.parse(
  Buffer.from(owner.token.split('.')[1], 'base64url').toString(),
);
const browser = await chromium.launch({ headless: true });
try {
  const anonymous = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await anonymous.goto(origin + '/sentinel/');
  await anonymous
    .getByRole('heading', { name: 'Sign in to Sentinel' })
    .waitFor();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [
            {
              name: 'sentinel-cloud-session',
              value: JSON.stringify({
                access_token: owner.token,
                refresh_token: 'test-only-not-used',
                token_type: 'bearer',
                expires_in: 3600,
                expires_at: claims.exp,
                user: {
                  id: owner.id,
                  email: owner.email,
                  aud: 'authenticated',
                  role: 'authenticated',
                  app_metadata: { provider: 'email' },
                  user_metadata: {},
                  created_at: new Date().toISOString(),
                },
              }),
            },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/sentinel/');
  await page.getByRole('button', { name: 'Account', exact: true }).waitFor();
  await page.getByText('FT-BUG-1', { exact: true }).first().waitFor();
  await page.goto(origin + '/sentinel/?view=inbox');
  await page.getByRole('heading', { name: /^Attachment Inbox/ }).waitFor();
  await page
    .getByRole('heading', { name: 'Apple Photos on your Mac' })
    .waitFor();
  await page.locator('.attachment-thumbnail').first().waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Folder settings', exact: true })
      .count(),
    0,
  );
  await page
    .locator('button.attachment-thumbnail:not([disabled])')
    .first()
    .click();
  await page.locator('dialog[open]').waitFor();
  await page
    .getByRole('button', { name: 'Close preview', exact: true })
    .click();
  await page.goto(origin + '/sentinel/?issue=12');
  await page.getByRole('button', { name: 'Edit issue', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Edit issue', exact: true }).waitFor();
  mkdirSync('test-output', { recursive: true });
  await page.screenshot({
    path: 'test-output/hosted-issue.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Verified production-build sign-in screen, authenticated issue list, inbox/Photos status, private media preview and issue deep-link refresh in Chrome.',
  );
} finally {
  await browser.close();
}
