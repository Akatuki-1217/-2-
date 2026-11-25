/*
 * 画面操作のテスト（ブラウザで index.html を開いて、実際にクリック・キー入力する）
 * 実行: node tests/ui.test.js
 * Playwright が必要（npm install playwright && npx playwright install chromium）。
 * 入っていないときはテストを飛ばして終了コード0で終わる。
 */
'use strict';

const path = require('path');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  console.log('Playwright が見つからないため、画面操作のテストを飛ばしました');
  process.exit(0);
}

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  OK   ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

(async function main() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 375, height: 700 } }); // スマホ縦画面
  const errors = [];
  page.on('pageerror', function (e) { errors.push(String(e)); });
  page.on('console', function (m) { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('dialog', function (d) { d.accept(); }); // 「最初から」の確認は OK を押す

  // 演出の待ち時間を短くして速く進める（data.js の値を書き換えるだけで反映される）
  async function open() {
    await page.goto(URL);
    await page.evaluate(function () {
      Object.keys(DATA.timing).forEach(function (k) { if (k !== 'toast') DATA.timing[k] = 5; });
    });
  }

  /** 今の状態：画面名、戦闘中なら 'input'（入力待ち） / 'busy'（演出中） / 'defeat' */
  function state() {
    return page.evaluate(function () {
      if (Game.screen !== 'battle') return Game.screen;
      if (!document.getElementById('defeat-overlay').classList.contains('hidden')) return 'defeat';
      return Game.busy ? 'busy' : 'input';
    });
  }
  async function waitUntil(pred, limit) {
    for (let i = 0; i < (limit || 500); i++) {
      const s = await state();
      if (pred(s)) return s;
      await page.waitForTimeout(10);
    }
    return 'timeout';
  }
  /** 決着まで通常攻撃を続ける（相手が複数なら選ばれている相手に Enter） */
  async function attackUntilEnd() {
    for (let guard = 0; guard < 100; guard++) {
      const s = await waitUntil(function (x) { return x !== 'busy'; });
      if (s !== 'input') return s;
      await page.keyboard.press('a');
      if (await page.locator('#target-prompt').isVisible()) await page.keyboard.press('Enter');
    }
    return 'timeout';
  }

  await open();
  await page.evaluate(function () { localStorage.clear(); });
  await open();

  console.log('■ 拠点と出撃先');
  check('最初は拠点', await state() === 'base');
  await page.keyboard.press('Enter');
  check('Enter で出撃先の一覧', await state() === 'sortie');
  check('出撃先は4つ', await page.locator('.sortie-item').count() === 4);
  await page.locator('.sortie-item').nth(1).click();
  check('ロック中の出撃先はメッセージだけ出て出撃しない',
    await state() === 'sortie' && (await page.locator('#toast').innerText()).indexOf('訓練場') >= 0);
  await page.keyboard.press('Escape');
  check('Esc で拠点に戻る', await state() === 'base');

  console.log('■ 訓練場（1対1）');
  await page.click('#btn-sortie');
  await page.locator('.sortie-item').nth(0).click();
  check('訓練場に出撃すると敵は1体', await state() !== 'sortie' && await page.locator('#enemy-row .unit-panel').count() === 1);
  await waitUntil(function (s) { return s === 'input'; });
  await page.click('[data-cmd=attack]');
  check('敵が1体なら攻撃先を選ばずに攻撃する', !(await page.locator('#target-prompt').isVisible()));
  check('通常攻撃で勝って結果画面へ', await attackUntilEnd() === 'result');
  check('初回クリアで次の出撃先が開く', (await page.locator('#result-body').innerText()).indexOf('森の小道') >= 0);
  const hpAfter = await page.evaluate(function () { return Game.ch.hp; });
  await page.click('#btn-to-base');
  check('拠点に戻るとHP全回復', await page.evaluate(function () { return Game.ch.hp === Growth.getEffectiveStats(Game.ch, DATA).hp; }) && hpAfter < 50);

  console.log('■ セーブ');
  await open();
  check('再読み込みしてもクリア状況・経験値が残る', await page.evaluate(function () {
    return Game.ch.cleared.join() === 'training' && Game.ch.exp === 10 && Game.ch.sp === 1;
  }));

  console.log('■ 森の小道（攻撃先の選択）');
  await page.click('#btn-sortie');
  await page.locator('.sortie-item').nth(1).click();
  check('敵が2体並ぶ', await page.locator('#enemy-row .unit-panel').count() === 2);
  await waitUntil(function (s) { return s === 'input'; });
  await page.keyboard.press('a');
  check('攻撃すると相手を選ぶ案内が出る', await page.locator('#target-prompt').isVisible());
  await page.keyboard.press('Escape');
  check('Esc で選ぶのをやめてコマンドに戻る', await page.locator('#commands').isVisible() && await state() === 'input');
  await page.click('[data-cmd=attack]');
  await page.locator('#enemy-row .unit-panel').nth(1).click(); // B をタップ
  await waitUntil(function (s) { return s !== 'busy'; });
  const hps = await page.evaluate(function () {
    return Game.units.filter(function (u) { return u.side === 'enemy'; }).map(function (u) { return u.hp + '/' + u.stats.hp; });
  });
  check('タップした相手（B）にだけダメージが入る', hps[0] === '18/18' && hps[1] !== '18/18', hps);
  const end = await attackUntilEnd();
  check('森の小道は決着する', end === 'result' || end === 'defeat', end);

  console.log('■ 行動できない敵でも止まらない');
  await open();
  await page.evaluate(function () { DATA.enemies.soldier.actions = []; }); // 行動を1つも持たない試験兵
  await page.click('#btn-sortie');
  await page.locator('.sortie-item').nth(0).click();
  check('行動なしの敵でも勝てる', await attackUntilEnd() === 'result');
  check('敵の手番は「様子を見ている」', (await page.locator('#battle-log').innerText()).indexOf('様子を見ている') >= 0);

  console.log('■ 最初から');
  await page.click('#btn-to-base');
  await page.click('#btn-book');
  await page.click('#btn-reset');
  await open();
  check('データを消すとLv1・未クリアに戻る', await page.evaluate(function () {
    return Game.ch.level === 1 && Game.ch.exp === 0 && Game.ch.cleared.length === 0;
  }));

  check('コンソールにエラー・警告が出ない', errors.length === 0, errors);
  await page.evaluate(function () { localStorage.clear(); });
  await browser.close();

  console.log(failed === 0 ? '\nすべて成功' : '\n失敗: ' + failed + '件');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
