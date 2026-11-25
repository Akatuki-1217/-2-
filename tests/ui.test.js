/*
 * 画面操作のテスト（ブラウザで index.html を開いて、実際にクリック・キー入力する）
 * 実行: node tests/ui.test.js
 * 主に第12章の完了条件（連打しても1回、連戦で3戦目は負け、スマホ・PCで1サイクルなど）を確かめる。
 * Playwright が必要（npm install playwright && npx playwright install chromium）。
 * 入っていないときはテストを飛ばして終了コード0で終わる。
 */
'use strict';

const path = require('path');

let chromium, devices;
try {
  chromium = require('playwright').chromium;
  devices = require('playwright').devices;
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
  const errors = [];
  let page;

  /** 新しいブラウザ環境で開く。contextOpts で端末を指定する */
  async function usePage(contextOpts) {
    const ctx = await browser.newContext(contextOpts);
    page = await ctx.newPage();
    page.on('pageerror', function (e) { errors.push(String(e)); });
    page.on('console', function (m) { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  }

  /**
   * スマホでの見た目の確認：横にはみ出さない・ボタンは高さ44px以上・下のボタンが画面内・キー案内は出さない。
   * 問題の一覧を返す（なければ空配列）。
   */
  function auditMobile() {
    return page.evaluate(function () {
      const problems = [];
      const scr = document.querySelector('.screen.active');
      if (document.documentElement.scrollWidth > window.innerWidth || scr.scrollWidth > scr.clientWidth) problems.push('横にはみ出している');
      scr.querySelectorAll('button, .unit-panel.targetable').forEach(function (b) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return; // 隠れている
        if (r.height < 44) problems.push((b.id || b.className) + ' の高さ ' + Math.round(r.height) + 'px');
        if (r.right > window.innerWidth + 0.5 || r.left < -0.5) problems.push((b.id || b.className) + ' が画面外');
      });
      const bottom = scr.querySelector('.bottom-actions, .command-area');
      if (bottom) {
        const r = bottom.getBoundingClientRect();
        if (r.bottom > window.innerHeight + 1) problems.push('下のボタンが画面からはみ出している');
      }
      if (Array.prototype.some.call(scr.querySelectorAll('.key'), function (k) { return getComputedStyle(k).display !== 'none'; })) {
        problems.push('スマホでキー案内が出ている');
      }
      return problems.map(function (p) { return Game.screen + ': ' + p; });
    });
  }

  await usePage({ viewport: { width: 375, height: 700 } });

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

  const playerLogCount = function () {
    return page.evaluate(function () {
      return Array.prototype.filter.call(document.querySelectorAll('#battle-log p'), function (p) { return p.textContent.indexOf('主人公の') === 0; }).length;
    });
  };

  await open();

  console.log('■ 戦闘（1対1）');
  check('最初は拠点', await state() === 'base');
  await page.keyboard.press('Enter');
  check('Enter で出撃し、敵は試験兵1体', await state() !== 'base' && await page.locator('#enemy-row .unit-panel').count() === 1);
  await waitUntil(function (s) { return s === 'input'; });
  await page.click('[data-cmd=skill]');
  check('スキル未獲得なら「まだ覚えていません」', (await page.locator('#action-items').innerText()).indexOf('まだ覚えていません') >= 0);
  await page.keyboard.press('Escape');
  check('Esc で一覧を閉じる', await page.locator('#commands').isVisible());
  // 連打しても1回しか行動しない
  const before = await playerLogCount();
  await page.click('[data-cmd=attack]');
  for (let i = 0; i < 5; i++) { await page.click('[data-cmd=attack]', { force: true }); await page.keyboard.press('a'); }
  await waitUntil(function (s) { return s !== 'busy'; });
  check('演出中に連打しても行動は1回だけ', await playerLogCount() === before + 1, await playerLogCount() - before);
  check('敵が1体なら攻撃先を選ばずに攻撃する', !(await page.locator('#target-prompt').isVisible()));
  check('通常攻撃だけで勝って結果画面へ', await attackUntilEnd() === 'result');
  check('5ターン目に勝ち、残りHPは30', await page.evaluate(function () { return Game.battle.state.turn === 5 && Game.ch.hp === 30; }));

  console.log('■ 連戦と敗北');
  await page.click('#btn-next-battle');
  check('2戦目も勝つ（HP回復なし）', await attackUntilEnd() === 'result' && await page.evaluate(function () { return Game.ch.hp === 10; }));
  await page.keyboard.press('Enter'); // 次の戦闘へ（最初から選ばれている）
  check('回復せず3戦目は負ける', await attackUntilEnd() === 'defeat');
  await page.waitForTimeout(50);
  await page.keyboard.press('Enter');
  check('敗北表示から Enter で拠点へ', await state() === 'base');
  check('経験値0・SPはそのまま・HP全回復', await page.evaluate(function () {
    return Game.ch.exp === 0 && Game.ch.sp === 2 && Game.ch.hp === 50 && Game.ch.mp === 20;
  }));

  console.log('■ 再読み込み（セーブなし）');
  await open();
  check('再読み込みすると Lv1・拠点に戻る', await state() === 'base' && await page.evaluate(function () {
    return Game.ch.level === 1 && Game.ch.sp === 0 && Game.ch.exp === 0;
  }));

  console.log('■ 攻撃先の選択（敵が2体のときの作り。テスト用に data.js を書き換えて確認）');
  await open();
  await page.evaluate(function () { DATA.battle.enemies = ['soldier', 'soldier']; });
  await page.click('#btn-sortie');
  check('敵が2体並び、名前に A・B が付く', await page.locator('#enemy-row .unit-panel').count() === 2
    && (await page.locator('#enemy-row').innerText()).indexOf('試験兵B') >= 0);
  await waitUntil(function (s) { return s === 'input'; });
  await page.keyboard.press('a');
  check('攻撃すると相手を選ぶ案内が出る', await page.locator('#target-prompt').isVisible());
  await page.keyboard.press('Escape');
  check('Esc で選ぶのをやめてコマンドに戻る', await page.locator('#commands').isVisible() && await state() === 'input');
  await page.click('[data-cmd=attack]');
  await page.locator('#enemy-row .unit-panel').nth(1).click(); // B をタップ
  await waitUntil(function (s) { return s !== 'busy'; });
  const hps = await page.evaluate(function () {
    return Game.units.filter(function (u) { return u.side === 'enemy'; }).map(function (u) { return u.hp; });
  });
  check('タップした相手（B）にだけダメージが入る', hps[0] === 30 && hps[1] === 24, hps);

  console.log('■ 行動できない敵でも止まらない');
  await open();
  await page.evaluate(function () { DATA.enemies.soldier.actions = []; }); // 行動を1つも持たない試験兵
  await page.click('#btn-sortie');
  check('行動なしの敵でも勝てる', await attackUntilEnd() === 'result');
  check('敵の手番は「様子を見ている」', (await page.locator('#battle-log').innerText()).indexOf('様子を見ている') >= 0);

  console.log('■ スマホ（タップだけ）で「出撃→戦闘→結果→拠点→スキル獲得」');
  await usePage(devices['iPhone SE']); // 320×568・タッチ操作
  await open();
  const layout = [];
  layout.push.apply(layout, await auditMobile());
  await page.tap('#btn-sortie');
  await waitUntil(function (s) { return s === 'input'; });
  layout.push.apply(layout, await auditMobile());
  await page.tap('[data-cmd=magic]');
  layout.push.apply(layout, await auditMobile());
  await page.tap('#btn-list-back');
  let ms;
  while ((ms = await waitUntil(function (s) { return s !== 'busy'; })) === 'input') await page.tap('[data-cmd=attack]');
  check('タップだけで勝って結果画面へ', ms === 'result', ms);
  layout.push.apply(layout, await auditMobile());
  await page.tap('#btn-to-base');
  await page.tap('#btn-book');
  layout.push.apply(layout, await auditMobile());
  await page.tap('#btn-open-tree');
  check('本からスキルツリーを開ける', await state() === 'tree' && await page.locator('.node').count() > 0);
  layout.push.apply(layout, await auditMobile());
  await page.locator('.node').nth(0).tap(); // 強打（SP1）
  layout.push.apply(layout, await auditMobile());
  await page.tap('#btn-confirm-ok');
  check('タップでスキルを獲得できる', await page.evaluate(function () { return Game.ch.skills.indexOf('power_strike') >= 0; }));
  await page.tap('#btn-tree-back');
  await page.tap('#btn-book-back');
  check('タップで拠点まで戻れる', await state() === 'base');
  check('幅320pxでもはみ出さず、ボタンは44px以上、下のボタンが画面内', layout.length === 0, layout);

  console.log('■ PC（キーボードだけ）で「出撃→戦闘→結果→拠点→スキル獲得」');
  await usePage({ viewport: { width: 1280, height: 800 } });
  await open();
  await page.keyboard.press('Enter'); // 出撃
  check('キーボードだけで勝って結果画面へ', await attackUntilEnd() === 'result');
  await page.keyboard.press('ArrowRight'); // 拠点に戻る を選ぶ
  await page.keyboard.press('Enter');
  check('矢印＋Enterで拠点に戻る', await state() === 'base');
  await page.keyboard.press('Escape'); // 本
  await page.keyboard.press('Enter'); // スキルツリー
  check('Esc→Enterでスキルツリー', await state() === 'tree');
  await page.keyboard.press('Enter'); // 強打を選ぶ
  await page.keyboard.press('Enter'); // 獲得する
  check('Enterでスキルを獲得できる', await page.evaluate(function () { return Game.ch.skills.indexOf('power_strike') >= 0; }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  check('Esc→Escで拠点に戻る', await state() === 'base');
  check('PCではキー案内が出る', await page.locator('#btn-sortie .key').isVisible());

  check('コンソールにエラー・警告が出ない', errors.length === 0, errors);
  await browser.close();

  console.log(failed === 0 ? '\nすべて成功' : '\n失敗: ' + failed + '件');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
