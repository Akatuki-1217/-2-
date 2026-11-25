/*
 * main.js — ゲームの状態、入力、画面遷移
 * 計算は battle.js / growth.js に任せ、ここでは流れと入力だけを扱う。
 */
(function () {
  'use strict';

  const D = window.DATA;
  const B = window.Battle;
  const G = window.Growth;

  const game = {
    ch: G.createCharacter(D), // セーブなし：再読み込みで初期状態（Lv1・拠点）
    screen: 'base',
    // 戦闘
    battle: null,
    player: null,
    enemy: null,
    battleToken: 0,
    busy: false, // true の間は戦闘の入力を受け付けない（二重入力防止）
    listMode: null, // 'magic' | 'skill' | null
    listIndex: 0,
    defeatReady: false,
    // 結果画面
    lastResult: null,
    resultIndex: 0, // 0: 次の戦闘へ / 1: 拠点に戻る
    // スキルツリー
    treeSel: { row: 0, col: 0 },
    confirmSkill: null,
    confirmIndex: 0, // 0: 獲得する / 1: やめる
  };
  window.Game = game; // コンソールから状態を確認できるように

  const $ = UI.$;
  const eff = function () { return G.getEffectiveStats(game.ch, D); };

  // ================= 画面遷移 =================

  function goBase() {
    game.screen = 'base';
    UI.renderBase(game.ch, eff(), D);
    UI.showScreen('base');
  }

  function goBook() {
    game.screen = 'book';
    UI.renderStatus(game.ch, eff(), G.getPassiveBonus(game.ch, D), D);
    UI.showScreen('book');
  }

  function goTree() {
    game.screen = 'tree';
    game.confirmSkill = null;
    UI.hideConfirm();
    UI.renderTree(game.ch, D, game.treeSel);
    UI.showScreen('tree');
    focusTreeSelection();
  }

  function goResult() {
    game.screen = 'result';
    game.resultIndex = 0;
    UI.renderResult(game.lastResult, game.ch, eff(), D);
    UI.showScreen('result'); // 先に画面を出す（隠れたボタンにはフォーカスできない）
    renderResultSelection(true);
  }

  // ================= 戦闘 =================

  function startBattle() {
    const ch = game.ch;
    const enemyDef = D.enemies[D.battle.enemyId];
    game.player = B.createUnit({
      id: 'player', name: ch.name, side: 'ally', controller: 'player',
      stats: eff(), hp: ch.hp, mp: ch.mp,
      actions: G.getBattleActions(ch, D),
    });
    game.enemy = B.createUnit({
      id: 'enemy', name: enemyDef.name, side: 'enemy', controller: 'auto',
      stats: enemyDef.stats,
      actions: enemyDef.actions.map(function (id) {
        return id === 'attack' ? Object.assign({}, D.normalAttack) : G.getBattleActions({ skills: [id] }, D)[1];
      }),
    });
    game.enemy.reward = enemyDef.reward;
    game.battle = B.createBattle([game.player, game.enemy], { tieFirstSide: D.battle.tieFirstSide });
    game.battleToken += 1;
    game.busy = true;
    game.listMode = null;
    game.defeatReady = false;

    game.screen = 'battle';
    UI.resetBattleView();
    UI.renderBattleUnits(game.player, game.enemy);
    UI.setCommandsEnabled(false);
    UI.showScreen('battle');
    UI.log(game.enemy.name + 'が現れた！');

    const token = game.battleToken;
    UI.wait(D.timing.battleStart).then(function () { if (token === game.battleToken) advance(); });
  }

  /** 次に行動するユニットを決める。自キャラなら入力待ち、そうでなければ自動行動 */
  function advance() {
    const battle = game.battle;
    if (battle.state.over) return finishBattle();
    const prevTurn = battle.state.turn;
    const actor = battle.current();
    if (battle.state.turn !== prevTurn) {
      UI.setTurn(battle.state.turn);
      UI.log('― ターン' + battle.state.turn + ' ―', 'turn');
    }

    if (actor.controller === 'player') {
      game.busy = false;
      UI.setCommandsEnabled(true);
      return;
    }

    game.busy = true;
    UI.setCommandsEnabled(false);
    const token = game.battleToken;
    UI.wait(D.timing.beforeEnemyAction)
      .then(function () {
        if (token !== game.battleToken) return null;
        return showActionResult(battle.autoAct());
      })
      .then(function () { return UI.wait(D.timing.afterAction); })
      .then(function () { if (token === game.battleToken) advance(); });
  }

  /** 行動結果をログ・モーション・バーに反映 */
  function showActionResult(r) {
    if (!r || !r.ok) return Promise.resolve();
    const actor = game.battle.getUnit(r.actorId);
    const target = game.battle.getUnit(r.targetId);
    UI.log(actor.name + (r.actionType === 'attack' ? 'の攻撃！' : 'の' + r.actionName + '！'));
    if (r.effective) UI.playHit(target.side);
    UI.renderBattleUnits(game.player, game.enemy);
    return UI.wait(D.timing.hitAnimation).then(function () {
      if (r.effective) UI.log(target.name + 'に' + r.damage + 'のダメージ！');
      else UI.log('効かなかった！', 'miss');
      if (r.defeated) {
        UI.log(target.side === 'enemy' ? target.name + 'を倒した！' : target.name + 'は倒れた…', 'ko');
      }
    });
  }

  /** 自キャラの行動 */
  function playerAct(action) {
    if (game.screen !== 'battle' || game.busy || !game.battle || game.battle.state.over) return;
    if (game.battle.current() !== game.player) return;
    if (!B.canUseAction(game.player, action).ok) return;

    game.busy = true; // 次の自分の手番まで入力を受け付けない
    closeList();
    UI.setCommandsEnabled(false);
    const r = game.battle.act(game.player, action, game.enemy);
    if (!r.ok) { game.busy = false; UI.setCommandsEnabled(true); return; }

    const token = game.battleToken;
    showActionResult(r)
      .then(function () { return UI.wait(D.timing.afterAction); })
      .then(function () { if (token === game.battleToken) advance(); });
  }

  function finishBattle() {
    const ch = game.ch;
    ch.hp = game.player.hp;
    ch.mp = game.player.mp;
    game.busy = true;
    UI.setCommandsEnabled(false);
    const token = game.battleToken;

    if (game.battle.state.winner === 'ally') {
      UI.vanish('enemy'); // 敵が消える
      game.lastResult = G.grantReward(ch, game.enemy.reward, D);
      UI.wait(D.timing.victoryToResult).then(function () { if (token === game.battleToken) goResult(); });
    } else {
      const d = G.applyDefeat(ch, D); // 経験値0・HP/MP全回復（Lv・SP・スキルはそのまま）
      UI.showDefeat(d.lostExp);
      UI.wait(D.timing.defeatInputDelay).then(function () { if (token === game.battleToken) game.defeatReady = true; });
    }
  }

  function leaveDefeat() {
    if (!game.defeatReady) return;
    game.defeatReady = false;
    game.battleToken += 1;
    goBase();
  }

  // ---- 魔法／スキル一覧 ----

  function listItems(mode) {
    const type = mode === 'magic' ? 'magic' : 'active';
    return game.player.actions
      .filter(function (a) { return a.type === type; })
      .map(function (a) {
        return { action: a, usable: B.canUseAction(game.player, a).ok, cooldown: B.getCooldown(game.player, a.id) };
      });
  }

  function openList(mode) {
    if (game.busy) return;
    game.listMode = mode;
    const items = listItems(mode);
    const firstUsable = items.findIndex(function (it) { return it.usable; });
    game.listIndex = firstUsable >= 0 ? firstUsable : 0;
    renderList();
  }

  function renderList() {
    UI.renderActionList(game.listMode, listItems(game.listMode), game.listIndex);
    UI.setCommandsEnabled(!game.busy);
    UI.focusSelected($('action-items')); // 選べない項目ならフォーカスなし（Enterは何もしない）
  }

  function closeList() {
    game.listMode = null;
    UI.closeActionList();
  }

  function moveList(delta) {
    const n = listItems(game.listMode).length;
    if (n === 0) return;
    game.listIndex = (game.listIndex + delta + n) % n;
    renderList();
  }

  function useListItem(index) {
    const it = listItems(game.listMode)[index];
    if (it && it.usable) playerAct(it.action);
  }

  // ================= 結果画面 =================

  function resultButtons() {
    return [$('btn-next-battle'), $('btn-to-base')];
  }

  function renderResultSelection(focus) {
    UI.setSelectedButton(resultButtons(), game.resultIndex, focus);
  }

  function nextBattle() {
    if (game.screen !== 'result') return;
    startBattle(); // HP・MPはそのまま
  }

  function backToBaseFromResult() {
    if (game.screen !== 'result') return;
    G.fullHeal(game.ch, D); // 拠点に戻るとHP・MP全回復
    goBase();
  }

  // ================= スキルツリー =================

  function selectNode(row, col) {
    game.treeSel = { row: row, col: col };
    const node = D.skillTree[row].nodes[col];
    const check = G.checkAcquire(game.ch, node.skill, D);
    UI.renderTree(game.ch, D, game.treeSel);
    if (!check.ok) {
      focusTreeSelection();
      UI.toast(check.message, D.timing.toast); // 例外は確認表示を出さずにメッセージ
      return;
    }
    game.confirmSkill = node.skill;
    game.confirmIndex = 0;
    UI.showConfirm(node.skill, game.ch, D);
    renderConfirmSelection(true);
  }

  function confirmButtons() {
    return [$('btn-confirm-ok'), $('btn-confirm-cancel')];
  }

  function renderConfirmSelection(focus) {
    UI.setSelectedButton(confirmButtons(), game.confirmIndex, focus);
  }

  function focusTreeSelection() {
    UI.focusSelected($('tree-body'));
  }

  function confirmAcquire() {
    if (!game.confirmSkill) return;
    const id = game.confirmSkill;
    const r = G.acquireSkill(game.ch, id, D);
    cancelConfirm();
    if (r.ok) UI.toast(D.skills[id].name + 'を獲得した！', D.timing.toast);
    else UI.toast(r.message, D.timing.toast);
    UI.renderTree(game.ch, D, game.treeSel);
    focusTreeSelection();
  }

  function cancelConfirm() {
    game.confirmSkill = null;
    UI.hideConfirm();
    focusTreeSelection();
  }

  function moveTree(dRow, dCol) {
    const tree = D.skillTree;
    let row = (game.treeSel.row + dRow + tree.length) % tree.length;
    const len = tree[row].nodes.length;
    let col = Math.min(game.treeSel.col, len - 1);
    if (dCol) col = (col + dCol + len) % len;
    game.treeSel = { row: row, col: col };
    UI.renderTree(game.ch, D, game.treeSel);
    focusTreeSelection();
  }

  // ================= 入力 =================

  // クリック／タップ
  $('btn-sortie').addEventListener('click', function () { if (game.screen === 'base') startBattle(); });
  $('btn-book').addEventListener('click', function () { if (game.screen === 'base') goBook(); });
  $('btn-book-back').addEventListener('click', function () { if (game.screen === 'book') goBase(); });
  $('btn-open-tree').addEventListener('click', function () { if (game.screen === 'book') goTree(); });
  $('btn-tree-back').addEventListener('click', function () { if (game.screen === 'tree') goBook(); });

  $('commands').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-cmd]');
    if (!btn || btn.disabled) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'attack') playerAct(game.player.actions[0]);
    else openList(cmd);
  });
  $('action-items').addEventListener('click', function (e) {
    const btn = e.target.closest('.action-item');
    if (!btn || btn.disabled) return;
    useListItem(Number(btn.dataset.index));
  });
  $('btn-list-back').addEventListener('click', function () { if (!game.busy) closeList(); });
  $('defeat-overlay').addEventListener('click', leaveDefeat);

  $('btn-next-battle').addEventListener('click', nextBattle);
  $('btn-to-base').addEventListener('click', backToBaseFromResult);

  $('tree-body').addEventListener('click', function (e) {
    const btn = e.target.closest('.node');
    if (!btn || game.confirmSkill) return;
    selectNode(Number(btn.dataset.row), Number(btn.dataset.col));
  });
  $('btn-confirm-ok').addEventListener('click', confirmAcquire);
  $('btn-confirm-cancel').addEventListener('click', cancelConfirm);

  // Tab やクリックでフォーカスが動いたら、キー操作用の選択位置もそこに合わせる
  // （Tabで合わせたボタンと、Enterや矢印キーで扱うボタンがずれないように）
  $('screen-result').addEventListener('focusin', function (e) {
    const i = resultButtons().indexOf(e.target);
    if (i >= 0) { game.resultIndex = i; renderResultSelection(false); }
  });
  $('confirm-overlay').addEventListener('focusin', function (e) {
    const i = confirmButtons().indexOf(e.target);
    if (i >= 0) { game.confirmIndex = i; renderConfirmSelection(false); }
  });
  $('tree-body').addEventListener('focusin', function (e) {
    const btn = e.target.closest('.node');
    if (!btn) return;
    game.treeSel = { row: Number(btn.dataset.row), col: Number(btn.dataset.col) };
    UI.markSelected($('tree-body'), '.node', function (el) { return el === btn; });
  });
  $('action-items').addEventListener('focusin', function (e) {
    const btn = e.target.closest('.action-item');
    if (!btn) return;
    game.listIndex = Number(btn.dataset.index);
    UI.markSelected($('action-items'), '.action-item', function (el) { return el === btn; });
  });

  /**
   * 今の画面（確認表示などの重なりが開いていればその中）でフォーカスされている、押せるボタン。
   * 重なりの後ろにあるボタンは対象外にする。
   */
  function focusedButtonInScope() {
    const el = document.activeElement;
    if (!el || el.tagName !== 'BUTTON' || el.disabled) return null;
    const screen = $('screen-' + game.screen);
    if (!screen) return null;
    const overlay = screen.querySelector('.overlay:not(.hidden)');
    return (overlay || screen).contains(el) ? el : null;
  }

  /** 重なり（確認表示など）が開いている間は、Tab でその中のボタンだけを順に回る */
  function trapFocus(backward) {
    const screen = $('screen-' + game.screen);
    const overlay = screen && screen.querySelector('.overlay:not(.hidden)');
    if (!overlay) return false;
    const buttons = Array.prototype.filter.call(overlay.querySelectorAll('button'), function (b) { return !b.disabled; });
    if (buttons.length === 0) return true; // ボタンのない重なり（敗北表示）では後ろに抜けさせない
    const i = buttons.indexOf(document.activeElement);
    const n = buttons.length;
    const next = i < 0 ? (backward ? n - 1 : 0) : (i + (backward ? -1 : 1) + n) % n;
    buttons[next].focus();
    return true;
  }

  // キーボード（PC）
  const keyHandlers = {
    base: function (k) {
      if (k === 'Enter') { startBattle(); return true; }
      if (k === 'Escape') { goBook(); return true; }
      return false;
    },
    battle: function (k) {
      if (!$('defeat-overlay').classList.contains('hidden')) {
        if (k === 'Enter') { leaveDefeat(); return true; }
        return false;
      }
      const handled = ['a', 'w', 's', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown'].indexOf(k) >= 0;
      if (game.busy) return handled; // 入力ロック中はキーを飲み込むだけ
      if (k === 'a') playerAct(game.player.actions[0]);
      else if (k === 'w') openList('magic');
      else if (k === 's') openList('skill');
      else if (game.listMode) {
        if (k === 'Escape') closeList();
        else if (k === 'ArrowUp') moveList(-1);
        else if (k === 'ArrowDown') moveList(1);
        else if (k === 'Enter') useListItem(game.listIndex);
      }
      return handled;
    },
    result: function (k) {
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        game.resultIndex = 1 - game.resultIndex;
        renderResultSelection(true);
        return true;
      }
      if (k === 'Enter') {
        if (game.resultIndex === 0) nextBattle();
        else backToBaseFromResult();
        return true;
      }
      return false;
    },
    book: function (k) {
      if (k === 'Escape') { goBase(); return true; }
      if (k === 'Enter') { goTree(); return true; }
      return false;
    },
    tree: function (k) {
      if (game.confirmSkill) {
        if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
          game.confirmIndex = 1 - game.confirmIndex;
          renderConfirmSelection(true);
          return true;
        }
        if (k === 'Enter') {
          if (game.confirmIndex === 0) confirmAcquire();
          else cancelConfirm();
          return true;
        }
        if (k === 'Escape') { cancelConfirm(); return true; }
        return false;
      }
      if (k === 'ArrowUp') { moveTree(-1, 0); return true; }
      if (k === 'ArrowDown') { moveTree(1, 0); return true; }
      if (k === 'ArrowLeft') { moveTree(0, -1); return true; }
      if (k === 'ArrowRight') { moveTree(0, 1); return true; }
      if (k === 'Enter') { selectNode(game.treeSel.row, game.treeSel.col); return true; }
      if (k === 'Escape') { goBook(); return true; }
      return false;
    },
  };

  // A/W/S は物理キーの位置（e.code）で判定する。日本語入力ONのときは e.key が 'Process' や
  // かな文字になり一致しないため
  const CODE_KEYS = { KeyA: 'a', KeyW: 'w', KeyS: 's' };

  function keyName(e) {
    if (CODE_KEYS[e.code]) return CODE_KEYS[e.code];
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
  }

  document.addEventListener('keydown', function (e) {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = keyName(e);
    const isArrow = k.indexOf('Arrow') === 0;
    if (e.repeat && !isArrow) { // 押しっぱなしによる連続入力は無視
      if (k === 'Enter' || k === 'Escape' || k === 'a' || k === 'w' || k === 's') e.preventDefault();
      return;
    }
    if (k === 'Tab' && trapFocus(e.shiftKey)) { e.preventDefault(); return; }
    if (k === 'Enter' || k === ' ') {
      // フォーカス中のボタンがあれば、ブラウザ標準どおりそのボタンを押させる（Tabで選んだものを優先）
      if (focusedButtonInScope()) return;
      // 重なりの後ろのボタンが Space で押されないようにする
      if (k === ' ' && document.activeElement && document.activeElement.tagName === 'BUTTON') {
        e.preventDefault();
        return;
      }
    }
    const handler = keyHandlers[game.screen];
    // preventDefault で、フォーカス中のボタンがEnterで二重に押されるのを防ぐ
    if (handler && handler(k)) e.preventDefault();
  });

  // ================= データ検証（第7章の範囲外なら警告） =================

  function validateData() {
    const inRange = function (v, r) { return v >= r[0] && v <= r[1]; };
    Object.keys(D.skills).forEach(function (id) {
      const s = D.skills[id];
      const rank = D.ranks[s.rank];
      const warn = function (msg) { console.warn('[data.js] ' + s.name + '（' + s.rank + '）: ' + msg); };
      if (!rank) { warn('ランクが定義されていません'); return; }
      if (s.sp !== rank.sp) warn('必要SP ' + s.sp + ' がランク表（' + rank.sp + '）と違います');
      if (s.type === 'passive') {
        Object.keys(s.bonus || {}).forEach(function (k) {
          if (s.bonus[k] !== rank.passive) warn('上昇量 ' + s.bonus[k] + ' がランク表（+' + rank.passive + '）と違います');
        });
        return;
      }
      if (!inRange(s.power, rank.power)) warn('威力倍率 ' + s.power + ' が範囲外です');
      if (!inRange(s.mpCost, rank.mpCost)) warn('MP消費 ' + s.mpCost + ' が範囲外です');
      if (s.type === 'active' && !inRange(s.cooldown || 0, rank.cooldown)) warn('クールタイム ' + s.cooldown + ' が範囲外です');
    });
  }

  validateData();
  goBase();
})();
