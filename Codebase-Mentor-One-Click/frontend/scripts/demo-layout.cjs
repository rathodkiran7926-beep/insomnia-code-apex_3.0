async (page) => {
  const errors = [];
  const warnings = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()); });
  const result = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    for (const route of ['demo-workspace', 'journeys', 'practice', 'changes', 'agent-context', 'progress']) {
      await page.goto(`http://127.0.0.1:4173/#/${route}`);
      await page.locator('main').waitFor();
      await page.getByRole('heading').first().waitFor();
      await page.screenshot({ path: `output/playwright/demo-layout-${route}-${width}.png` });
      const metrics = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll('main *')].filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.right > innerWidth + 2 && getComputedStyle(node).position !== 'absolute';
        }).slice(0, 8).map((node) => `${node.tagName}.${node.className}`),
      }));
      result.push({ route, width, ...metrics });
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const route of ['changes', 'progress', 'journeys', 'practice', 'progress', 'agent-context']) {
    await page.goto(`http://127.0.0.1:4173/#/${route}`);
    await page.getByRole('heading').first().waitFor();
  }
  await page.waitForFunction(() => {
    const heading = document.querySelector('h1');
    return heading && getComputedStyle(heading).opacity === '1';
  });
  if (result.some((item) => item.document > item.viewport)) throw new Error(`Horizontal overflow: ${JSON.stringify(result)}`);
  if (errors.length || warnings.length) throw new Error(JSON.stringify({ errors, warnings }));
  return { result, errors, warnings };
}
