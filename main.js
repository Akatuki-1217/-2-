/*
 * main.js — ゲームの状態、入力、画面遷移
 * 計算は battle.js / growth.js に任せ、ここでは流れと入力だけを扱う。
 */
(function () {
  'use strict';

  const D = window.DATA;
  const B = window.Battle;
  const G = window.Growth;

  // ================= セーブ（ブラウザの localStorage） =================
  // 保存できない環境（プライベートブラウズなど）でも遊べるよう、失敗は無視する

  const SAVE_KEY = 'srpg-save-v1';

  function loadCharacter() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      const ch = raw ? G.deserialize(JSON.parse(raw), D) : null;
      if (ch) return ch;
    } catch (e) { /* 読めなければ最初から */ }
    return G.createCharacter(D);
  }

  function save() {
    try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(G.serialize(game.ch))); } catch (e) { /* 保存できなくても続ける */ }
  }

  function clearSave() {
    try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* 何もしない */ }
  }

  const game = {
    ch: loadCharacter(), // 保存データがあれば続きから（拠点・HP/MP全回復で再開）
    screen: 'base',
    // 戦闘
    battle: null,
    units: [], // 戦闘に出ているユニット（味方・敵）
    player: null,
    enemyIds: [], // 今の戦闘の敵（data.js の enemies のキー）
    encounterId: null, // 今の出撃先
    sortieIndex: 0, // 出撃先の一覧で選んでいる行
    battleToken: 0,
    busy: false, // true の間は戦闘の入力を受け付けない（二重入力防止）
    listMode: null, // 'magic' | 'skill' | null
    listIndex: 0,
    lastListMode: null, // 攻撃先の選択をやめたときに戻る一覧
    targeting: null, // 攻撃先を選んでいる間 { action, ids, index, fromList }
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
    UI.renderBase(game.ch, eff(), G.expToNext(game.ch.level, D.growth));
    UI.showScreen('base');
  }

  function sortieItems() {
    return D.encounters.map(function (enc) {
      const req = enc.requires && G.findEncounter(enc.requires, D);
      return {
        name: enc.name,
        recommendedLv: enc.recommendedLv,
        enemiesText: enemiesText(enc.enemies),
        state: G.getEncounterState(game.ch, enc),
        lockText: req ? '「' + req.name + '」をクリアすると解放' : '',
      };
    });
  }

  /** 敵の並びを「斥候兵 ×2・見習い僧」のような文字にする */
  function enemiesText(ids) {
    const order = [];
    const count = {};
    ids.forEach(function (id) {
      if (!count[id]) order.push(id);
      count[id] = (count[id] || 0) + 1;
    });
    return order.map(function (id) { return D.enemies[id].name + (count[id] > 1 ? ' ×' + count[id] : ''); }).join('・');
  }

  function goSortie() {
    game.screen = 'sortie';
    // 最初は「まだクリアしていない、行ける出撃先」のうち一番上を選んでおく
    const items = sortieItems();
    const next = items.findIndex(function (it) { return it.state === 'open'; });
    game.sortieIndex = next >= 0 ? next : 0;
    renderSortie();
    UI.showScreen('sortie');
  }

  function renderSortie() {
    UI.renderSortie(sortieItems(), game.sortieIndex, game.ch.level);
  }

  function moveSortie(delta) {
    const n = D.encounters.length;
    game.sortieIndex = (game.sortieIndex + delta + n) % n;
    renderSortie();
  }

  function chooseSortie(index) {
    const enc = D.encounters[index];
    if (!enc || game.screen !== 'sortie') return;
    if (G.getEncounterState(game.ch, enc) === 'locked') {
      UI.toast(sortieItems()[index].lockText, D.timing.toast);
      return;
    }
    startEncounter(enc);
  }

  function startEncounter(enc) {
    game.encounterId = enc.id;
    startBattle(enc.enemies);
  }

  function goBook() {
    game.screen = 'book';
    UI.renderStatus(game.ch, eff(), G.getPassiveBonus(game.ch, D), G.expToNext(game.ch.level, D.growth), D);
    UI.showScreen('book');
  }

  function goTree() {
    game.screen = 'tree';
    game.confirmSkill = null;
    UI.hideConfirm();
    UI.renderTree(game.ch, D, game.treeSel, nodeStates());
    UI.showScreen('tree');
  }

  function goResult() {
    game.screen = 'result';
    game.resultIndex = 0;
    UI.renderResult(game.lastResult, game.ch, eff(), D);
    renderResultSelection();
    UI.showScreen('result');
  }

  // ================= 戦闘 =================

  /** 敵IDの配列から敵ユニットを作る。同じ敵が複数いるときは名前に A・B… を付ける */
  function createEnemyUnits(enemyIds) {
    const count = {};
    enemyIds.forEach(function (id) { count[id] = (count[id] || 0) + 1; });
    const seen = {};
    return enemyIds.map(function (id, i) {
      const def = D.enemies[id];
      seen[id] = (seen[id] || 0) + 1;
      const suffix = count[id] > 1 ? String.fromCharCode(64 + seen[id]) : ''; // A, B, C…
      const unit = B.createUnit({
        id: 'enemy-' + i, name: def.name + suffix, side: 'enemy', controller: 'auto',
        stats: def.stats, actions: G.toActions(def.actions, D),
      });
      unit.enemyId = id;
      return unit;
    });
  }

  const enemies = function () { return game.units.filter(function (u) { return u.side === 'enemy'; }); };
  const aliveEnemies = function () { return enemies().filter(function (u) { return u.hp > 0; }); };

  function renderUnits() {
    const t = game.targeting;
    UI.renderBattleUnits(game.units, t ? { targets: t.ids, selectedId: t.ids[t.index] } : null);
  }

  function startBattle(enemyIds) {
    const ch = game.ch;
    game.enemyIds = enemyIds;
    game.player = B.createUnit({
      id: 'player', name: ch.name, side: 'ally', controller: 'player',
      stats: eff(), hp: ch.hp, mp: ch.mp,
      actions: G.getBattleActions(ch, D),
    });
    game.units = [game.player].concat(createEnemyUnits(enemyIds));
    game.battle = B.createBattle(game.units, { tieFirstSide: D.battle.tieFirstSide, healBelow: D.battle.aiHealBelow });
    game.battleToken += 1;
    game.busy = true;
    game.listMode = null;
    game.targeting = null;
    game.defeatReady = false;

    game.screen = 'battle';
    UI.resetBattleView();
    UI.setupBattleUnits(game.units);
    renderUnits();
    UI.setCommandsEnabled(false);
    UI.showScreen('battle');
    UI.log(enemies().map(function (u) { return u.name; }).join('・') + 'が現れた！');

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
        let r = battle.autoAct();
        // 抜け道：万一失敗しても「様子を見る」でターンを進め、同じ手番で止まり続けないようにする
        if (!r.ok && !battle.state.over) r = battle.pass(actor);
        return showActionResult(r);
      })
      .then(function () { return UI.wait(D.timing.afterAction); })
      .then(function () { if (token === game.battleToken) advance(); });
  }

  /** 行動結果をログ・モーション・バーに反映 */
  function showActionResult(r) {
    if (!r || !r.ok) return Promise.resolve();
    const actor = game.battle.getUnit(r.actorId);
    if (r.actionType === 'wait') {
      UI.log(actor.name + 'は様子を見ている…', 'miss');
      return UI.wait(D.timing.hitAnimation);
    }
    const target = game.battle.getUnit(r.targetId);
    UI.log(actor.name + (r.actionType === 'attack' ? 'の攻撃！' : 'の' + r.actionName + '！'));
    if (r.actionType === 'heal') {
      renderUnits();
      return UI.wait(D.timing.hitAnimation).then(function () {
        if (r.heal > 0) UI.log(target.name + 'のHPが' + r.heal + '回復した！');
        else UI.log('しかし何も起きなかった', 'miss');
      });
    }
    if (r.effective) UI.playHit(target.id);
    renderUnits();
    return UI.wait(D.timing.hitAnimation).then(function () {
      if (r.effective) UI.log(target.name + 'に' + r.damage + 'のダメージ！');
      else UI.log('効かなかった！', 'miss');
      if (r.defeated) {
        UI.log(target.side === 'enemy' ? target.name + 'を倒した！' : target.name + 'は倒れた…', 'ko');
      }
    });
  }

  /** 自キャラの手番で入力を受け付けてよいか */
  function canInput() {
    return game.screen === 'battle' && !game.busy && game.battle && !game.battle.state.over
      && game.battle.current() === game.player;
  }

  /**
   * 行動を選んだ。相手が1体ならそのまま実行し、複数なら攻撃先を選ぶ。
   * 回復は味方に使う（今は自キャラだけなので自分に使う）。
   */
  function chooseAction(action) {
    if (!canInput() || !action || !B.canUseAction(game.player, action).ok) return;
    const targets = B.isOffensive(action)
      ? aliveEnemies()
      : game.units.filter(function (u) { return u.side === game.player.side && u.hp > 0; });
    if (targets.length === 1) return playerAct(action, targets[0]);
    startTargeting(action, targets);
  }

  /** 自キャラの行動 */
  function playerAct(action, target) {
    if (!canInput() || !B.canUseAction(game.player, action).ok) return;

    game.busy = true; // 次の自分の手番まで入力を受け付けない
    closeList();
    endTargeting();
    UI.setCommandsEnabled(false);
    const r = game.battle.act(game.player, action, target);
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
      UI.vanishSide('enemy'); // 敵が消える
      const res = G.grantReward(ch, G.sumRewards(game.enemyIds, D), D);
      const enc = G.findEncounter(game.encounterId, D);
      if (enc) {
        const c = G.markCleared(ch, enc.id, D);
        res.firstClear = c.firstClear;
        res.unlocked = c.unlocked;
        res.encounterName = enc.name;
      }
      game.lastResult = res;
      save();
      UI.wait(D.timing.victoryToResult).then(function () { if (token === game.battleToken) goResult(); });
    } else {
      const d = G.applyDefeat(ch, D); // 経験値0・HP/MP全回復（Lv・SP・スキルはそのまま）
      save();
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

  // ---- 攻撃先の選択 ----

  function startTargeting(action, targets) {
    closeList();
    game.targeting = { action: action, ids: targets.map(function (u) { return u.id; }), index: 0, fromList: game.lastListMode };
    UI.showTargetPrompt(action.name);
    renderUnits();
  }

  function endTargeting() {
    if (!game.targeting) return;
    game.targeting = null;
    UI.hideTargetPrompt();
    renderUnits();
  }

  /** 攻撃先の選択をやめて、選ぶ前の画面（一覧かコマンド）に戻る */
  function cancelTargeting() {
    const from = game.targeting && game.targeting.fromList;
    endTargeting();
    if (from) openList(from);
    else UI.closeActionList();
  }

  function moveTarget(delta) {
    const t = game.targeting;
    t.index = (t.index + delta + t.ids.length) % t.ids.length;
    renderUnits();
  }

  function confirmTarget(unitId) {
    const t = game.targeting;
    if (!t || game.busy) return;
    const id = unitId || t.ids[t.index];
    if (t.ids.indexOf(id) < 0) return;
    playerAct(t.action, game.battle.getUnit(id));
  }

  // ---- 魔法／スキル一覧 ----

  // 一覧の種類と、そこに並ぶ行動の種類
  const LIST_TYPES = { magic: ['magic', 'heal'], skill: ['active'] };

  function listItems(mode) {
    const types = LIST_TYPES[mode] || [];
    return game.player.actions
      .filter(function (a) { return types.indexOf(a.type) >= 0; })
      .map(function (a) {
        return { action: a, usable: B.canUseAction(game.player, a).ok, cooldown: B.getCooldown(game.player, a.id) };
      });
  }

  function openList(mode) {
    if (game.busy) return;
    endTargeting();
    game.listMode = mode;
    game.lastListMode = mode;
    const items = listItems(mode);
    const firstUsable = items.findIndex(function (it) { return it.usable; });
    game.listIndex = firstUsable >= 0 ? firstUsable : 0;
    renderList();
  }

  function renderList() {
    UI.renderActionList(game.listMode, listItems(game.listMode), game.listIndex);
    UI.setCommandsEnabled(!game.busy);
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
    if (it && it.usable) chooseAction(it.action);
  }

  function chooseAttack() {
    game.lastListMode = null;
    chooseAction(B.findAction(game.player, D.normalAttack.id));
  }

  /** スキルツリーの各ノードの表示状態（UIに渡す） */
  function nodeStates() {
    return D.skillTree.map(function (branch) {
      return branch.nodes.map(function (node) { return G.getNodeState(game.ch, node.skill, D); });
    });
  }

  // ================= 結果画面 =================

  function resultButtons() {
    return [$('btn-next-battle'), $('btn-to-base')];
  }

  function renderResultSelection() {
    UI.setSelectedButton(resultButtons(), game.resultIndex);
  }

  function nextBattle() {
    if (game.screen !== 'result') return;
    startBattle(game.enemyIds); // 同じ出撃先でもう一度。HP・MPはそのまま
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
    UI.renderTree(game.ch, D, game.treeSel, nodeStates());
    if (!check.ok) {
      UI.toast(check.message, D.timing.toast); // 例外は確認表示を出さずにメッセージ
      return;
    }
    game.confirmSkill = node.skill;
    game.confirmIndex = 0;
    UI.showConfirm(node.skill, game.ch, D);
    renderConfirmSelection();
  }

  function renderConfirmSelection() {
    UI.setSelectedButton([$('btn-confirm-ok'), $('btn-confirm-cancel')], game.confirmIndex);
  }

  function confirmAcquire() {
    if (!game.confirmSkill) return;
    const id = game.confirmSkill;
    const r = G.acquireSkill(game.ch, id, D);
    if (r.ok) save();
    cancelConfirm();
    if (r.ok) UI.toast(D.skills[id].name + 'を獲得した！', D.timing.toast);
    else UI.toast(r.message, D.timing.toast);
    UI.renderTree(game.ch, D, game.treeSel, nodeStates());
  }

  function cancelConfirm() {
    game.confirmSkill = null;
    UI.hideConfirm();
  }

  function moveTree(dRow, dCol) {
    const tree = D.skillTree;
    let row = (game.treeSel.row + dRow + tree.length) % tree.length;
    const len = tree[row].nodes.length;
    let col = Math.min(game.treeSel.col, len - 1);
    if (dCol) col = (col + dCol + len) % len;
    game.treeSel = { row: row, col: col };
    UI.renderTree(game.ch, D, game.treeSel, nodeStates());
  }

  // ================= 入力 =================

  // クリック／タップ
  $('btn-sortie').addEventListener('click', function () { if (game.screen === 'base') goSortie(); });
  $('btn-sortie-back').addEventListener('click', function () { if (game.screen === 'sortie') goBase(); });
  $('sortie-body').addEventListener('click', function (e) {
    const btn = e.target.closest('.sortie-item');
    if (!btn) return;
    game.sortieIndex = Number(btn.dataset.index);
    renderSortie();
    chooseSortie(game.sortieIndex);
  });
  $('btn-book').addEventListener('click', function () { if (game.screen === 'base') goBook(); });
  $('btn-book-back').addEventListener('click', function () { if (game.screen === 'book') goBase(); });
  $('btn-open-tree').addEventListener('click', function () { if (game.screen === 'book') goTree(); });
  $('btn-reset').addEventListener('click', function () {
    if (game.screen !== 'book') return;
    if (!window.confirm('セーブデータを消して、Lv1から始め直しますか？')) return;
    clearSave();
    game.ch = G.createCharacter(D);
    UI.toast('最初からになりました', D.timing.toast);
    goBook();
  });
  $('btn-tree-back').addEventListener('click', function () { if (game.screen === 'tree') goBook(); });

  $('commands').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-cmd]');
    if (!btn || btn.disabled) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'attack') chooseAttack();
    else openList(cmd);
  });
  $('battle-field').addEventListener('click', function (e) {
    const panel = e.target.closest('.unit-panel.targetable');
    if (panel) confirmTarget(panel.dataset.unitId);
  });
  $('btn-target-back').addEventListener('click', function () { if (!game.busy) cancelTargeting(); });
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

  // キーボード（PC）
  const keyHandlers = {
    base: function (k) {
      if (k === 'Enter') { goSortie(); return true; }
      if (k === 'Escape') { goBook(); return true; }
      return false;
    },
    sortie: function (k) {
      if (k === 'ArrowUp') { moveSortie(-1); return true; }
      if (k === 'ArrowDown') { moveSortie(1); return true; }
      if (k === 'Enter') { chooseSortie(game.sortieIndex); return true; }
      if (k === 'Escape') { goBase(); return true; }
      return false;
    },
    battle: function (k) {
      if (!$('defeat-overlay').classList.contains('hidden')) {
        if (k === 'Enter') { leaveDefeat(); return true; }
        return false;
      }
      const handled = ['a', 'w', 's', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(k) >= 0;
      if (game.busy) return handled; // 入力ロック中はキーを飲み込むだけ
      if (game.targeting) {
        if (k === 'Escape') cancelTargeting();
        else if (k === 'ArrowLeft' || k === 'ArrowUp') moveTarget(-1);
        else if (k === 'ArrowRight' || k === 'ArrowDown') moveTarget(1);
        else if (k === 'Enter') confirmTarget();
        else if (k === 'a') chooseAttack();
        else if (k === 'w') openList('magic');
        else if (k === 's') openList('skill');
        return handled;
      }
      if (k === 'a') chooseAttack();
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
        renderResultSelection();
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
          renderConfirmSelection();
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

  document.addEventListener('keydown', function (e) {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const isArrow = k.indexOf('Arrow') === 0;
    if (e.repeat && !isArrow) { // 押しっぱなしによる連続入力は無視
      if (k === 'Enter' || k === 'Escape' || k === 'a' || k === 'w' || k === 's') e.preventDefault();
      return;
    }
    const handler = keyHandlers[game.screen];
    // preventDefault で、フォーカス中のボタンがEnterで二重に押されるのを防ぐ
    if (handler && handler(k)) e.preventDefault();
  });

  // data.js の検証（第7章のランク表から外れた値などを警告）
  G.validateData(D).forEach(function (w) { console.warn('[data.js] ' + w); });
  goBase();
})();
