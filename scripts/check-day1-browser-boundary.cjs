// Day 1 Browser UI 5 MB Boundary Verification (guideline.md §§5, 10, 12; CHECKLIST.md Day 1).
// Generates real exact-byte PDFs (4,999,999 / 5,000,000 / 5,000,001 B), exercises them through the
// real browser UI (no route interception) in ID and EN, verifies multipart overhead reaches the
// server RAM parser for <= 5,000,000 B, and verifies 5,000,001 B gets a size error in browser & server.
// Reusable against a deployed URL via UPLOAD_BASE_URL=https://...
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_PDF_BYTES = 5_000_000;
const baseUrl = process.env.UPLOAD_BASE_URL || 'http://127.0.0.1:3000';

function buildExactSizePdf(size) {
  const lines = [
    'Nadia Putri - Data Analyst Intern',
    'SKILLS: Python, Excel',
    '- Built a Python script to clean duplicate rows.',
    '- Helped make weekly reports in Excel.',
    '- Wrote instructions for the reports.',
  ];
  const stream =
    'BT /F1 12 Tf 50 740 Td ' +
    lines.map((l, i) => (i === 0 ? `(${l}) Tj` : `0 -18 Td (${l}) Tj`)).join(' ') +
    ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let body = '%PDF-1.4\n';
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (const [i, obj] of objects.entries()) {
    table += String(body.length).padStart(10, '0') + ' 00000 n \n';
    body += i + 1 + ' 0 obj\n' + obj + '\nendobj\n';
  }
  table += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n';
  const end = '\n%%EOF\n';
  const offset = size - table.length - 7 - end.length;
  const bytes = body.padEnd(offset, ' ') + table + offset + end;
  assert.equal(bytes.length, size);
  return Buffer.from(bytes, 'latin1');
}

(async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latihkerja-day1-boundary-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const files = {};
    for (const size of [MAX_PDF_BYTES - 1, MAX_PDF_BYTES, MAX_PDF_BYTES + 1]) {
      const filePath = path.join(tmpDir, `boundary-${size}.pdf`);
      await fs.writeFile(filePath, buildExactSizePdf(size));
      const stat = await fs.stat(filePath);
      assert.equal(stat.size, size);
      files[size] = filePath;
    }

    // 1. Server-side direct multipart checks on BOTH /api/upload-proof and /api/analyze-cv for 5,000,001 B.
    const overBuf = await fs.readFile(files[MAX_PDF_BYTES + 1]);
    for (const endpoint of ['/api/upload-proof', '/api/analyze-cv']) {
      const form = new FormData();
      form.append('file', new Blob([overBuf], { type: 'application/pdf' }), 'boundary-5000001.pdf');
      if (endpoint === '/api/analyze-cv') {
        form.append('jobDescription', 'Data intern requiring Python, Excel, and SQL.');
        form.append('language', 'en');
      }
      const res = await fetch(new URL(endpoint, baseUrl), { method: 'POST', body: form });
      assert.equal(res.status, 413, `Expected 413 on ${endpoint} for 5,000,001 B`);
      const json = await res.json();
      const code = typeof json.error === 'string' ? json.error : json.error?.code;
      assert.equal(code, 'FILE_TOO_LARGE', `Expected FILE_TOO_LARGE on ${endpoint}`);
      console.log('server-oversize-pass', endpoint, res.status, code);
    }

    // 2. Real Browser UI checks in ID (4,999,999 B & 5,000,001 B) and EN (5,000,000 B & 5,000,001 B).
    for (const [lang, validSize] of [
      ['id', MAX_PDF_BYTES - 1],
      ['en', MAX_PDF_BYTES],
    ]) {
      const en = lang === 'en';
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const networkCalls = [];
      page.on('request', (req) => {
        if (req.url().includes('/api/analyze-cv')) networkCalls.push(req.method());
      });

      await page.goto(baseUrl);
      if (en) await page.getByRole('button', { name: 'EN', exact: true }).click();

      // A. Above boundary (5,000,001 B): must show client-side size error and fire 0 requests.
      await page.locator('#pdf').setInputFiles(files[MAX_PDF_BYTES + 1]);
      const errText = await page.locator('#pdf-error').textContent();
      assert.ok(
        errText && (en ? errText.includes('5 MB') : errText.includes('5 MB')),
        `Expected localized 5 MB error in ${lang}, got: ${errText}`
      );
      assert.equal(networkCalls.length, 0, 'Oversize file must be rejected before network upload');
      console.log('browser-oversize-pass', lang, MAX_PDF_BYTES + 1, errText.trim());

      // B. Valid boundary (4,999,999 B or 5,000,000 B) + JD (multipart overhead > 5,000,000 B):
      // Submit through the real browser UI with NO route mocking and inspect actual server HTTP response!
      await page.locator('#pdf').setInputFiles(files[validSize]);
      assert.equal(await page.locator('#pdf-error').count(), 0, 'Valid boundary file must pass client validation');
      const dropText = await page.locator('.drop').textContent();
      assert.ok(dropText.includes(`boundary-${validSize}.pdf`), 'Drop zone must display selected filename');

      await page.locator('#jd').fill('Data intern requiring Python, Excel, and SQL.');
      const responsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/analyze-cv') && res.request().method() === 'POST',
        { timeout: 25_000 }
      );
      await page.getByRole('button', { name: en ? 'Analyze CV Now' : 'Analisis CV Sekarang' }).click();
      const apiRes = await responsePromise;
      const status = apiRes.status();
      const payload = await apiRes.json().catch(() => null);

      // Must NOT be blocked by host/server size ceiling (413), MIME rejection (415), invalid input (400),
      // or PDF parse failure (422). Reaching 200 (live Gemini) or 503 (upstream Gemini high-demand after
      // passing RAM PDF parsing & redaction!) proves the full boundary PDF + multipart overhead reached the RAM parser!
      assert.ok(
        status === 200 || status === 503,
        `Boundary PDF (${validSize} B) was blocked before/during parsing! HTTP ${status}: ${JSON.stringify(payload)}`
      );
      if (status === 200) {
        assert.ok(Number.isInteger(payload?.atsScore), 'Expected valid atsScore on 200');
        await page.locator('[role="meter"]').waitFor({ timeout: 5_000 });
        console.log('browser-boundary-pass', lang, validSize, 'HTTP 200 (live Gemini + UI rendered)', 'score=' + payload.atsScore);
      } else {
        assert.equal(payload?.error?.code, 'TEMPORARILY_UNAVAILABLE');
        await page.locator('#api-error').waitFor({ timeout: 5_000 });
        console.log('browser-boundary-pass', lang, validSize, 'HTTP 503 (passed RAM parser + redaction; upstream Gemini busy)');
      }

      // Also confirm /api/upload-proof directly parses this exact boundary PDF and extracts text in RAM!
      const validBuf = await fs.readFile(files[validSize]);
      const proofForm = new FormData();
      proofForm.append('file', new Blob([validBuf], { type: 'application/pdf' }), `boundary-${validSize}.pdf`);
      const proofRes = await fetch(new URL('/api/upload-proof', baseUrl), { method: 'POST', body: proofForm });
      assert.equal(proofRes.status, 200);
      const proofJson = await proofRes.json();
      assert.equal(proofJson.bytes, validSize);
      assert.equal(proofJson.pages, 1);
      assert.ok(proofJson.characters > 100, `Expected extracted text > 100 chars, got ${proofJson.characters}`);
      console.log('server-ram-parse-pass', lang, validSize, proofJson);

      await page.close();
    }

    console.log('DAY1_BROWSER_BOUNDARY_ALL_PASSED');
  } finally {
    await browser.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
