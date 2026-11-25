/*
 * ui.js — 画面の描画（表示のみ。ゲームの状態は main.js が持つ）
 */
(function (root) {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---- 画面切り替え ----
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.toggle('active', el.id === 'screen-' + name);
    });
    $('toast').classList.add('hidden'); // 前の画面のメッセージを持ち越さない
    // 隠れた画面のボタンにフォーカスが残らないようにする
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  // ---- 共通部品 ----
  function bar(kind, label, cur, max) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    return '<div class="bar-row"><span>' + label + '</span>'
      + '<div class="bar ' + kind + '"><span style="width:' + pct + '%"></span></div>'
      + '<span class="bar-value">' + cur + ' / ' + max + '</span></div>';
  }

  let toastTimer = null;
  function toast(message, ms) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, ms || 1600);
  }

  // ---- 拠点 ----
  function renderBase(ch, eff, expToNext) {
    $('base-summary').innerHTML =
      '<div class="lv">Lv ' + ch.level + '</div>'
      + bar('hp', 'HP', ch.hp, eff.hp)
      + bar('mp', 'MP', ch.mp, eff.mp)
      + '<div class="row"><span>経験値</span><span>' + ch.exp + ' / ' + expToNext + '</span></div>'
      + '<div class="row"><span>SP</span><span>' + ch.sp + '</span></div>';
  }

  // ---- 出撃先 ----
  /**
   * items: [{ name, enemiesText, recommendedLv, state:'cleared'|'open'|'locked', lockText }]
   */
  function renderSortie(items, selectedIndex, level) {
    const STATE = { cleared: 'クリア済み', open: '出撃できる', locked: 'ロック中' };
    $('sortie-lv').textContent = 'Lv ' + level;
    $('sortie-body').innerHTML = '<ul class="sortie-list">' + items.map(function (it, i) {
      const cls = ['btn', 'sortie-item', it.state];
      if (i === selectedIndex) cls.push('selected');
      return '<li><button type="button" class="' + cls.join(' ') + '" data-index="' + i + '">'
        + '<span class="sortie-name"><span>' + esc(it.name) + '</span><span class="sortie-meta">推奨 Lv' + it.recommendedLv + '</span></span>'
        + '<span class="sortie-meta">' + (it.state === 'locked' ? esc(it.lockText) : '敵：' + esc(it.enemiesText)) + '</span>'
        + '<span class="sortie-state">' + STATE[it.state] + '</span></button></li>';
    }).join('') + '</ul>';
    const sel = $('sortie-body').querySelector('.selected');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }

  // ---- 戦闘 ----
  // ユニットの配列から描画する。パネルは戦闘開始時に1回だけ作り、以後は中身だけ書き換える
  // （揺れ・消えるアニメーションのクラスを保つため）。

  function panelOf(unitId) {
    return document.querySelector('#battle-field .unit-panel[data-unit-id="' + unitId + '"]');
  }

  function setupBattleUnits(units) {
    const rows = { enemy: $('enemy-row'), ally: $('ally-row') };
    rows.enemy.innerHTML = '';
    rows.ally.innerHTML = '';
    units.forEach(function (u) {
      const el = document.createElement('div');
      el.className = 'unit-panel ' + u.side;
      el.dataset.unitId = u.id;
      rows[u.side === 'enemy' ? 'enemy' : 'ally'].appendChild(el);
    });
  }

  /**
   * opts.targets: 攻撃先として選べるユニットIDの配列（選ばないときは省略）
   * opts.selectedId: いま選んでいる攻撃先
   */
  function renderBattleUnits(units, opts) {
    opts = opts || {};
    const targets = opts.targets || [];
    units.forEach(function (unit) {
      const el = panelOf(unit.id);
      if (!el) return;
      let html = '<div class="unit-name">' + esc(unit.name) + '</div>' + bar('hp', 'HP', unit.hp, unit.stats.hp);
      if (unit.stats.mp > 0) html += bar('mp', 'MP', unit.mp, unit.stats.mp); // 最大MPが0ならMPバーは出さない
      el.innerHTML = html;
      el.classList.toggle('down', unit.hp <= 0 && !el.classList.contains('vanish'));
      el.classList.toggle('targetable', targets.indexOf(unit.id) >= 0);
      el.classList.toggle('selected', targets.indexOf(unit.id) >= 0 && unit.id === opts.selectedId);
    });
  }

  function resetBattleView() {
    $('battle-log').innerHTML = '';
    $('enemy-row').innerHTML = '';
    $('ally-row').innerHTML = '';
    $('defeat-overlay').classList.add('hidden');
    $('action-list').classList.add('hidden');
    $('target-prompt').classList.add('hidden');
    $('commands').classList.remove('hidden');
    $('turn-label').textContent = '';
  }

  function setTurn(turn) {
    $('turn-label').textContent = 'ターン ' + turn;
  }

  /** 戦闘ログに1行追加。最新の行が常に見えるようにスクロールする */
  function log(text, cls) {
    const el = $('battle-log');
    const p = document.createElement('p');
    p.textContent = text;
    if (cls) p.className = cls;
    el.appendChild(p);
    el.scrollTop = el.scrollHeight;
  }

  function playHit(unitId) {
    const el = panelOf(unitId);
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth; // アニメーションを最初から再生
    el.classList.add('hit');
  }

  /** その陣営のパネルを消す（勝利時に敵が消える演出） */
  function vanishSide(side) {
    document.querySelectorAll('#battle-field .unit-panel.' + side).forEach(function (el) { el.classList.add('vanish'); });
  }

  function setCommandsEnabled(enabled) {
    document.querySelectorAll('#commands .btn-cmd, #action-items .action-item, #btn-list-back, #btn-target-back').forEach(function (b) {
      if (!enabled) b.disabled = true;
      else if (!b.dataset.unusable) b.disabled = false;
    });
  }

  /**
   * 魔法／スキルの一覧を表示。
   * items: [{ action, usable, cooldown }]
   */
  function renderActionList(mode, items, selectedIndex) {
    $('action-list-title').textContent = mode === 'magic' ? '魔法' : 'スキル';
    const ul = $('action-items');
    if (items.length === 0) {
      ul.innerHTML = '<li class="action-empty">まだ覚えていません</li>';
    } else {
      ul.innerHTML = items.map(function (it, i) {
        const a = it.action;
        let meta = 'MP ' + a.mpCost;
        if (mode === 'skill' || a.cooldown > 0) {
          meta += it.cooldown > 0 ? ' ・ あと' + it.cooldown + 'ターン' : ' ・ CT' + a.cooldown;
        }
        const cls = ['btn', 'action-item'];
        if (i === selectedIndex) cls.push('selected');
        if (it.cooldown > 0) cls.push('cooling');
        return '<li><button type="button" class="' + cls.join(' ') + '" data-index="' + i + '"'
          + (it.usable ? '' : ' disabled data-unusable="1"') + '>'
          + '<span>' + esc(a.name) + '</span><span class="meta">' + meta + '</span></button></li>';
      }).join('');
    }
    $('commands').classList.add('hidden');
    $('action-list').classList.remove('hidden');
    const sel = ul.querySelector('.selected');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }

  function closeActionList() {
    $('action-list').classList.add('hidden');
    $('commands').classList.remove('hidden');
  }

  /** 攻撃先を選ぶ案内を出す（一覧・コマンドは隠す） */
  function showTargetPrompt(actionName) {
    $('target-title').textContent = actionName + '：相手を選んでください';
    $('commands').classList.add('hidden');
    $('action-list').classList.add('hidden');
    $('target-prompt').classList.remove('hidden');
  }

  function hideTargetPrompt() {
    $('target-prompt').classList.add('hidden');
  }

  function showDefeat(lostExp) {
    $('defeat-detail').textContent = lostExp > 0
      ? 'ためていた経験値 ' + lostExp + ' が 0 になった'
      : '経験値が 0 になった';
    $('defeat-overlay').classList.remove('hidden');
  }

  // ---- 結果画面 ----
  function renderResult(res, ch, eff, data) {
    let html = '';
    if (res.firstClear) {
      html += '<div class="card result-section unlock"><h2>「' + esc(res.encounterName) + '」をクリア！</h2>'
        + (res.unlocked.length > 0
          ? res.unlocked.map(function (e) { return '<div>「' + esc(e.name) + '」に出撃できるようになった</div>'; }).join('')
          : '<div>すべての出撃先をクリアした</div>')
        + '</div>';
    }
    html += '<div class="card result-section"><h2>獲得</h2>'
      + '<div class="kv"><span>経験値</span><span>+' + res.expGained + '</span></div>'
      + '<div class="kv"><span>SP</span><span>+' + res.spGained + '（合計 ' + ch.sp + '）</span></div>'
      + '<div class="kv"><span>今の経験値</span><span>' + ch.exp + ' / ' + res.expToNext + '</span></div></div>';

    res.levelUps.forEach(function (lu) {
      html += '<div class="card result-section levelup"><h2>レベルアップ！ Lv' + lu.from + ' → Lv' + lu.to + '</h2>'
        + '<div class="gain-list">'
        + data.growth.stats.map(function (k) {
          const g = lu.gains[k];
          return '<div class="kv' + (g === 0 ? ' gain-zero' : '') + '"><span>' + data.statLabels[k] + '</span><span>+' + g + '</span></div>';
        }).join('')
        + '</div><div class="kv"><span>合計</span><span>+' + lu.total + '</span></div></div>';
    });

    html += '<div class="card result-section"><h2>現在の状態（Lv ' + ch.level + '）</h2>'
      + bar('hp', 'HP', ch.hp, eff.hp) + bar('mp', 'MP', ch.mp, eff.mp)
      + '<p class="hint">「次の戦闘へ」はHP・MPが回復しません。「拠点に戻る」で全回復します。</p></div>';
    $('result-body').innerHTML = html;
  }

  function setSelectedButton(buttons, index) {
    buttons.forEach(function (b, i) { b.classList.toggle('selected', i === index); });
  }

  // ---- 本（ステータス） ----
  function renderStatus(ch, eff, bonus, expToNext, data) {
    const b = function (k) { return bonus[k] > 0 ? '<span class="bonus">(+' + bonus[k] + ')</span>' : ''; };
    const rows = [
      ['Lv', ch.level],
      ['経験値', ch.exp + ' / ' + expToNext],
      ['HP', ch.hp + ' / ' + eff.hp + b('hp')],
      ['MP', ch.mp + ' / ' + eff.mp + b('mp')],
    ];
    ['atk', 'def', 'matk', 'mdef', 'spd'].forEach(function (k) {
      rows.push([data.statLabels[k], eff[k] + b(k)]);
    });
    rows.push(['SP', ch.sp]);
    rows.push(['スキル獲得数', ch.skills.length]);
    $('status-table').innerHTML = rows.map(function (r) {
      return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>';
    }).join('');
  }

  // ---- スキルツリー ----
  const TYPE_LABEL = { active: 'アクティブスキル', magic: '魔法', heal: '回復魔法', passive: 'パッシブスキル' };
  const TYPE_SHORT = { active: 'アクティブ', magic: '魔法', heal: '回復', passive: 'パッシブ' };
  const STATE_LABEL = { owned: '獲得済み', available: '獲得できる', locked: 'ロック中' };

  function effectText(skill, data) {
    if (skill.type === 'passive') {
      return Object.keys(skill.bonus).map(function (k) {
        return (k === 'hp' || k === 'mp' ? '最大' : '') + data.statLabels[k] + ' +' + skill.bonus[k];
      }).join(' / ');
    }
    let t = skill.type === 'heal'
      ? '回復量 魔法攻撃力×' + skill.power + ' / MP消費 ' + skill.mpCost
      : '威力倍率 ×' + skill.power + ' / MP消費 ' + skill.mpCost;
    if (skill.type === 'active' || skill.cooldown > 0) t += ' / クールタイム ' + (skill.cooldown || 0);
    return t;
  }

  /** states[row][col] は 'owned' | 'available' | 'locked'（main.js が判定して渡す） */
  function renderTree(ch, data, sel, states) {
    $('tree-sp').textContent = 'SP ' + ch.sp;
    $('tree-body').innerHTML = data.skillTree.map(function (branch, r) {
      const nodes = branch.nodes.map(function (node, c) {
        const s = data.skills[node.skill];
        const state = states[r][c];
        const cls = ['node', state];
        if (sel.row === r && sel.col === c) cls.push('selected');
        return '<button type="button" class="' + cls.join(' ') + '" data-row="' + r + '" data-col="' + c + '">'
          + '<span class="node-name">' + esc(s.name) + '</span>'
          + '<span class="node-meta">' + s.rank + 'ランク・' + TYPE_SHORT[s.type] + '</span>'
          + '<span class="node-meta">必要SP ' + s.sp + '</span>'
          + '<span class="node-state">' + STATE_LABEL[state] + '</span></button>';
      });
      return '<div class="branch"><div class="branch-name">' + esc(branch.name) + '</div>'
        + '<div class="branch-nodes">' + nodes.join('<span class="branch-arrow">→</span>') + '</div></div>';
    }).join('');
  }

  function showConfirm(skillId, ch, data) {
    const s = data.skills[skillId];
    $('toast').classList.add('hidden');
    $('confirm-content').innerHTML = '<h2>' + esc(s.name) + '</h2>'
      + '<dl>'
      + '<dt>種類</dt><dd>' + TYPE_LABEL[s.type] + '（' + s.rank + 'ランク）</dd>'
      + '<dt>効果</dt><dd>' + effectText(s, data) + '</dd>'
      + '<dt>必要SP</dt><dd>' + s.sp + '</dd>'
      + '<dt>今のSP</dt><dd>' + ch.sp + ' → ' + (ch.sp - s.sp) + '</dd>'
      + '</dl>';
    $('confirm-overlay').classList.remove('hidden');
  }

  function hideConfirm() {
    $('confirm-overlay').classList.add('hidden');
  }

  root.UI = {
    $: $,
    wait: wait,
    showScreen: showScreen,
    toast: toast,
    renderBase: renderBase,
    renderSortie: renderSortie,
    setupBattleUnits: setupBattleUnits,
    renderBattleUnits: renderBattleUnits,
    resetBattleView: resetBattleView,
    setTurn: setTurn,
    log: log,
    playHit: playHit,
    vanishSide: vanishSide,
    setCommandsEnabled: setCommandsEnabled,
    renderActionList: renderActionList,
    closeActionList: closeActionList,
    showTargetPrompt: showTargetPrompt,
    hideTargetPrompt: hideTargetPrompt,
    showDefeat: showDefeat,
    renderResult: renderResult,
    setSelectedButton: setSelectedButton,
    renderStatus: renderStatus,
    renderTree: renderTree,
    showConfirm: showConfirm,
    hideConfirm: hideConfirm,
  };
})(window);
