const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
    
    const diagrams = [
        ['01-happy-path', '01-happy-path.png'],
        ['02-attack1', '02-attack1.png'],
        ['03-attack2', '03-attack2.png'],
        ['04-attacks3-4b', '04-attacks3-4b.png'],
        ['05-decision-tree', '05-decision-tree.png'],
        ['06-summary', '06-summary.png'],
    ];
    
    for (const [name, out] of diagrams) {
        const page = await browser.newPage({ viewport: { width: 860, height: 1200 }, deviceScaleFactor: 2 });
        await page.goto(`file:///tmp/diagrams/${name}.html`);
        await page.waitForTimeout(300);
        const height = await page.evaluate(() => document.body.scrollHeight);
        await page.setViewportSize({ width: 860, height: height + 60 });
        await page.screenshot({ path: `/tmp/diagrams/${out}`, fullPage: true });
        console.log(`Rendered ${out}`);
        await page.close();
    }
    
    await browser.close();
})();
