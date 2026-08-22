// Generate an invoice packet PDF using Playwright + system Chromium.
// Authenticates via the app's login form, then navigates to the invoice packet.

import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4173';

async function main() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  page.setDefaultTimeout(30000);

  // Capture console errors
  page.on('console', msg => console.log('[browser console]', msg.text()));
  page.on('pageerror', err => console.log('[browser error]', err.message));

  // Navigate to login page
  console.log('Loading login page...');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Fill in the login form and submit
  console.log('Filling login form...');
  await page.fill('input[placeholder="admin"]', 'admin');
  await page.fill('input[placeholder="••••••••"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);

  // Check if we're logged in
  const url = page.url();
  console.log('Current URL after login:', url);

  // Navigate to invoice packet
  console.log('Navigating to invoice packet...');
  await page.goto(`${BASE}/invoice-packet?id=9`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // Take a screenshot
  await page.screenshot({ path: './invoice-packet-page.png', fullPage: true });
  console.log('Screenshot saved');

  // Check if the invoice document is rendered
  const invoiceEl = await page.$('[data-source="invoice-print"]');
  if (invoiceEl) {
    console.log('Invoice document found on page');
    await invoiceEl.screenshot({ path: './invoice-document.png' });
    console.log('Invoice document screenshot saved');

    // Check for store headings
    const storeHeadings = await page.$$eval('[data-pdf-store-heading]', els => els.length);
    console.log(`Store headings found: ${storeHeadings}`);

    // Check for logo image
    const logoImg = await page.$('.invoice-document-header img');
    if (logoImg) {
      const logoSrc = await logoImg.getAttribute('src');
      console.log(`Logo src starts with: ${logoSrc?.slice(0, 30)}...`);
    } else {
      console.log('Logo image NOT found');
    }

    // Check for data-pdf-row markers
    const pdfRows = await page.$$eval('[data-pdf-row]', els => els.length);
    console.log(`Data-pdf-row elements: ${pdfRows}`);

    // Check table headers
    const tableHeaders = await page.$$eval('.invoice-table thead td', els => els.map(e => e.textContent));
    console.log('Table headers:', tableHeaders);

    // Check page text for store info
    const pageText = await page.evaluate(() => {
      const el = document.querySelector('[data-source="invoice-print"]');
      return el?.textContent?.slice(0, 500);
    });
    console.log('Invoice text preview:', pageText?.slice(0, 300));
  } else {
    console.log('Invoice document NOT found on page');
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
    console.log('Page content:', bodyText);
  }

  // Generate the actual packet PDF and save it for inspection.
  const generateButton = page.getByText('Generate Invoice Packet', { exact: true });
  if (await generateButton.count()) {
    await generateButton.click();
    await page.waitForTimeout(500);
    const forceButton = page.getByText('Generate Anyway', { exact: true });
    if (await forceButton.count()) await forceButton.click();
    await page.waitForTimeout(12000);
    const pdfHref = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      return links.find(link => link.download?.endsWith('.pdf'))?.href || '';
    });
    console.log('PDF link available:', Boolean(pdfHref));
    if (pdfHref) {
      const pdfResponse = await page.request.get(pdfHref);
      await pdfResponse.body().then(body => require('fs').writeFileSync('./invoice-packet-generated.pdf', body));
      console.log('Generated PDF saved');
    }
  } else {
    console.log('Generate Invoice Packet button not found');
  }

  await browser.close();
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(1); });
