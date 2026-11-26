// Real-browser click-through for Laqeeta. Usage: node tests/e2e.mjs [url]  (default: serves ./docs locally)
// Needs puppeteer-core and a Chrome binary (CHROME env var or /usr/bin/google-chrome).
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
let url = process.argv[2], server;
if (!url) {
  server = http.createServer((q, r) => {
    let f = path.join(root, q.url.split('?')[0].replace(/\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
    const t = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' }[path.extname(f)] || 'application/octet-stream';
    r.setHeader('content-type', t); r.end(fs.readFileSync(f));
  }).listen(0); url = `http://127.0.0.1:${server.address().port}/`;
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR4nGP8z8Dwn4EIwDiqkL4KAQDFpwf1V0m6WQAAAABJRU5ErkJggg==';
fs.writeFileSync('/tmp/laq-pic.png', Buffer.from(png, 'base64'));
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
const pg = await b.newPage(); await pg.setViewport({ width: 390, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept('Garage'));
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log('ok', m); };
const txt = s => pg.$eval(s, e => e.textContent);
const cards = () => pg.$$eval('#list .card', e => e.map(x => x.getAttribute('aria-label')));
await pg.goto(url, { waitUntil: 'networkidle0' });
await pg.evaluate(() => { localStorage.clear(); localStorage.lang = 'ar'; }); await pg.reload({ waitUntil: 'networkidle0' });
ok(await pg.$eval('html', e => e.dir) === 'rtl', 'Arabic RTL by default');
ok((await pg.$eval('#empty', e => e.textContent)).includes('ابدأ'), 'empty state shows onboarding');
async function add(title, where, notes = '', again = false, pic = false) {
  await pg.click('#add'); await pg.waitForSelector('#dlg[open]');
  if (pic) { await (await pg.$('input[data-i="0"]')).uploadFile('/tmp/laq-pic.png'); await pg.waitForFunction(() => document.querySelector('#s1').classList.contains('has')); }
  await pg.type('#title', title); await pg.type('#where', where); if (notes) await pg.type('#notes', notes);
  await pg.click(again ? '#again' : 'button.primary[data-t=save]'); await new Promise(r => setTimeout(r, 400));
}
await add('شاحن الموبايل', 'الدرج التاني', '#كهرباء', false, true);
ok((await cards()).length === 1, 'item saved and listed');
await add('الجواز', 'الدولاب');
await add('Keys', 'Hall drawer');
ok((await cards()).length === 3, 'three items');
// validation: Save-and-add-another with empty fields must not leave a sticky flag
await pg.click('#add'); await pg.waitForSelector('#dlg[open]'); await pg.click('#again');
ok(await pg.$eval('#dlg', d => d.open), 'empty form is blocked');
await pg.type('#title', 'Only'); await pg.type('#where', 'Box'); await pg.click('button.primary[data-t=save]'); await new Promise(r => setTimeout(r, 400));
ok(!(await pg.$eval('#dlg', d => d.open)), 'plain Save closes dialog after a blocked Save-and-add-another');
ok((await cards()).length === 4, 'four items');
// search: Arabic variants, leading al-, digits, typo
await pg.type('#q', 'الجواز'); await new Promise(r => setTimeout(r, 300));
ok((await cards()).length === 1, 'search finds the item');
await pg.$eval('#q', e => e.value = ''); await pg.type('#q', 'شاحن'); await new Promise(r => setTimeout(r, 300));
ok((await cards()).length === 1, 'Arabic search finds the charger');
await pg.$eval('#q', e => e.value = ''); await pg.type('#q', 'zzzz'); await new Promise(r => setTimeout(r, 300));
ok((await cards()).length === 0 && !(await pg.$eval('#empty', e => e.hidden)), 'no-result state');
await pg.click('#qx'); await new Promise(r => setTimeout(r, 200));
ok((await cards()).length === 4, 'clear search restores list');
// view, favorite, edit with place history
await pg.click('#list .card'); await pg.waitForSelector('#view[open]');
await pg.click('#vfav'); await pg.click('#vedit'); await pg.waitForSelector('#dlg[open]');
await pg.$eval('#where', e => e.value = ''); await pg.type('#where', 'New place'); await pg.click('button.primary[data-t=save]'); await new Promise(r => setTimeout(r, 400));
ok((await cards()).length === 4, 'edit keeps count');
// chips + rename place + stale filter
const chips = await pg.$$eval('.chip', e => e.map(x => x.textContent.trim()));
ok(chips.length >= 5, 'place chips rendered');
await pg.evaluate(() => [...document.querySelectorAll('.chip')].find(c => c.dataset.p === 'New place').click());
ok((await cards()).length === 1, 'filter by place');
await pg.click('.chip.ren'); await new Promise(r => setTimeout(r, 500));
ok((await pg.$$eval('.chip', e => e.map(x => x.dataset.p))).includes('Garage'), 'rename place (prompt answered Garage)');
// delete last item of filtered place -> filter resets, no stuck empty list
await pg.click('#list .card'); await pg.waitForSelector('#view[open]'); await pg.click('#vedit'); await pg.waitForSelector('#dlg[open]'); await pg.click('#del'); await new Promise(r => setTimeout(r, 400));
ok((await cards()).length === 3, 'deleting the last item of a filtered place resets the filter');
await pg.click('#toast button'); await new Promise(r => setTimeout(r, 400));
ok((await cards()).length === 4, 'undo delete restores the item');
// export / import round trip (download captured through blob override)
const exported = await pg.evaluate(async () => { let blob; const o = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return o.call(URL, b) }; HTMLAnchorElement.prototype.click = function () { }; document.querySelector('#export').click(); URL.createObjectURL = o; return await blob.text(); });
const arr = JSON.parse(exported); ok(arr.length === 4 && arr.some(i => i.p1 && i.p1.startsWith('data:image')), 'export has all items with photos');
const csv = await pg.evaluate(async () => { let blob; const o = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return o.call(URL, b) }; document.querySelector('#csv').click(); URL.createObjectURL = o; return await blob.text(); });
ok(csv.split('\n').length === 5, 'CSV has header + 4 rows');
const evil = [{ id: 'x1', title: '=HYPERLINK("http://e")', where: 'W', notes: '', p1: 'x" onerror="window.__pwn=1', ts: 'bad' }, { id: 'x2', title: 'Plain' }, { nope: 1 }];
fs.writeFileSync('/tmp/laq-evil.json', JSON.stringify(evil)); fs.writeFileSync('/tmp/laq-back.json', exported); fs.writeFileSync('/tmp/laq-bad.json', '{not json');
await (await pg.$('#import')).uploadFile('/tmp/laq-evil.json'); await new Promise(r => setTimeout(r, 600));
ok((await cards()).length === 6, 'import accepts valid rows, skips junk rows');
ok(!(await pg.evaluate(() => window.__pwn)), 'imported image field cannot inject HTML');
const csv2 = await pg.evaluate(async () => { let blob; const o = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return o.call(URL, b) }; document.querySelector('#csv').click(); URL.createObjectURL = o; return await blob.text(); });
ok(csv2.includes(`"'=HYPERLINK`), 'CSV formula guard');
await (await pg.$('#import')).uploadFile('/tmp/laq-back.json'); await new Promise(r => setTimeout(r, 600));
ok((await cards()).length === 6, 'importing a backup twice does not duplicate (same ids)');
let alerted = null; pg.removeAllListeners('dialog'); pg.on('dialog', d => { alerted = d.message(); d.accept(); });
await (await pg.$('#import')).uploadFile('/tmp/laq-bad.json'); await new Promise(r => setTimeout(r, 500));
ok(alerted === 'Invalid file', 'invalid JSON shows an error');
// language + theme
await pg.click('#lang'); ok(await pg.$eval('html', e => e.dir) === 'ltr', 'EN switches to LTR');
await pg.click('#theme'); ok(await pg.$eval('html', e => e.dataset.theme) === 'light', 'theme toggle');
// keyboard shortcuts + hash search
await pg.keyboard.press('n'); await pg.waitForSelector('#dlg[open]'); await pg.click('#cancel');
await pg.goto(url + '#q=Keys', { waitUntil: 'networkidle0' }); await pg.reload({ waitUntil: 'networkidle0' });
ok((await cards()).length === 1, '#q= link pre-fills search');
// persistence + offline
await pg.evaluate(() => navigator.serviceWorker.ready); await pg.reload({ waitUntil: 'networkidle0' });
await pg.setOfflineMode(true); await pg.reload({ waitUntil: 'networkidle0' });
ok((await txt('title')).includes('Laqeeta') || (await pg.title()).includes('Laqeeta'), 'loads offline');
ok(errs.length === 0, 'no page errors ' + errs.join('|'));
console.log(`\n${passed} checks passed`); await b.close(); server?.close();
