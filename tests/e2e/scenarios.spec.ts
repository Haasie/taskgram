import { expect, test } from '@playwright/test';
import { bump, FIXTURE_IDS, reset, state, waitForSw } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', (err) => console.log('BROWSER ERR:', err));
  await reset();
});

test('E1: Seeded inbox tasks and overdue task @mobile', async ({ page, isMobile }) => {
  if (isMobile) {
    await page.goto('/');
    await page.getByRole('button', { name: /Inbox/ }).click();
    await expect(page.getByText('Inbox taak 1')).toBeVisible();
    await expect(page.getByText('Inbox taak 2')).toBeVisible();
    await expect(page.getByText('Inbox taak 3')).toBeVisible();

    await page.getByRole('button', { name: /Lijsten/ }).click();
    await page.getByRole('button', { name: /Vandaag/ }).click();
    await expect(page.getByText('Achterstallige taak')).toBeVisible();
  } else {
    await page.goto('/#/inbox');
    await expect(page.getByText('Inbox taak 1')).toBeVisible();
    await expect(page.getByText('Inbox taak 2')).toBeVisible();
    await expect(page.getByText('Inbox taak 3')).toBeVisible();

    await page.goto('/#/today');
    await expect(page.getByText('Achterstallige taak')).toBeVisible();
    const taskRows = page.locator('main [data-task-id]');
    await expect(taskRows.first()).toContainText('Achterstallige taak');
  }
});

test('E2: Quick entry creates task @mobile', async ({ page, isMobile }) => {
  await page.goto(isMobile ? '/' : '/#/today');

  await page.getByRole('button', { name: 'Nieuwe taak' }).click();
  await page.getByPlaceholder('Nieuwe taak').fill('Nieuwe vandaag taak');
  await page.getByRole('button', { name: 'Vandaag', exact: true }).click();
  await page.getByRole('button', { name: 'Toevoegen' }).click();

  if (isMobile) {
    await page.getByRole('button', { name: /Vandaag/ }).click();
  }
  await expect(page.getByText('Nieuwe vandaag taak')).toBeVisible();

  await expect.poll(async () => {
    const s = await state();
    return s.entities.find((e) => e.content.includes('Nieuwe vandaag taak'));
  }).toBeDefined();
});

test('E3: Complete and undo task @mobile', async ({ page, isMobile }) => {
  if (isMobile) {
    await page.goto('/');
    await page.getByRole('button', { name: /Vandaag/ }).click();
  } else {
    await page.goto('/#/today');
  }

  const row = page.locator(`[data-task-id="${FIXTURE_IDS.OVERDUE_TASK}"]`);
  await expect(row).toBeVisible();

  // Complete task
  await row.getByRole('checkbox', { name: 'Voltooien' }).click();

  // Toast with undo button appears
  const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
  await expect(undoButton).toBeVisible();
  await expect(row).not.toBeVisible();

  // Undo completion
  await undoButton.click();
  await expect(page.locator(`[data-task-id="${FIXTURE_IDS.OVERDUE_TASK}"]`)).toBeVisible();

  await expect.poll(async () => {
    const s = await state();
    return s.entities.find((e) => e.id === FIXTURE_IDS.OVERDUE_TASK)?.status;
  }).toBe('next');

  // Complete again and let it sync
  await page.locator(`[data-task-id="${FIXTURE_IDS.OVERDUE_TASK}"]`).getByRole('checkbox', { name: 'Voltooien' }).click();
  await expect.poll(async () => {
    const s = await state();
    return s.entities.find((e) => e.id === FIXTURE_IDS.OVERDUE_TASK)?.status;
  }).toBe('done');
});

test('E4: Recurrence creates successor', async ({ page }) => {
  await page.goto('/#/inbox');
  await page.getByText('Inbox taak 2').dblclick();

  await page.getByTitle('Herhalen').click();
  await page.getByRole('dialog').locator('select').first().selectOption('weekly');
  await page.getByRole('button', { name: 'Opslaan' }).click();

  await expect(page.getByText(/Elke week/)).toBeVisible();

  // Complete task
  await page.locator(`[data-task-id="${FIXTURE_IDS.INBOX_TASK_2}"]`).getByRole('checkbox', { name: 'Voltooien' }).click();

  // Wait for parent completion on server
  await expect.poll(async () => {
    const s = await state();
    return s.entities.find((e) => e.id === FIXTURE_IDS.INBOX_TASK_2)?.status;
  }).toBe('done');

  // Verify successor in server state
  const sAfter = await state();
  const successors = sAfter.entities.filter((e) => e.metadata?.recurrence_parent_id === FIXTURE_IDS.INBOX_TASK_2);
  expect(successors.length).toBe(1);
  expect(successors[0]?.status).toBe('scheduled');

  // Successor visible in Gepland
  await page.goto('/#/upcoming');
  await expect(page.getByText('Inbox taak 2')).toBeVisible();

  // Reload page and verify still exactly one successor
  await page.reload();
  const sReload = await state();
  expect(sReload.entities.filter((e) => e.metadata?.recurrence_parent_id === FIXTURE_IDS.INBOX_TASK_2).length).toBe(1);
});

test('E5: Offline outbox and sync', async ({ page, context }) => {
  await page.goto('/#/inbox');
  await waitForSw(page);
  await expect(page.getByText('Inbox taak 1')).toBeVisible();
  await page.reload();
  await waitForSw(page);
  await expect(page.getByText('Inbox taak 1')).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  await page.goto('/#/inbox');
  await expect(page.getByText('Inbox taak 1')).toBeVisible();
  await expect(page.getByText('Inbox taak 2')).toBeVisible();

  // Complete one task offline
  await page.locator(`[data-task-id="${FIXTURE_IDS.INBOX_TASK_1}"]`).getByRole('checkbox', { name: 'Voltooien' }).click();

  // Rename another task offline
  await page.getByText('Inbox taak 2').dblclick();
  const titleTextarea = page.locator(`[data-task-id="${FIXTURE_IDS.INBOX_TASK_2}"] textarea`).first();
  await titleTextarea.fill('Inbox taak 2 hernoemd');
  await titleTextarea.blur();

  // Indicator shows pending changes
  await expect(page.getByText('2 wijzigingen wachten')).toBeVisible();

  // Reload while offline to ensure persistence in IndexedDB outbox
  await page.reload();
  await expect(page.getByText('2 wijzigingen wachten')).toBeVisible();

  // Return online
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Indicator clears
  await expect(page.getByText('2 wijzigingen wachten')).not.toBeVisible();

  // __state reflects both changes
  await expect.poll(async () => {
    const s = await state();
    const t1 = s.entities.find((e) => e.id === FIXTURE_IDS.INBOX_TASK_1);
    const t2 = s.entities.find((e) => e.id === FIXTURE_IDS.INBOX_TASK_2);
    return t1?.status === 'done' && t2?.content?.includes('Inbox taak 2 hernoemd');
  }).toBe(true);
});

test('E6: Conflict resolution', async ({ page, context }) => {
  await page.goto('/#/inbox');
  await waitForSw(page);
  await expect(page.getByText('Inbox taak 3')).toBeVisible();
  await page.reload();
  await waitForSw(page);
  await expect(page.getByText('Inbox taak 3')).toBeVisible();

  await context.setOffline(true);
  await page.goto('/#/inbox');
  await expect(page.getByText('Inbox taak 3')).toBeVisible();

  // Rename task offline
  await page.getByText('Inbox taak 3').dblclick();
  const titleTextarea = page.locator(`[data-task-id="${FIXTURE_IDS.INBOX_TASK_3}"] textarea`).first();
  await titleTextarea.fill('Inbox taak 3 lokaal gewijzigd');
  await titleTextarea.blur();

  await expect(page.getByText('1 wijziging wacht')).toBeVisible();

  // Simulate external change on server
  await bump(FIXTURE_IDS.INBOX_TASK_3);

  // Return online
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Conflict indicator appears
  await expect(page.getByText('1 conflict')).toBeVisible();
  // Server title shown in UI
  await expect(page.getByText('Inbox taak 3 (extern gewijzigd)')).toBeVisible();

  // Open conflict dialog
  await page.getByText('1 conflict').click();

  // Click "Mijn wijziging toepassen"
  const applyBtn = page.getByRole('button', { name: 'Mijn wijziging toepassen' });
  await expect(applyBtn).toBeVisible();
  await applyBtn.click();

  // Conflict indicator clears
  await expect(page.getByText('1 conflict')).not.toBeVisible();

  // __state has local title
  await expect.poll(async () => {
    const s = await state();
    const t3 = s.entities.find((e) => e.id === FIXTURE_IDS.INBOX_TASK_3);
    return t3?.content;
  }).toBe('Inbox taak 3 lokaal gewijzigd');
});

test('E7: Settings persistence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Instellingen' }).click();
  await expect(page.getByText('Dagelijks overzicht')).toBeVisible();

  const timeInput = page.locator('input[type="time"]');
  await expect(timeInput).toHaveValue('07:30');

  await timeInput.fill('08:45');
  await page.getByRole('button', { name: 'Sluiten' }).click();

  // Re-open settings to verify persistence
  await page.getByRole('button', { name: 'Instellingen' }).click();
  await expect(page.locator('input[type="time"]')).toHaveValue('08:45');
});

test('E8: Mobile navigation @mobile', async ({ page, isMobile }) => {
  if (isMobile) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Taskgram' })).toBeVisible();

    await page.getByRole('button', { name: /Inbox/ }).click();
    await expect(page.getByText('Inbox taak 1')).toBeVisible();

    await page.getByRole('button', { name: /Lijsten/ }).click();
    await expect(page.getByRole('heading', { name: 'Taskgram' })).toBeVisible();
  } else {
    await page.goto('/');
    await expect(page).toHaveURL(/.*#\/today/);
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible();
  }
});

test('E9: Checklist items Enter key', async ({ page }) => {
  await page.goto('/#/inbox');
  await page.getByText('Inbox taak 1').dblclick();

  await page.getByTitle('Checklist').click();
  const firstInput = page.getByPlaceholder('Item').first();
  await firstInput.fill('Eerste checklist item');
  await firstInput.press('Enter');

  const secondInput = page.getByPlaceholder('Item').nth(1);
  await secondInput.fill('Tweede checklist item');
  await secondInput.press('Enter');

  // Trigger blur on task editor to save
  await page.locator(`[data-task-id="${FIXTURE_IDS.INBOX_TASK_1}"] textarea`).first().focus();
  await page.locator(`[data-task-id="${FIXTURE_IDS.INBOX_TASK_1}"] textarea`).first().blur();

  // Verify server state received checklist items
  await expect.poll(async () => {
    const s = await state();
    const t = s.entities.find((e) => e.id === FIXTURE_IDS.INBOX_TASK_1);
    const cl = t?.metadata?.checklist as Array<{ text: string }> | undefined;
    return (
      cl?.some((item) => item.text === 'Eerste checklist item') &&
      cl?.some((item) => item.text === 'Tweede checklist item')
    );
  }).toBe(true);

  // Reload page and re-open to verify UI persistence
  await page.reload();
  await page.getByText('Inbox taak 1').dblclick();
  await expect(page.locator('input[placeholder="Item"]').first()).toHaveValue('Eerste checklist item');
  await expect(page.locator('input[placeholder="Item"]').nth(1)).toHaveValue('Tweede checklist item');
});

test('E10: Language switching and password login UI', async ({ page }) => {
  await page.goto('/');

  // 1. Open settings dialog
  await page.getByRole('button', { name: 'Instellingen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // 2. Switch language from Nederlands to English
  const langSelect = page.getByRole('combobox', { name: /Taal|Language/ });
  await langSelect.selectOption('en');

  // Close Settings dialog (in English, 'Sluiten' -> 'Close')
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // 3. Verify list names change to English
  await expect(page.getByRole('button', { name: /Inbox/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Today/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Upcoming/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Anytime/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Someday/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Waiting/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Logbook/ })).toBeVisible();

  // 4. Verify reload preserves the English setting
  await page.reload();
  await expect(page.getByRole('button', { name: /Today/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Upcoming/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Anytime/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Someday/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Waiting/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Logbook/ })).toBeVisible();

  // 5. Test password mode and login UI
  let loggedInUser: string | null = null;

  await page.route('**/auth/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'password', user: loggedInUser })
    });
  });

  await page.route('**/auth/login', async (route) => {
    const postData = route.request().postDataJSON();
    const user = postData?.username ?? postData?.user;
    const pass = postData?.password ?? postData?.pass;
    if (user === 'alice' && pass === 'secret123') {
      loggedInUser = 'alice';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, user: 'alice' })
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Invalid credentials' } })
      });
    }
  });

  // Reload with logged out password mode
  await page.reload();

  // Verify LoginScreen appears
  await expect(page.locator('form input[type="text"]')).toBeVisible();
  await expect(page.locator('form input[type="password"]')).toBeVisible();

  // Attempt login with wrong password
  await page.locator('form input[type="text"]').fill('alice');
  await page.locator('form input[type="password"]').fill('wrong');
  await page.locator('form button[type="submit"]').click();

  // Error is shown
  await expect(page.getByRole('alert')).toBeVisible();

  // Enter correct credentials
  await page.locator('form input[type="password"]').fill('secret123');
  await page.locator('form button[type="submit"]').click();

  // Main app restored
  await expect(page.getByRole('button', { name: /Today/ })).toBeVisible();
});
