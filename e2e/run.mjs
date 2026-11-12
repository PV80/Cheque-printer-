// End-to-end test: drives the real desktop app the way the office will use it.
//
//   npm run build && npm run e2e
//
// Nothing here touches real data: the app is pointed at a throwaway folder
// and "printing" is captured as a PDF so the positions can be measured.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { makeImageOnlyPdf, makeReceiptPdf, makeRequisitionPdf, NOTE_SIGNATURE_BOX, RECEIPT_SIGNATURE_BOX, SIGNATURE_BOX } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);

// Linux with no screen attached: run again inside a virtual one.
if (process.platform === 'linux' && !process.env.DISPLAY) {
  const again = spawnSync('xvfb-run', ['-a', process.execPath, fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(again.status ?? 1);
}

const tmp = join(here, '.tmp');
const dirs = { data: join(tmp, 'data'), pdfs: join(tmp, 'pdfs'), prints: join(tmp, 'prints'), saves: join(tmp, 'saves'), shots: join(tmp, 'shots') };
rmSync(tmp, { recursive: true, force: true });
Object.values(dirs).forEach((d) => mkdirSync(d, { recursive: true }));

// ---- Small test helpers --------------------------------------------------------------

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  passed++;
  console.log(`  ok  ${message}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function checkEqual(actual, expected, message) {
  check(same(actual, expected), `${message}${same(actual, expected) ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}
const step = (title) => console.log(`\n${title}`);

const GI = 'Golden Ivy Investments Ltd';
const SH = 'Savannah Holdings Ltd';
const PASSWORD = 'correct-horse-9';

async function fixture(name, options) {
  const file = join(dirs.pdfs, name);
  writeFileSync(file, await makeRequisitionPdf(options));
  return file;
}

let lastPage = null; // for a screenshot if a step fails

async function launch(dataDir = dirs.data, extraEnv = {}) {
  const app = await electron.launch({
    executablePath: require('electron'),
    // Containers and CI runners cannot start Chromium's sandbox.
    args: [root, ...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      CHEQUE_PRINTER_DATA_DIR: dataDir,
      CHEQUE_PRINTER_E2E_PRINT_DIR: dirs.prints,
      CHEQUE_PRINTER_E2E_SAVE_DIR: dirs.saves,
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  lastPage = page;
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

const tab = (page, id) => page.click(`[data-tab="${id}"]`);
const shot = (page, name) => page.screenshot({ path: join(dirs.shots, `${name}.png`) });

async function signIn(page, username) {
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('[data-tab="import"]').waitFor();
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
}

/** Loads files through the file picker and returns each one's result. */
async function load(page, files) {
  await tab(page, 'import');
  const clear = page.getByRole('button', { name: 'Clear list' });
  if (await clear.isVisible()) await clear.click();
  await page.setInputFiles('[data-testid=file-input]', files);
  const rows = page.locator('[data-testid=import-results] li');
  await page.waitForFunction(
    (n) => {
      const items = [...document.querySelectorAll('[data-testid=import-results] li')];
      return items.length === n && items.every((li) => li.dataset.state !== 'working');
    },
    files.length
  );
  const results = await rows.evaluateAll((items) => items.map((li) => ({ state: li.dataset.state, text: li.innerText.replace(/\s+/g, ' ') })));
  return results.reverse(); // newest is shown first; return in load order
}

const queueNumbers = (page, company) =>
  page.locator(`section[data-company="${company}"] tbody tr`).evaluateAll((rows) => rows.map((r) => r.dataset.cheque));

const heldIssues = (page, chq) =>
  page.locator(`[data-testid=held-list] > li[data-cheque="${chq}"] [data-issue]`).evaluateAll((els) => els.map((e) => e.dataset.issue));

async function drawSignatureBox(page, area = SIGNATURE_BOX, pageNumber = 1) {
  const sheet = page.locator(`[data-testid=zone-page][data-page="${pageNumber}"]`);
  await sheet.waitFor();
  await sheet.locator('img').evaluate((img) => img.complete || new Promise((r) => (img.onload = r)));
  await sheet.evaluate((el, middle) => {
    const scroller = el.closest('[data-testid=zone-scroller]');
    scroller.scrollTop = Math.max(0, el.offsetTop + el.offsetHeight * middle - scroller.clientHeight / 2);
  }, area.y + area.h / 2);
  const b = await sheet.boundingBox();
  const x0 = b.x + b.width * area.x;
  const y0 = b.y + b.height * area.y;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + b.width * area.w, y0 + b.height * area.h, { steps: 10 });
  await page.mouse.up();
}

async function verdict(page) {
  const el = page.locator('[data-testid=zone-verdict][data-signed="true"], [data-testid=zone-verdict][data-signed="false"]');
  await el.waitFor();
  return (await el.getAttribute('data-signed')) === 'true';
}

async function trySample(page, file) {
  await page.setInputFiles('[data-testid=zone-file]', file);
  await page.getByText(`Showing ${file.split(/[\\/]/).pop()}`).waitFor();
  return verdict(page);
}

const MM = 25.4 / 72;
async function readPrintedPdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      widthMm: viewport.width * MM,
      heightMm: viewport.height * MM,
      items: content.items
        .filter((i) => i.str && i.str.trim())
        .map((i) => ({ str: i.str, xMm: i.transform[4] * MM, baselineMm: (viewport.height - i.transform[5]) * MM })),
    });
  }
  return pages;
}

// ---- The test ----------------------------------------------------------------------------

async function main() {
  // Sample requisitions (all made up).
  const f = {
    gi125unsigned: await fixture('gi-125-unsigned.pdf', { company: GI, payee: 'Peter Otieno', chq: '000125', amount: '12,500/=', words: 'Twelve Thousand Five Hundred Only' }),
    gi125signed: await fixture('gi-125-signed.pdf', { company: GI, payee: 'Peter Otieno', chq: '000125', amount: '12,500/=', words: 'Twelve Thousand Five Hundred Only', signature: 'drawn' }),
    gi130: await fixture('gi-130.pdf', { company: GI, payee: 'Zawadi Traders Ltd', chq: '000130', amount: '7,000/=', words: 'Seven Thousand Only', signature: 'drawn' }),
    gi123: await fixture('gi-123.pdf', { company: GI, payee: 'Paul Angalushe', chq: '000123', amount: '58,000/=', words: 'Fifty Eight Thousand Only', signature: 'drawn' }),
    gi124image: await fixture('gi-124-image.pdf', { company: GI.toUpperCase().replace('LTD', 'LIMITED'), payee: 'Acme Supplies Ltd', chq: '000124', amount: '15,000.50', words: 'Fifteen Thousand and Fifty Cents Only', signature: 'image' }),
    gi126annot: await fixture('gi-126-annotation.pdf', { company: GI, payee: 'Mary Wanjiru', chq: '000126', amount: '3,200/=', words: 'Three Thousand Two Hundred Only', signature: 'annotation' }),
    gi127typed: await fixture('gi-127-typed.pdf', { company: GI, payee: 'Typed Name Only Ltd', chq: '000127', amount: '1,000/=', words: 'One Thousand Only', signature: 'typed' }),
    gi128mismatch: await fixture('gi-128-mismatch.pdf', { company: GI, payee: 'Mismatch Payee', chq: '000128', amount: '58,000/=', words: 'Fifty Thousand Only', signature: 'drawn' }),
    sh501: await fixture('sh-501.pdf', { company: SH, payee: 'Kamau Hardware', chq: '000501', amount: '9,999/=', words: 'Nine Thousand Nine Hundred Ninety Nine Only', signature: 'drawn' }),
    sh500: await fixture('sh-500.pdf', { company: SH, payee: 'Lake Motors', chq: '000500', amount: '120,000/=', words: 'One Hundred Twenty Thousand Only', signature: 'drawn' }),
    unknown: await fixture('unknown-company.pdf', { company: 'Mystery Ventures Ltd', payee: 'Nairobi Water', chq: '000131', amount: '2,500/=', words: 'Two Thousand Five Hundred Only', signature: 'drawn' }),
    reuse123: await fixture('gi-123-reused.pdf', { company: GI, payee: 'Somebody Else', chq: '000123', amount: '900/=', words: 'Nine Hundred Only', signature: 'drawn' }),
    combineA: await fixture('combine-a.pdf', { company: GI, payee: 'Combined Payee Ltd', chq: '000140', amount: '10,000/=', words: 'Ten Thousand Only', signature: 'drawn' }),
    combineB: await fixture('combine-b.pdf', { company: GI, payee: 'Combined Payee Ltd', chq: '000140', amount: '5,500/=', words: 'Five Thousand Five Hundred Only', signature: 'drawn', details: 'Second invoice' }),
    redo124: await fixture('gi-124-redo.pdf', { company: GI, payee: 'Acme Supplies Ltd', chq: '000132', amount: '15,000.50', words: 'Fifteen Thousand and Fifty Cents Only', signature: 'drawn', details: 'Re-issued after spoiled cheque' }),
    double123: await fixture('gi-123-double.pdf', { company: GI, payee: 'Paul Angalushe', chq: '000133', amount: '58,000/=', words: 'Fifty Eight Thousand Only', signature: 'drawn', details: 'Same payment again' }),
    receipt: join(dirs.pdfs, 'gi-receipt-122.pdf'),
    receiptUnsigned: join(dirs.pdfs, 'gi-receipt-121-unsigned.pdf'),
    receiptPage2: join(dirs.pdfs, 'gi-receipt-119-two-pages.pdf'),
    receiptPage2Unsigned: join(dirs.pdfs, 'gi-receipt-118-two-pages-unsigned.pdf'),
    notPdf: join(dirs.pdfs, 'not-a-pdf.pdf'),
    scan: join(dirs.pdfs, 'scan.pdf'),
  };
  // The accounts-system receipt: month-first date (5 June written 06/05/2026), cheque number on a wrapped line.
  writeFileSync(f.receipt, await makeReceiptPdf({ bank: 'I&M Bank', payee: 'JOHN SAMPLE PAYEE', date: '06/05/2026', amount: '59,000.00', chq: '122', signed: true }));
  writeFileSync(f.receiptUnsigned, await makeReceiptPdf({ bank: 'I&M Bank', payee: 'OTHER SAMPLE PAYEE', date: '06/05/2026', amount: '1,200.00', chq: '121', signed: false }));
  // Long receipts whose approval lines fall on a second page.
  writeFileSync(f.receiptPage2, await makeReceiptPdf({ bank: 'I&M Bank', payee: 'LONG RECEIPT PAYEE', date: '06/05/2026', amount: '7,700.00', chq: '119', signed: true, approvalOnPage2: true }));
  writeFileSync(f.receiptPage2Unsigned, await makeReceiptPdf({ bank: 'I&M Bank', payee: 'LONG UNSIGNED PAYEE', date: '06/05/2026', amount: '8,800.00', chq: '118', signed: false, approvalOnPage2: true }));
  // A voucher signed only on its second page, the requisition note.
  f.noteSigned = await fixture('gi-150-signed-on-note.pdf', { company: GI, payee: 'Note Signer Ltd', chq: '000150', amount: '4,000/=', words: 'Four Thousand Only', note: 'signed' });
  writeFileSync(f.notPdf, 'this is not a pdf');
  writeFileSync(f.scan, await makeImageOnlyPdf());

  let { app, page } = await launch();

  step('First run: create the administrator');
  await page.getByLabel('Your name').fill('Brian');
  await page.getByLabel('Username', { exact: true }).fill('brian');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password again').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create administrator account' }).click();
  await page.locator('[data-tab="import"]').waitFor();
  check(await page.locator('[data-tab="setup"]').isVisible(), 'administrator is signed in and sees Setup');

  step('The app is offline');
  const outside = await page.evaluate(() => fetch('https://example.com').then(() => 'reached', () => 'blocked'));
  checkEqual(outside, 'blocked', 'requests to the internet are blocked');

  step('Add two companies');
  await tab(page, 'setup');
  for (const name of [GI, SH]) {
    await page.fill('[data-testid=new-company-name]', name);
    await page.click('[data-testid=add-company]');
    await page.getByText('← Companies').click();
  }
  check((await page.getByText('No signature box').count()) === 2, 'both companies start without a signature box');

  step('A requisition is held until its company has a signature box');
  let results = await load(page, [f.gi125unsigned]);
  checkEqual(results[0].state, 'held', 'unsigned requisition is held');
  check(results[0].text.includes('signature box'), 'the reason given is the missing signature box');

  step('Teach the signature box from the held requisition');
  await tab(page, 'held');
  checkEqual(await heldIssues(page, '000125'), ['signature_zone_missing'], 'held for: signature box not set');
  await page.click('[data-testid=zone-open]');
  await drawSignatureBox(page);
  checkEqual(await verdict(page), false, 'unsigned sample reads NOT SIGNED (printed line and label ignored)');
  checkEqual(await trySample(page, f.gi123), true, 'drawn signature reads SIGNED');
  checkEqual(await trySample(page, f.gi124image), true, 'pasted signature image reads SIGNED');
  checkEqual(await trySample(page, f.gi126annot), true, 'pen annotation reads SIGNED');
  checkEqual(await trySample(page, f.gi127typed), false, 'a typed name alone reads NOT SIGNED');
  await shot(page, '01-signature-box');
  await page.click('[data-testid=zone-save]');
  await page.locator('[data-testid=held-list] > li[data-cheque="000125"] [data-issue="unsigned"]').waitFor();
  checkEqual(await heldIssues(page, '000125'), ['unsigned'], 'after saving, the held requisition is re-checked: not signed');

  step('Set the second company\'s signature box from Setup');
  await tab(page, 'setup');
  await page.getByText(SH).click();
  await page.click('[data-testid=open-zone]');
  await page.setInputFiles('[data-testid=zone-file]', f.sh501);
  await drawSignatureBox(page);
  checkEqual(await verdict(page), true, 'sample for the second company reads SIGNED');
  await page.click('[data-testid=zone-save]');
  await page.locator('[data-testid=zone-list] li[data-form="requisition_voucher"][data-set="yes"]').waitFor();
  checkEqual(await page.locator('[data-testid=zone-list] li[data-form="payment_receipt"]').getAttribute('data-set'), 'no', 'each kind of form has its own signature box');

  step('Drop a mixed batch');
  results = await load(page, [f.gi130, f.gi123, f.gi124image, f.gi126annot, f.gi127typed, f.gi128mismatch, f.sh501, f.sh500, f.unknown, f.notPdf, f.scan, f.gi123]);
  checkEqual(
    results.map((r) => r.state),
    ['queued', 'queued', 'queued', 'queued', 'held', 'held', 'queued', 'queued', 'held', 'error', 'error', 'skipped'],
    'each file ends up in the right place'
  );
  check(results[2].text.includes(GI), 'LIMITED / Ltd and capitals still match the company');
  check(results[4].text.includes('not signed'), 'typed-name requisition is held as not signed');
  check(results[5].text.includes('does not match'), 'words/figures mismatch is held');
  check(results[8].text.includes('not recognised'), 'unknown company is held');
  check(results[9].text.includes('Not a PDF'), 'a non-PDF is rejected');
  check(results[10].text.includes('scan'), 'a scan with no text is rejected');
  check(results[11].text.includes('Already loaded'), 'the same file twice is not loaded again');

  step('A signed copy replaces the held unsigned one');
  results = await load(page, [f.gi125signed]);
  checkEqual(results[0].state, 'queued', 'signed copy goes to the queue');
  check(results[0].text.includes('Signed copy received'), 'and says it replaced the unsigned one');
  checkEqual(await page.locator('[data-testid=held-count]').innerText(), '3', 'three remain held');

  step('Print queue: by company, ascending cheque number');
  await tab(page, 'queue');
  checkEqual(await page.locator('section[data-company]').evaluateAll((s) => s.map((x) => x.dataset.company)), [GI, SH], 'companies are separate and in name order');
  checkEqual(await queueNumbers(page, GI), ['000123', '000124', '000125', '000126', '000130'], `${GI} is in ascending order`);
  checkEqual(await queueNumbers(page, SH), ['000500', '000501'], `${SH} is in ascending order`);
  check((await page.locator(`section[data-company="${GI}"]`).innerText()).includes('000127–000129'), 'the gap in the numbers is pointed out');
  await shot(page, '02-print-queue');

  step('Add an operator and a supervisor');
  await tab(page, 'setup');
  await page.click('[data-section="users"]');
  for (const [name, username, role] of [['Mary', 'mary', 'operator'], ['Sam', 'sam', 'supervisor']]) {
    await page.click('[data-testid=add-user]');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.selectOption('[data-testid=new-user-role]', role);
    await page.getByLabel('Starting password').fill(PASSWORD);
    await page.click('[data-testid=create-user]');
    await page.locator(`tr[data-user="${username}"]`).waitFor();
  }
  await signOut(page);

  step('Operator: limited rights');
  await signIn(page, 'mary');
  checkEqual(await page.locator('[data-tab="setup"]').count(), 0, 'operator has no Setup tab');
  await tab(page, 'held');
  const mismatchRow = page.locator('[data-testid=held-list] > li[data-cheque="000128"]');
  check((await mismatchRow.innerText()).includes('Needs a supervisor'), 'operator cannot edit a held cheque');
  checkEqual(await mismatchRow.locator('[data-testid=edit-open]').count(), 0, 'no edit button for the operator');

  step('Operator needs a supervisor to override an unsigned requisition');
  const typedRow = page.locator('[data-testid=held-list] > li[data-cheque="000127"]');
  await typedRow.locator('[data-testid=override-open]').click();
  await page.fill('[data-testid=override-reason]', 'Brian approved by phone, signed copy to follow');
  await page.getByLabel('Supervisor username').fill('sam');
  await page.getByLabel('Supervisor password').fill('wrong-password');
  await page.click('[data-testid=override-submit]');
  await page.getByText('Wrong supervisor username or password.').waitFor();
  check(true, 'a wrong supervisor password is refused');
  await page.getByLabel('Supervisor username').fill('mary');
  await page.getByLabel('Supervisor password').fill(PASSWORD);
  await page.click('[data-testid=override-submit]');
  await page.getByText('Mary is not allowed to override.').waitFor();
  check(true, 'an operator cannot approve their own override');
  await page.getByLabel('Supervisor username').fill('sam');
  await page.getByLabel('Supervisor password').fill(PASSWORD);
  await page.click('[data-testid=override-submit]');
  await typedRow.waitFor({ state: 'detached' });
  await tab(page, 'queue');
  checkEqual(await queueNumbers(page, GI), ['000123', '000124', '000125', '000126', '000127', '000130'], 'the overridden cheque joins the queue in order');

  step('Print one company: loading prompt, then record what happened');
  await page.locator(`section[data-company="${GI}"] [data-testid=print-company]`).click();
  checkEqual(
    await page.locator('[data-testid=load-order] li').evaluateAll((items) => items.map((li) => li.querySelector('.font-mono').textContent)),
    ['000123', '000124', '000125', '000126', '000127', '000130'],
    'loading prompt lists the leaves lowest number first'
  );
  check((await page.locator('[data-testid=missing-leaves]').innerText()).includes('000128 to 000129'), 'prompt says which leaves to take out of the stack');
  check(await page.locator('[data-testid=print-now]').isDisabled(), 'cannot print until the first leaf is confirmed');
  await shot(page, '03-loading-prompt');
  await page.check('[data-testid=first-leaf]');
  await page.click('[data-testid=print-now]');
  await page.locator('[data-testid=print-results]').waitFor();
  await page.selectOption('[data-testid="result-000124"]', 'spoiled');
  await page.getByPlaceholder('What went wrong?').fill('Paper jam');
  await page.selectOption('[data-testid="result-000130"]', 'not_printed');
  check(await page.locator('[data-testid=save-results]').isDisabled(), 'results cannot be saved until checked');
  await page.check('[data-testid=results-checked]');
  await page.click('[data-testid=save-results]');
  await page.locator('[data-testid=print-results]').waitFor({ state: 'detached' });
  checkEqual(await queueNumbers(page, GI), ['000130'], 'only the leaf that did not print is still queued');

  step('What was sent to the printer');
  const prints = readdirSync(dirs.prints);
  checkEqual(prints.length, 1, 'one print job for the company');
  const printed = await readPrintedPdf(join(dirs.prints, prints[0]));
  checkEqual(printed.length, 6, 'one page per cheque, no blank pages');
  check(printed.every((p) => Math.abs(p.widthMm - 215) < 0.5 && Math.abs(p.heightMm - 85) < 0.5), 'every page is exactly cheque size (215 × 85 mm)');
  const find = (p, needle) => p.items.find((i) => i.str.includes(needle));
  check(!!find(printed[0], 'Paul Angalushe') && !!find(printed[5], 'Zawadi Traders'), 'pages follow cheque-number order');
  // Default layout: date (148,12) payee (22,34) figures (159,34) words (44,46); 11pt text sits ~3.7 mm below its top.
  const expected = [['05/06/2026', 148, 12], ['Paul Angalushe', 22, 34], ['58,000/=', 159, 34], ['Fifty Eight Thousand Only', 44, 46]];
  for (const [textOnCheque, x, top] of expected) {
    const item = find(printed[0], textOnCheque);
    check(!!item, `"${textOnCheque}" is on the cheque`);
    check(Math.abs(item.xMm - x) < 0.4, `"${textOnCheque}" starts ${x} mm from the left (measured ${item.xMm.toFixed(2)})`);
    check(Math.abs(item.baselineMm - (top + 3.7)) < 0.7, `"${textOnCheque}" sits ${top} mm from the top (baseline ${item.baselineMm.toFixed(2)})`);
  }
  check(!!find(printed[1], '15,000.50') && !!find(printed[1], 'Fifteen Thousand and Fifty Cents Only'), 'cents are printed in figures and words');

  step('Register shows the outcome');
  await tab(page, 'register');
  const register = async () =>
    Object.fromEntries(await page.locator('[data-testid=register-table] tbody tr[data-cheque]').evaluateAll((rows) => rows.map((r) => [r.dataset.cheque + (r.dataset.status === 'cancelled' ? ' (discarded)' : ''), r.dataset.status])));
  let reg = await register();
  checkEqual([reg['000123'], reg['000124'], reg['000125'], reg['000126'], reg['000127'], reg['000130']], ['printed', 'spoiled', 'printed', 'printed', 'printed', 'pending'], 'printed, spoiled and not-printed are recorded');
  checkEqual(reg['000125 (discarded)'], 'cancelled', 'the replaced unsigned copy is kept as discarded');
  await signOut(page);

  step('Supervisor: fix a mismatch and assign a company');
  await signIn(page, 'sam');
  checkEqual(await page.locator('[data-tab="setup"]').count(), 0, 'supervisor has no Setup tab');
  await tab(page, 'held');
  await page.locator('[data-testid=held-list] > li[data-cheque="000128"] [data-testid=edit-open]').click();
  await page.getByLabel('Amount (KES)').fill('58,000');
  await page.click('[data-testid=save-edit]');
  await page.locator('[data-testid=held-list] > li[data-cheque="000128"]').waitFor({ state: 'detached' });
  check(true, 'confirming the amount clears the mismatch');
  await page.locator('[data-testid=held-list] > li[data-cheque="000131"]').getByRole('button', { name: 'Choose company…' }).click();
  await page.getByRole('button', { name: GI }).click();
  await tab(page, 'queue');
  await page.locator(`section[data-company="${GI}"] tr[data-cheque="000131"]`).waitFor();
  checkEqual(await queueNumbers(page, GI), ['000128', '000130', '000131'], 'assigned requisition is signature-checked and queued');

  step('Cheque numbers and payments cannot be used twice');
  results = await load(page, [f.reuse123, f.combineA, f.combineB, f.redo124, f.double123]);
  checkEqual(results.map((r) => r.state), ['held', 'queued', 'held', 'queued', 'held'], 'reused number held; redo after a spoiled cheque allowed; double payment held');
  check(results[0].text.includes('already printed') && results[0].text.includes('cannot be used twice'), 'a printed cheque number is refused');
  check(results[4].text.includes('Possible double payment'), 'same payee, amount and date on a new number is flagged');
  await tab(page, 'held');
  checkEqual(await page.locator('[data-testid=held-list] > li[data-cheque="000123"] [data-testid=resolve-open]').count(), 0, 'no way to release a number that was already printed');
  checkEqual((await heldIssues(page, '000140')).filter((k) => k === 'duplicate_number').length, 2, 'two requisitions on one cheque number are both held');

  step('Two requisitions paid by one cheque are combined');
  await page.locator('[data-testid=held-list] > li[data-cheque="000140"] [data-testid=resolve-open]').first().click();
  check((await page.locator('[data-testid=combine]').innerText()).includes('15,500.00'), 'the combined total is shown before confirming');
  await page.click('[data-testid=combine]');
  await tab(page, 'queue');
  const combinedRow = page.locator(`section[data-company="${GI}"] tr[data-cheque="000140"]`);
  check((await combinedRow.innerText()).includes('15,500.00'), 'one cheque for the total is queued');
  check((await combinedRow.innerText()).includes('2 requisitions combined'), 'and is marked as combined');
  checkEqual(await queueNumbers(page, GI), ['000128', '000130', '000131', '000132', '000140'], 'queue stays in ascending order');

  step('Export the register');
  await tab(page, 'register');
  await page.click('[data-testid=export-register]');
  await page.getByText('Saved to').waitFor();
  const csvFile = readdirSync(dirs.saves).find((n) => n.startsWith('cheque-register'));
  const csv = readFileSync(join(dirs.saves, csvFile), 'utf8');
  check(csv.includes('Printed,Golden Ivy Investments Ltd,"=""000123""",05/06/2026,Paul Angalushe,"58,000.00",Signed'), 'spreadsheet has the printed cheque, with leading zeros kept');
  check(csv.includes('Override by Sam: Brian approved by phone'), 'the override, approver and reason are in the spreadsheet');

  await page.click('[data-view="activity"]');
  const actions = await page.locator('[data-testid=activity-table] tbody tr').evaluateAll((rows) => rows.map((r) => r.dataset.action));
  for (const action of ['Override', 'Printed', 'Spoiled', 'Did not print', 'Confirmed cheque details', 'Assigned company', 'Combined requisitions']) {
    check(actions.includes(action), `activity log records "${action}"`);
  }
  await shot(page, '04-activity-log');

  step('Closing the app after printing, before recording, cannot cause a double print');
  await tab(page, 'queue');
  await page.locator(`section[data-company="${SH}"] [data-testid=print-company]`).click();
  await page.check('[data-testid=first-leaf]');
  await page.click('[data-testid=print-now]');
  await page.locator('[data-testid=print-results]').waitFor();
  await app.close(); // walked away without saying what came out
  ({ app, page } = await launch());
  await signIn(page, 'mary');
  await tab(page, 'queue');
  checkEqual(await page.locator(`section[data-company="${SH}"]`).count(), 0, 'cheques already sent to the printer are not offered again');
  await tab(page, 'held');
  checkEqual(await heldIssues(page, '000500'), ['print_unconfirmed'], 'they are held until someone records what happened');
  await page.locator('[data-testid=held-list] > li[data-cheque="000500"] [data-testid=record-result]').click();
  checkEqual(await page.locator('[data-testid=print-results] > li').count(), 2, 'both leaves of the interrupted run are listed');
  await page.selectOption('[data-testid="result-000501"]', 'not_printed');
  await page.check('[data-testid=results-checked]');
  await page.click('[data-testid=save-results]');
  await page.locator('[data-testid=print-results]').waitFor({ state: 'detached' });
  await tab(page, 'queue');
  checkEqual(await queueNumbers(page, SH), ['000501'], 'the leaf that did not print is back in the queue');

  step('Everything survives a restart');
  await app.close();
  check(existsSync(join(dirs.data, 'data.json')), 'data file is on disk');
  check(readdirSync(join(dirs.data, 'requisitions')).length >= 15, 'requisition PDFs are archived');
  ({ app, page } = await launch());
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  check(true, 'the app asks for sign-in again');
  await signIn(page, 'brian');
  await tab(page, 'register');
  reg = await register();
  checkEqual([reg['000123'], reg['000124'], reg['000130'], reg['000500']], ['printed', 'spoiled', 'pending', 'printed'], 'register is intact after restart');
  await tab(page, 'queue');
  checkEqual(await queueNumbers(page, GI), ['000128', '000130', '000131', '000132', '000140'], 'queue is intact after restart');
  checkEqual(await queueNumbers(page, SH), ['000501'], 'second company still queued');

  step('One company, two kinds of form: the accounts-system receipt');
  results = await load(page, [f.receipt, f.receiptUnsigned]);
  checkEqual(results.map((r) => r.state), ['held', 'held'], 'a receipt from an unknown bank account is held');
  check(results[0].text.includes('I&M Bank (Golden Ivy Investments)') && results[0].text.includes('not recognised'), 'the bank account on the receipt identifies the cheque book');
  await tab(page, 'held');
  await page.locator('[data-testid=held-list] > li[data-cheque="122"]').getByRole('button', { name: 'Choose company…' }).click();
  await page.getByRole('button', { name: GI, exact: true }).click();
  const receiptRow = page.locator('[data-testid=held-list] > li[data-cheque="122"]');
  await receiptRow.locator('[data-issue="signature_zone_missing"]').waitFor();
  checkEqual(await heldIssues(page, '121'), ['signature_zone_missing'], 'the second receipt from that account is recognised too');
  check((await receiptRow.innerText()).includes('Payment receipt'), 'held: this kind of form has no signature box yet');
  await receiptRow.locator('[data-testid=zone-open]').click();
  await page.locator('[data-testid=zone-form][data-form="payment_receipt"]').waitFor();
  await drawSignatureBox(page, RECEIPT_SIGNATURE_BOX);
  checkEqual(await verdict(page), true, 'signed receipt reads SIGNED (typed name and underline ignored)');
  checkEqual(await trySample(page, f.receiptUnsigned), false, 'unsigned receipt reads NOT SIGNED');
  await page.click('[data-testid=zone-save]');
  await receiptRow.waitFor({ state: 'detached' });
  checkEqual(await heldIssues(page, '121'), ['unsigned'], 'the unsigned receipt stays held');
  await tab(page, 'queue');
  const receiptInQueue = page.locator(`section[data-company="${GI}"] tr[data-cheque="122"]`);
  check((await receiptInQueue.innerText()).includes('05/06/2026'), 'month-first date 06/05/2026 is read as 5 June');
  check((await receiptInQueue.innerText()).includes('59,000.00'), 'payment amount is read from the receipt');
  checkEqual((await queueNumbers(page, GI))[0], '122', 'a cheque number wrapped on to the next line is read, and sorts first');

  step('A signature on a later page');
  results = await load(page, [f.receiptPage2, f.receiptPage2Unsigned, f.noteSigned]);
  checkEqual(results.map((r) => r.state), ['queued', 'held', 'held'], 'a receipt signed on page two is found: its box follows the words APPROVED BY');
  check(results[1].text.includes('not signed'), 'the same receipt unsigned on page two is held');
  check(results[2].text.includes('not signed'), 'a voucher signed only on its page-two note is held at first');
  await tab(page, 'held');
  const noteRow = page.locator('[data-testid=held-list] > li[data-cheque="000150"]');
  await noteRow.locator('[data-testid=zone-fix]').click();
  check((await page.locator('[data-testid=zone-page-count]').innerText()).startsWith('2 pages'), 'the signature-box screen shows every page of the requisition');
  await page.locator('[data-testid=zone-page][data-page="2"]').waitFor();
  checkEqual(await verdict(page), false, 'the existing box, on page one, finds no signature');
  await drawSignatureBox(page, NOTE_SIGNATURE_BOX, 2);
  checkEqual(await verdict(page), true, 'a second box drawn on page two finds it');
  await shot(page, '05-second-page-box');
  await page.click('[data-testid=zone-save]');
  await noteRow.waitFor({ state: 'detached' });
  checkEqual(await heldIssues(page, '118'), ['unsigned'], 'the unsigned two-page receipt is still held');
  check(await page.locator('[data-testid=held-list] > li[data-cheque="118"] [data-testid=zone-fix]').isVisible(), 'an administrator can open the signature box from a held requisition');
  await tab(page, 'queue');
  const giQueue = await queueNumbers(page, GI);
  check(giQueue.includes('119') && giQueue.includes('000150'), 'both requisitions signed on page two are now queued');
  check(giQueue.includes('000128'), 'vouchers signed on page one still pass with two boxes saved');

  step('Send the register to another computer');
  await tab(page, 'register');
  await page.click('[data-testid=send-register]');
  await page.getByText('used cheques saved to').waitFor();
  const shareFile = join(dirs.saves, readdirSync(dirs.saves).find((n) => n.startsWith('cheques-used')));
  const shared = JSON.parse(readFileSync(shareFile, 'utf8'));
  check(shared.cheques.every((c) => c.status === 'printed' || c.status === 'spoiled'), 'only printed and spoiled cheques are sent');
  check(shared.cheques.some((c) => c.chequeNumber === '000123'), 'the printed cheque is in the file');

  step('Clear the print queue');
  await tab(page, 'queue');
  page.once('dialog', (d) => d.accept());
  await page.locator(`section[data-company="${SH}"] [data-testid=clear-company]`).click();
  await page.locator(`section[data-company="${SH}"]`).waitFor({ state: 'detached' });
  check((await queueNumbers(page, GI)).length > 0, 'clearing one company leaves the others alone');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-testid=clear-all]');
  await page.getByText('The print queue is empty.').waitFor();
  await tab(page, 'register');
  reg = await register();
  checkEqual([reg['000501 (discarded)'], reg['000123']], ['cancelled', 'printed'], 'cleared cheques are kept as discarded; printed ones are untouched');
  await app.close();

  step('A second computer takes the register in');
  ({ app, page } = await launch(join(tmp, 'data-second-computer'), { CHEQUE_PRINTER_E2E_OPEN_FILE: shareFile }));
  await page.getByLabel('Your name').fill('Second');
  await page.getByLabel('Username', { exact: true }).fill('second');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password again').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create administrator account' }).click();
  await tab(page, 'register');
  await page.click('[data-testid=receive-register]');
  await page.getByText('Register received').waitFor();
  reg = await register();
  checkEqual([reg['000123'], reg['000124'], reg['000500']], ['printed', 'spoiled', 'printed'], 'cheques used on the first computer are now recorded here');
  results = await load(page, [f.gi123, f.reuse123]);
  checkEqual(results.map((r) => r.state), ['skipped', 'held'], 'nothing already used on the other computer can be loaded for printing here');
  check(results[0].text.includes('Already printed as cheque 000123'), 'the very same requisition is recognised as already printed');
  check(results[1].text.includes('already printed') && results[1].text.includes('cannot be used twice'), 'a different requisition for that cheque number is held');
  await tab(page, 'queue');
  await page.getByText('The print queue is empty.').waitFor();
  check(true, 'nothing reaches this computer\'s print queue');
  await app.close();

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch(async (err) => {
  await lastPage?.screenshot({ path: join(dirs.shots, 'failure.png') }).catch(() => undefined);
  console.error(`\n${err.stack ?? err}`);
  console.error(`\nScreenshots, data and captured prints are in ${tmp}`);
  process.exit(1);
});
