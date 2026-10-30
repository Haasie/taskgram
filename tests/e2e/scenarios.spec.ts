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

test('E11: Update notice when a new service worker takes over', async ({ page }) => {
  await page.goto('/#/inbox');
  await waitForSw(page);
  // Herladen zodat de service worker deze pagina beheert (zoals bij een terugkerende gebruiker).
  await page.reload();
  await waitForSw(page);
  await expect(page.getByText('Inbox taak 1')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await expect(page.getByText('Er is een nieuwe versie van de app.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vernieuwen' })).toBeVisible();
});

test('E12: Quick Add Magic, favorites and saved filters', async ({ page }) => {
  await page.goto('/#/inbox');
  await expect(page.getByText('Inbox taak 1')).toBeVisible();

  // Quick Add Magic: label, project, prioriteit en datum uit de titel.
  await page.getByRole('button', { name: 'Nieuwe taak' }).click();
  await page.getByPlaceholder('Nieuwe taak').fill('Offerte sturen +alfa *mail !4 morgen');
  await expect(page.getByTestId('quick-add-magic')).toContainText('Project Alfa');
  await page.getByRole('button', { name: 'Toevoegen' }).click();

  await expect
    .poll(async () => (await state()).entities.find((e) => e.content === 'Offerte sturen'))
    .toMatchObject({
      status: 'scheduled',
      tags: ['mail'],
      metadata: expect.objectContaining({ priority: 4, project_id: FIXTURE_IDS.PROJECT_1 })
    });

  // Favoriet via sneltoets f.
  const row = page.locator(`[data-task-id="${FIXTURE_IDS.INBOX_TASK_2}"]`);
  await row.click();
  await page.keyboard.press('f');
  await page.goto('/#/favorites');
  await expect(page.locator('main').getByText('Inbox taak 2')).toBeVisible();
  await expect(page.locator('main').getByText('Inbox taak 1')).not.toBeVisible();
  await expect
    .poll(async () => (await state()).entities.find((e) => e.id === FIXTURE_IDS.INBOX_TASK_2)?.metadata?.favorite)
    .toBe(true);

  // Filter op prioriteit en opslaan.
  await page.goto('/#/filter?prio=4');
  await expect(page.locator('main').getByText('Offerte sturen')).toBeVisible();
  await expect(page.locator('main').getByText('Inbox taak 1')).not.toBeVisible();
  page.once('dialog', (d) => void d.accept('Belangrijk'));
  await page.getByRole('button', { name: 'Opslaan als filter' }).click();
  await expect(page.locator('nav').getByRole('button', { name: 'Belangrijk' })).toBeVisible();
  await page.goto('/#/today');
  await page.locator('nav').getByRole('button', { name: 'Belangrijk' }).click();
  await expect(page.locator('main').getByText('Offerte sturen')).toBeVisible();
});

test('E13: Project board moves tasks between columns', async ({ page }) => {
  await page.goto(`/#/project/${FIXTURE_IDS.PROJECT_1}`);
  await page.getByRole('button', { name: 'Bord' }).click();

  const card = page.locator(`[data-task-id="${FIXTURE_IDS.PROJECT_TASK_1}"]`);
  await expect(page.getByTestId('board-column-todo').locator(`[data-task-id="${FIXTURE_IDS.PROJECT_TASK_1}"]`)).toBeVisible();

  const from = await card.boundingBox();
  const to = await page.getByTestId('board-column-waiting').boundingBox();
  await page.mouse.move(from!.x + 40, from!.y + 12);
  await page.mouse.down();
  await page.mouse.move(from!.x + 60, from!.y + 20, { steps: 5 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 40, { steps: 15 });
  await page.mouse.up();

  await expect(page.getByTestId('board-column-waiting').locator(`[data-task-id="${FIXTURE_IDS.PROJECT_TASK_1}"]`)).toBeVisible();
  await expect
    .poll(async () => (await state()).entities.find((e) => e.id === FIXTURE_IDS.PROJECT_TASK_1)?.status)
    .toBe('waiting');

  // Layout blijft per project bewaard.
  await page.reload();
  await expect(page.getByTestId('board-column-waiting')).toBeVisible();
});

test('E20: Werkradar toont projectkaarten en bewaart radarvelden', async ({ page }) => {
  await page.goto('/#/today');
  await page.locator('nav').getByRole('button', { name: 'Radar', exact: true }).click();
  await expect(page.getByTestId('radar-view')).toBeVisible();
  const card = page.getByTestId('radar-card').filter({ hasText: 'Radarproject' });
  await expect(card).toContainText('Oranje');
  await expect(card).toContainText('Opleveren');
  await expect(card).toContainText('nog 3 dagen');
  await expect(card).toContainText('1 volgende');

  await card.getByRole('button', { name: 'Bewerken' }).click();
  await card.getByRole('combobox').selectOption('rood');
  await card.getByRole('textbox').nth(1).fill('Requirements opleveren');
  await card.getByRole('button', { name: 'Opslaan' }).click();
  await expect(card).toContainText('Rood');
  await expect(card).toContainText('Requirements opleveren');
  await expect
    .poll(async () => (await state()).entities.find((e) => e.id === FIXTURE_IDS.RADAR_PROJECT)?.metadata)
    .toMatchObject({ rag: 'rood', volgende_stap: 'Requirements opleveren', code: 'P01' });

  await card.getByRole('button', { name: 'Radarproject', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/project/${FIXTURE_IDS.RADAR_PROJECT}`));
  await expect(page.locator('main').getByText('Radartaak')).toBeVisible();
});

async function setModule(page: import('@playwright/test').Page, enabled: boolean) {
  const res = await page.request.put('/api/modules/leesdossier', { data: { enabled }, headers: { 'x-requested-with': 'taskgram' } });
  expect(res.ok()).toBe(true);
}

async function seedBook(metadata: Record<string, unknown>) {
  const res = await fetch('http://localhost:4010/api/entities', {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'document', content: String(metadata.title), status: null, tags: ['book'], metadata })
  });
  if (!res.ok) throw new Error(`seed book failed: ${res.status}`);
}

test('E21: Leesdossier-module aan/uit, lege staat, bewerken en herladen @mobile', async ({ page, isMobile }) => {
  await setModule(page, false);
  const bookCalls: string[] = [];
  page.on('request', (r) => r.url().includes('/api/modules/leesdossier/') && bookCalls.push(r.url()));

  // Uit: geen menu-item, route bestaat niet, geen data-calls.
  await page.goto('/#/lezen');
  await expect(page).not.toHaveURL(/#\/lezen/);
  await expect(page.getByRole('button', { name: 'Leesdossier' })).toHaveCount(0);
  expect(bookCalls).toEqual([]);

  // Aanzetten via instellingen.
  await page.goto(isMobile ? '/' : '/#/today');
  await page.getByRole('button', { name: 'Instellingen' }).first().click();
  const toggle = page.getByRole('switch', { name: 'Leesdossier' });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: 'Sluiten' }).click();
  await page.locator('nav').getByRole('button', { name: 'Leesdossier' }).click();
  await expect(page).toHaveURL(/#\/lezen/);

  // Lege staat.
  await expect(page.getByText('Nog geen boeken.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Lezend' })).toContainText('0');

  // Toevoegen.
  await page.getByRole('button', { name: '+ Boek' }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Zuid');
  await page.getByLabel('Auteur', { exact: true }).fill('Ernest Shackleton');
  await page.getByLabel('Categorie', { exact: true }).selectOption('reis');
  await page.getByRole('button', { name: 'Opslaan' }).click();
  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog).toContainText('Zuid');
  await expect(backlog).toContainText('Ernest Shackleton · Reizen & Cultuur');

  // → Wachtrij, ▶ Start, voortgang, uit + sterren; overleeft herladen.
  await backlog.getByRole('button', { name: '→ Wachtrij' }).click();
  const queue = page.getByRole('region', { name: 'Wachtrij' });
  await expect(queue).toContainText('Zuid');
  await queue.getByRole('button', { name: '▶ Start' }).click();
  const reading = page.getByRole('region', { name: 'Nu lezend' });
  await expect(reading).toContainText('Zuid');
  const slider = reading.getByRole('slider', { name: 'Voortgang Zuid' });
  await slider.focus();
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await expect(reading).toContainText('10%');
  await expect.poll(async () => (await state()).entities.find((e) => e.metadata?.title === 'Zuid')?.metadata).toMatchObject({ status: 'lezend', progress: 10 });

  await page.reload();
  await expect(page.getByRole('region', { name: 'Nu lezend' })).toContainText('10%');

  // Bewerken via het paneel.
  await page.getByRole('region', { name: 'Nu lezend' }).getByRole('button', { name: 'Bewerk' }).click();
  await page.getByLabel('Notitie', { exact: true }).fill('Endurance-expeditie, leiderschap');
  await page.getByLabel('Aanbevolen door', { exact: true }).fill('@ijsbeer');
  await page.getByRole('button', { name: 'Opslaan' }).click();
  await expect(page.getByRole('region', { name: 'Nu lezend' })).toContainText('Endurance-expeditie');

  await page.getByRole('region', { name: 'Nu lezend' }).getByRole('button', { name: '✓ Uit' }).click();
  const done = page.getByRole('region', { name: 'Uitgelezen' });
  await done.getByRole('button', { name: '4 sterren' }).click();
  await expect(done.getByRole('group', { name: 'Beoordeling: 4 van 5' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Uitgelezen' }).getByRole('group', { name: 'Beoordeling: 4 van 5' })).toBeVisible();
  await expect.poll(async () => (await state()).entities.find((e) => e.metadata?.title === 'Zuid')?.content).toBe('Zuid — Ernest Shackleton\n\nEndurance-expeditie, leiderschap');

  // Export.
  await page.getByRole('button', { name: 'Export MD' }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown' })).toHaveValue(/## Uitgelezen\n- \[\[Zuid\]\] — Ernest Shackleton — ★★★★☆/);
  await page.keyboard.press('Escape');

  // Verwijderen met bevestiging in de pagina.
  await page.getByRole('region', { name: 'Uitgelezen' }).getByRole('button', { name: 'Zuid' }).click();
  await page.getByRole('button', { name: 'Verwijder' }).click();
  await page.getByRole('button', { name: 'Ja, verwijder' }).click();
  await expect(page.getByText('Nog geen boeken.')).toBeVisible();

  // Weer uit: menu-item weg, route weg.
  // Elders uitgezet (bijv. ander apparaat): na herladen verdwijnen route en menu-item.
  await setModule(page, false);
  await page.reload();
  await expect(page).not.toHaveURL(/#\/lezen/);
  await expect(page.locator('nav').getByRole('button', { name: 'Leesdossier' })).toHaveCount(0);
});

test('E22: Leesdossier in licht en donker, ook op telefoonbreedte @mobile', async ({ page }, info) => {
  await setModule(page, true);
  await seedBook({ title: 'Ghost in the Wires', author: 'Kevin Mitnick', status: 'lezend', cat: 'sec', progress: 35, started: '2026-10-01' });
  await seedBook({ title: 'The Nord Stream Conspiracy', author: 'Pancevski', status: 'te-lezen', cat: 'pol', order: 1, note: 'verschenen juni 2026' });
  await seedBook({ title: 'Driehoek van macht', author: 'Alexander Stubb', status: 'te-lezen', cat: 'pol', order: 2, verify: true });
  await seedBook({ title: 'How to Hack Like a Legend: Breaking Windows', status: 'te-lezen', cat: 'sec', verify: true });
  await seedBook({ title: 'The Kite Runner', author: 'Khaled Hosseini', status: 'uit', cat: 'fic' });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/#/lezen');
    await expect(page.getByRole('region', { name: 'Nu lezend' })).toContainText('Ghost in the Wires');
    await expect(page.getByText('te checken')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Gestaakt' })).toHaveCount(0);
    const bg = await page.locator('.ld').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(scheme === 'light' ? 'rgb(235, 231, 216)' : 'rgb(10, 15, 21)');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/leesdossier-${info.project.name}-${scheme}.png`, fullPage: true });
  }
  await setModule(page, false);
});
