#!/usr/bin/env node
/*
 * Headless smoke tests for HTML Notepad (modular and standalone builds).
 *
 *   npm i -D playwright   # once, plus a Chromium (set CHROMIUM_PATH to use an existing one)
 *   node tests/smoke.js
 *
 * Serves the repository root on a random local port and drives the real app.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
    // The standalone file name contains a literal "%20", so also try the raw (undecoded) path.
    const candidates = [rel, decodeURIComponent(rel), req.url.split('?')[0].replace(/^\//, '')].map(p => path.join(ROOT, p));
    const file = candidates.find(p => p.startsWith(ROOT) && fs.existsSync(p) && fs.statSync(p).isFile());
    if (!file) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (error) { failed++; console.log(`  FAIL ${name}\n       ${String(error.message).split('\n')[0]}`); }
}
function eq(actual, expected, label = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const ok = (value, label) => { if (!value) throw new Error(`${label || 'assertion'} failed`); };

async function suite(browser, label, url, { mobile = false } = {}) {
  console.log(`\n${label}`);
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 760 } : { width: 1280, height: 800 }, hasTouch: mobile, isMobile: mobile, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const click = id => page.evaluate(i => document.getElementById(i).click(), id);
  const openDialogs = () => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => d.id));
  const tabNames = () => page.evaluate(() => [...document.querySelectorAll('.tab')].map(t => t.textContent));
  const saveAs = async name => {
    await page.keyboard.press('Control+S'); await page.waitForTimeout(250);
    await page.keyboard.type(name); await page.keyboard.press('Enter'); await page.waitForTimeout(450);
  };
  const newDoc = async kind => {
    await click('newBtn'); await page.click(`#newDocumentDialog button:has-text("${kind}")`); await page.waitForTimeout(200);
  };
  const render = (src, opts) => page.evaluate(([s, o]) => renderMarkdown(s, o), [src, opts]);

  await page.goto(url); await page.waitForTimeout(1200);

  await test('starts with one blank tab', async () => eq((await tabNames()).length, 1));

  if (!mobile) {
    await test('type, save, reload keeps document', async () => {
      await page.click('#editor'); await page.keyboard.type('Hello world'); await saveAs('Doc1');
      await page.reload(); await page.waitForTimeout(1500);
      eq(await page.evaluate(() => document.getElementById('editor').innerText), 'Hello world');
    });
    await test('unsaved edit to a saved file survives a quick reload', async () => {
      await page.click('#editor'); await page.keyboard.press('End'); await page.keyboard.type(' EDITED'); await page.waitForTimeout(300);
      await page.reload(); await page.waitForTimeout(1500);
      eq(await page.evaluate(() => document.getElementById('editor').innerText), 'Hello world EDITED');
    });
    await test('find & replace is literal ($& is not special)', async () => {
      await page.click('#editor'); await page.keyboard.press('Control+A'); await page.keyboard.type('a (c) b');
      await page.keyboard.press('Control+H'); await page.fill('#findInput', '(c)'); await page.fill('#replaceInput', '$&$&');
      await click('replaceAllBtn'); await page.waitForTimeout(200);
      eq(await page.evaluate(() => document.getElementById('editor').innerText), 'a $&amp;$&amp; b'.replace(/&amp;/g, '&'));
      await click('findCloseBtn');
    });
    await test('backup download is a valid Notepad Backup', async () => {
      await click('backupRestoreBtn'); await page.waitForTimeout(250);
      const [download] = await Promise.all([page.waitForEvent('download'), click('createBackupBtn')]);
      const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      eq(data.format, 'Notepad Backup'); ok(Array.isArray(data.files) && data.files.length >= 1, 'files');
      await page.keyboard.press('Escape');
    });
    await test('password protect, then reload leaves a locked-document notice', async () => {
      await page.click('.tab.active', { button: 'right' }); await page.click('#tabProtectCtx'); await page.waitForTimeout(250);
      await page.fill('#protectionPasswordInput', 'secret123'); await page.fill('#protectionPasswordConfirmInput', 'secret123');
      await click('protectionPasswordConfirmBtn'); await page.waitForTimeout(2000);
      if ((await openDialogs()).includes('recoveryKeyDialog')) await page.keyboard.press('Escape');
      await page.reload(); await page.waitForTimeout(1800);
      ok(/locked/i.test(await page.evaluate(() => document.getElementById('statusMessage').textContent)), 'status mentions locked');
    });
  }

  await test('Markdown: code spans, links with underscores, emphasis', async () => {
    const html = await render('use `code` and [l](http://a.com/my_page_x) **b** _i_');
    ok(html.includes('<code>code</code>'), 'code'); ok(html.includes('href="http://a.com/my_page_x"'), 'href intact');
    ok(html.includes('target="_blank"'), 'target intact'); ok(html.includes('<strong>b</strong>') && html.includes('<em>i</em>'), 'emphasis');
  });
  await test('Markdown: raw HTML and javascript: links are escaped', async () => {
    const html = await render('<script>alert(1)</script> [x](javascript:alert(1))');
    ok(!html.includes('<script') && !html.includes('href="javascript'), 'escaped');
  });
  await test('Markdown: tables with alignment and escaped pipes', async () => {
    const html = await render('| a | b |\n|---|--:|\n| 1 | x \\| y |');
    ok(html.includes('<table>') && html.includes('text-align:right') && html.includes('x | y'), html);
  });
  await test('Markdown: nested lists, ordered start, task items', async () => {
    eq(await render('- a\n  - b\n- c'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
    ok((await render('5. a\n6. b')).startsWith('<ol start="5">'), 'ol start');
    ok((await render('- [x] done', { interactive: true })).includes('data-task-line="0" checked'), 'task');
  });
  await test('Markdown: pipes inside code fences are not tables', async () => {
    ok(!(await render('```\n|a|b|\n|-|-|\n```')).includes('<table'), 'no table');
  });
  await test('Markdown preview checkbox rewrites the source', async () => {
    await newDoc('Markdown');
    await page.fill('#markdownSource', '- [ ] one\n- [x] two\n'); await page.dispatchEvent('#markdownSource', 'input');
    await click('markdownPreviewBtn'); await page.waitForTimeout(150);
    await page.click('#markdownPreview input >> nth=0'); await page.waitForTimeout(150);
    eq(await page.evaluate(() => document.getElementById('markdownSource').value), '- [x] one\n- [x] two\n');
  });

  await test('Markdown: footnotes and list-item continuation lines', async () => {
    const html = await render('Hi[^a] there.\n\n[^a]: The note\n\n- one\n  more\n- two');
    ok(html.includes('<sup class="fnref">1</sup>') && html.includes('<section class="footnotes">') && html.includes('The note'), 'footnote');
    ok(html.includes('<li>one<br>more</li>'), 'continuation');
  });
  await test('import: .txt stays raw text, folders keep their structure, notes JSON becomes documents', async () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'notepad-imp-'));
    fs.mkdirSync(path.join(dir, 'proj/sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'proj/a.txt'), 'x < y & z\nline2');
    fs.writeFileSync(path.join(dir, 'proj/sub/b.md'), '# Hi');
    fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify([{ id: 1, title: 'N1', value: 'body & more' }]));
    await page.setInputFiles('#importFolderInput', path.join(dir, 'proj')); await page.waitForTimeout(1000);
    const info = await page.evaluate(() => ({
      a: files.find(f => f.name === 'a')?.content,
      parent: files.find(f => f.name === 'b') && files.find(x => x.id === files.find(f => f.name === 'b').parentId)?.name,
      grand: files.find(f => f.name === 'sub') && files.find(x => x.id === files.find(f => f.name === 'sub').parentId)?.name
    }));
    eq(info.a, 'x < y & z\nline2'); eq(info.parent, 'sub'); eq(info.grand, 'proj');
    await page.setInputFiles('#importDocInput', path.join(dir, 'notes.json')); await page.waitForTimeout(1000);
    eq(await page.evaluate(() => files.find(f => f.name === 'N1')?.content), 'body & more');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  if (!mobile) {
    await test('a 6 MB unsaved draft survives reload (IndexedDB overflow past localStorage)', async () => {
      await newDoc('Plain');
      await page.evaluate(() => {
        const l = 'The quick brown fox jumps over the lazy dog. 0123456789\n';
        const el = document.getElementById('markdownSource'); el.value = l.repeat(Math.floor(6e6 / l.length));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(1000);
      await page.reload(); await page.waitForTimeout(2200);
      ok((await page.evaluate(() => document.getElementById('markdownSource').value.length)) > 5.9e6, 'draft restored');
    });
  }

  if (mobile) {
    await test('second tap on a selected file opens it (touch only)', async () => {
      await newDoc('Plain'); await page.fill('#markdownSource', 'note body'); await page.dispatchEvent('#markdownSource', 'input');
      await saveAs('TapNote');
      // Reload: the saved file is not auto-closed, so close its tab via the tab's x button.
      await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.startsWith('TapNote'))
        .querySelector('[class*="close"], button').click());
      await page.waitForTimeout(300);
      ok(!(await tabNames()).some(n => n.startsWith('TapNote')), 'TapNote tab closed');
      await click('filesToggleBtn'); await page.waitForTimeout(300);
      await page.tap('#fileList >> text=TapNote'); await page.waitForTimeout(300);
      ok(!(await tabNames()).some(n => n.startsWith('TapNote')), 'first tap only selects');
      await page.tap('#fileList >> text=TapNote'); await page.waitForTimeout(500);
      ok((await tabNames()).some(n => n.startsWith('TapNote')), 'second tap opens');
    });
    await test('no horizontal overflow at phone width', async () => {
      eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
  }

  await test('no uncaught page errors', async () => eq(errors, []));
  await context.close();
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    console.log('standalone build');
    await test('standalone file is up to date with the modular source', async () => {
      execFileSync('python3', [path.join(ROOT, 'tools/build_standalone.py'), '--check'], { cwd: ROOT, stdio: 'pipe' });
    });
    const standalone = fs.readdirSync(ROOT).find(f => /^HTML%20Notepad%20v.*\.html$/.test(f));
    await suite(browser, 'modular (desktop)', `${base}/index.html`);
    await suite(browser, 'modular (mobile)', `${base}/index.html`, { mobile: true });
    if (standalone) await suite(browser, 'standalone (desktop)', `${base}/${encodeURIComponent(standalone)}`);
  } finally {
    await browser.close(); server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
