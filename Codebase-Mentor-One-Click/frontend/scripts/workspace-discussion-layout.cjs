// Run with playwright-cli run-code --filename scripts/workspace-discussion-layout.cjs
// Requires an existing local analysis selected in this browser session.
async (page) => {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const bounds = (selector) => page.locator(selector).boundingBox();
  const verifyDocked = async (width, files) => {
    const editor = await bounds('.mentor-editor');
    const mentor = await bounds('#workspace-mentor');
    check(editor && mentor, 'Editor and discussion must remain visible');
    check(Math.abs(editor.y - mentor.y) < 10, `Discussion wrapped below editor at ${width}px`);
    check(mentor.x >= editor.x + editor.width, `Discussion overlaps editor at ${width}px`);
    check(editor.width > 300, `Editor collapsed at ${width}px`);
    if (files) {
      const explorer = await bounds('#workspace-files');
      check(Math.abs(explorer.y - editor.y) < 10, 'Explorer wrapped onto another row');
      check(editor.x >= explorer.x + explorer.width, 'Explorer overlaps editor');
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
    results.push({ width, files, editor, mentor });
  };

  await page.goto('http://127.0.0.1:5173/#/workspace');
  await page.reload();
  await page.locator('.mentor-editor').waitFor();
  for (const width of [2048, 1440, 1120]) {
    await page.setViewportSize({ width, height: 1043 });
    const files = page.getByRole('button', { name: 'Files', exact: true });
    if (await files.getAttribute('aria-pressed') !== 'true') await files.click();
    await page.getByRole('button', { name: 'Discuss this component', exact: true }).click();
    check(await page.getByRole('dialog').count() === 0, 'Voice & text must open in the side panel by default');
    await verifyDocked(width, true);
    await page.getByRole('button', { name: 'Open centered conversation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Talk with your mentor' });
    await dialog.waitFor();
    const modal = await dialog.boundingBox();
    check(modal.x >= 0 && modal.x + modal.width <= width, 'Voice dialog exceeds viewport');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await verifyDocked(width, true);
    await files.click();
    await verifyDocked(width, false);
    for (const mode of ['Split Focus', 'Architecture Focus', 'Code Focus']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await verifyDocked(width, false);
    }
    const resize = page.getByRole('separator', { name: 'Mentor width', exact: true });
    await resize.focus();
    await page.keyboard.press('ArrowLeft');
    await verifyDocked(width, false);
    await page.getByRole('button', { name: 'Mentor', exact: true }).click();
    check(await page.locator('.workspace-mentor-content').isVisible(), 'Mentor toggle must restore the original text mentor');
    check(await page.locator('.component-discussion').count() === 0, 'Discussion mode must close when returning to text mentor');
    check(await page.getByRole('button', { name: 'Discuss this component', exact: true }).getAttribute('aria-pressed') === 'false', 'Voice toggle must reset when returning to text mentor');
    await page.getByRole('button', { name: 'Mentor', exact: true }).click();
    check(await page.locator('#workspace-mentor').count() === 0, 'Mentor toggle did not hide discussion');
    await page.getByRole('button', { name: 'Mentor', exact: true }).click();
    await verifyDocked(width, false);
  }
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Discuss this component', exact: true }).click();
    check(await page.getByRole('dialog').count() === 0, 'Voice & text must open in the side panel on narrow screens');
    check(await page.locator('#workspace-mentor .component-discussion').isVisible(), 'Side panel discussion must be visible');
    await page.getByRole('button', { name: 'Open centered conversation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Talk with your mentor' });
    await dialog.waitFor();
    const modal = await dialog.boundingBox();
    check(modal.x >= 0 && modal.x + modal.width <= width, 'Voice dialog exceeds narrow viewport');
    await page.keyboard.press('Escape');
    const mentor = await bounds('#workspace-mentor');
    check(mentor && mentor.x >= 0 && mentor.x + mentor.width <= width, 'Docked discussion exceeds narrow viewport');
  }
  await page.setViewportSize({ width: 2048, height: 1043 });
  await page.screenshot({ path: 'output/playwright/voice-docked-after.png' });
  return results;
}
