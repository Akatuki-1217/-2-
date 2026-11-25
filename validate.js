/*
 * validate.js — data.js の中身の検査（DOM非依存）
 * 第7章のランク表から外れた値や、存在しないスキルへの参照を見つけて、警告の文字列を返す。
 * ゲームは止めない（暫定値を試すこともあるため）。画面側はコンソールに出すだけ。
 */
(function (root) {
  'use strict';

  function inRange(v, r) {
    return typeof v === 'number' && v >= r[0] && v <= r[1];
  }

  /** 魔法・スキルの値が第7章のランク表に入っているか */
  function checkSkills(data, warn) {
    Object.keys(data.skills).forEach(function (id) {
      const s = data.skills[id];
      const w = function (msg) { warn(s.name + '（' + s.rank + '）: ' + msg); };
      const rank = data.ranks[s.rank];
      if (!rank) { w('ランクが定義されていません'); return; }
      if (s.sp !== rank.sp) w('必要SP ' + s.sp + ' がランク表（' + rank.sp + '）と違います');
      if (s.type === 'passive') {
        Object.keys(s.bonus || {}).forEach(function (k) {
          if (data.statKeys.indexOf(k) < 0) w('上昇する能力値 ' + k + ' がありません');
          if (s.bonus[k] !== rank.passive) w('上昇量 ' + s.bonus[k] + ' がランク表（+' + rank.passive + '）と違います');
        });
        return;
      }
      if (s.type !== 'active' && s.type !== 'magic') { w('種類 ' + s.type + ' が不明です'); return; }
      if (!inRange(s.power, rank.power)) w('威力倍率 ' + s.power + ' が範囲外です');
      if (!inRange(s.mpCost, rank.mpCost)) w('MP消費 ' + s.mpCost + ' が範囲外です');
      if (s.type === 'active' && !inRange(s.cooldown || 0, rank.cooldown)) w('クールタイム ' + s.cooldown + ' が範囲外です');
      if (s.type === 'magic' && (s.cooldown || 0) > 0) w('魔法のクールタイムは暫定で「なし」です（第7章）');
    });
  }

  /** スキルツリー・初期スキル・敵の行動が、定義済みのスキルを指しているか */
  function checkReferences(data, warn) {
    const inTree = {};
    data.skillTree.forEach(function (branch) {
      branch.nodes.forEach(function (node) {
        if (!data.skills[node.skill]) warn('スキルツリー「' + branch.name + '」: スキル ' + node.skill + ' が skills にありません');
        if (inTree[node.skill]) warn('スキルツリー: ' + node.skill + ' が2か所にあります');
        inTree[node.skill] = true;
      });
    });
    data.skillTree.forEach(function (branch) {
      branch.nodes.forEach(function (node) {
        if (node.requires && !inTree[node.requires]) {
          warn('スキルツリー「' + branch.name + '」: 前のスキル ' + node.requires + ' がツリーにありません');
        }
      });
    });
    (data.player.initialSkills || []).forEach(function (id) {
      if (!data.skills[id]) warn('初期スキル ' + id + ' が skills にありません');
    });
    Object.keys(data.enemies).forEach(function (eid) {
      const e = data.enemies[eid];
      (e.actions || []).forEach(function (id) {
        const s = data.skills[id];
        if (id !== data.normalAttack.id && !(s && (s.type === 'active' || s.type === 'magic'))) {
          warn('敵「' + e.name + '」: 行動 ' + id + ' は戦闘で使えません');
        }
      });
    });
    if (!data.enemies[data.battle.enemyId]) warn('battle.enemyId ' + data.battle.enemyId + ' が enemies にありません');
  }

  /** 成長ルールで、合計の範囲に入る上昇値の組み合わせがあるか */
  function checkGrowth(data, warn) {
    const g = data.growth;
    const n = data.statKeys.length;
    if (g.gainMin > g.gainMax) warn('成長ルール: 上昇幅の下限が上限より大きいです');
    if (n * g.gainMin > g.totalMax || n * g.gainMax < g.totalMin) {
      warn('成長ルール: 上昇幅 ' + g.gainMin + '〜' + g.gainMax + ' では合計 ' + g.totalMin + '〜' + g.totalMax + ' に入りません');
    }
  }

  /** data.js を検査し、警告の文字列の配列を返す（問題がなければ空） */
  function validateData(data) {
    const warnings = [];
    const warn = function (msg) { warnings.push('[data.js] ' + msg); };
    checkSkills(data, warn);
    checkReferences(data, warn);
    checkGrowth(data, warn);
    return warnings;
  }

  const Validate = { validateData: validateData };

  if (typeof module === 'object' && module.exports) module.exports = Validate;
  else root.Validate = Validate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
