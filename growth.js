/*
 * growth.js — 経験値・Lvアップ・スキル獲得の判定（DOM非依存）
 * 数値はすべて引数の data（data.js の DATA）から読む。
 *
 * キャラクター: { name, level, exp, sp, base:{hp,mp,...}, hp, mp, skills:[skillId...], cleared:[encounterId...] }
 *   base はLvアップで伸びる素の能力値。パッシブ込みの値は getEffectiveStats で求める。
 *   hp / mp は現在値。
 */
(function (root) {
  'use strict';

  // ---- 乱数（差し替え可能：テスト時に結果を固定するため） ----
  let random = Math.random;

  /** Lvアップに使う乱数を差し替える。引数なしで Math.random に戻す */
  function setRandom(fn) {
    random = typeof fn === 'function' ? fn : Math.random;
  }

  /** 再現できる乱数（mulberry32）。Growth.setRandom(Growth.seededRandom(1)) のように使う */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 決まった値を順番に返す乱数（テスト用）。values は 0以上1未満 */
  function sequenceRandom(values) {
    let i = 0;
    return function () {
      const v = values[i % values.length];
      i += 1;
      return v;
    };
  }

  function randInt(min, max, rng) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  // ---- キャラクター ----

  function createCharacter(data) {
    const p = data.player;
    const ch = {
      name: p.name,
      level: p.level || 1,
      exp: 0,
      sp: p.sp || 0,
      base: Object.assign({}, p.stats),
      hp: 0,
      mp: 0,
      skills: (p.initialSkills || []).slice(),
      cleared: [], // クリアした出撃先のID
    };
    fullHeal(ch, data); // 開始時はHP・MP満タン
    return ch;
  }

  /** パッシブスキルによる上昇量の合計 */
  function getPassiveBonus(ch, data) {
    const bonus = {};
    data.statKeys.forEach(function (k) { bonus[k] = 0; });
    ch.skills.forEach(function (id) {
      const s = data.skills[id];
      if (s && s.type === 'passive' && s.bonus) {
        Object.keys(s.bonus).forEach(function (k) { bonus[k] = (bonus[k] || 0) + s.bonus[k]; });
      }
    });
    return bonus;
  }

  /** パッシブ込みの能力値（最大HP・最大MPを含む） */
  function getEffectiveStats(ch, data) {
    const bonus = getPassiveBonus(ch, data);
    const eff = {};
    data.statKeys.forEach(function (k) { eff[k] = (ch.base[k] || 0) + (bonus[k] || 0); });
    return eff;
  }

  function fullHeal(ch, data) {
    const eff = getEffectiveStats(ch, data);
    ch.hp = eff.hp;
    ch.mp = eff.mp;
  }

  // 戦闘で「行動」になる種類（パッシブは常時発動なので行動にならない）
  const ACTION_TYPES = ['active', 'magic', 'heal'];

  /**
   * 行動ID（'attack' または data.skills のキー）を戦闘用の行動に変換する。
   * 敵・味方の両方がこれを使う。行動にならないID（パッシブ・存在しないID）は null。
   */
  function toAction(id, data) {
    if (id === data.normalAttack.id) return Object.assign({}, data.normalAttack);
    const s = data.skills[id];
    if (!s || ACTION_TYPES.indexOf(s.type) < 0) return null;
    return {
      id: id,
      name: s.name,
      type: s.type,
      power: s.power,
      mpCost: s.mpCost || 0,
      cooldown: s.cooldown || 0,
    };
  }

  /** 行動IDの一覧を行動の配列にする（行動にならないIDは除く） */
  function toActions(ids, data) {
    return ids.map(function (id) { return toAction(id, data); }).filter(Boolean);
  }

  /** 獲得済みの魔法・スキルを戦闘用の行動に変換する（通常攻撃を必ず含む） */
  function getBattleActions(ch, data) {
    return toActions([data.normalAttack.id].concat(ch.skills), data);
  }

  // ---- 経験値・Lvアップ ----

  /** 今のLvから次のLvに必要な経験値 */
  function expToNext(level, rules) {
    const t = rules.expToNext;
    if (Array.isArray(t)) return t[Math.min(level - 1, t.length - 1)];
    if (typeof t === 'function') return t(level);
    return t;
  }

  /** 7つの能力値の上昇値を決める。合計が範囲に入るまでやり直す */
  function rollStatGains(rules, rng) {
    rng = rng || random;
    for (let attempt = 1; attempt <= 10000; attempt++) {
      const gains = {};
      let total = 0;
      rules.stats.forEach(function (k) {
        const g = randInt(rules.gainMin, rules.gainMax, rng);
        gains[k] = g;
        total += g;
      });
      if (total >= rules.totalMin && total <= rules.totalMax) {
        return { gains: gains, total: total, attempts: attempt };
      }
    }
    throw new Error('成長ルールの条件を満たす上昇値が見つかりません（data.js の growth を確認してください）');
  }

  /** 上昇値を素の能力値に足す。最大HP・最大MPが上がった分だけ現在値も増やす */
  function applyStatGains(ch, gains) {
    Object.keys(gains).forEach(function (k) { ch.base[k] = (ch.base[k] || 0) + gains[k]; });
    ch.hp += gains.hp || 0;
    ch.mp += gains.mp || 0;
  }

  /** 経験値を加える。あふれた分は持ち越し、複数Lvアップにも対応 */
  function addExp(ch, amount, data, rng) {
    const rules = data.growth;
    ch.exp += amount;
    const levelUps = [];
    let need = expToNext(ch.level, rules);
    while (ch.exp >= need) {
      ch.exp -= need;
      const from = ch.level;
      ch.level += 1;
      const roll = rollStatGains(rules, rng);
      applyStatGains(ch, roll.gains);
      levelUps.push({ from: from, to: ch.level, gains: roll.gains, total: roll.total });
      need = expToNext(ch.level, rules);
    }
    return { expGained: amount, levelUps: levelUps, exp: ch.exp, expToNext: need };
  }

  /** 勝利報酬（経験値・SP）を受け取る */
  function grantReward(ch, reward, data, rng) {
    ch.sp += reward.sp || 0;
    const r = addExp(ch, reward.exp || 0, data, rng);
    r.spGained = reward.sp || 0;
    return r;
  }

  /** 敵IDの配列から、勝ったときの報酬の合計を求める */
  function sumRewards(enemyIds, data) {
    return enemyIds.reduce(function (sum, id) {
      const r = (data.enemies[id] && data.enemies[id].reward) || {};
      return { exp: sum.exp + (r.exp || 0), sp: sum.sp + (r.sp || 0) };
    }, { exp: 0, sp: 0 });
  }

  /** 敗北時：今のLvでためた経験値を0にし、HP・MPを全回復。Lv・SP・スキルは失わない */
  function applyDefeat(ch, data) {
    const lostExp = ch.exp;
    ch.exp = 0;
    fullHeal(ch, data);
    return { lostExp: lostExp };
  }

  // ---- 出撃先 ----

  function findEncounter(id, data) {
    return data.encounters.find(function (e) { return e.id === id; }) || null;
  }

  /** 出撃先の状態：'cleared'（クリア済み） / 'open'（行ける） / 'locked'（まだ行けない） */
  function getEncounterState(ch, enc) {
    if (ch.cleared.indexOf(enc.id) >= 0) return 'cleared';
    if (enc.requires && ch.cleared.indexOf(enc.requires) < 0) return 'locked';
    return 'open';
  }

  /**
   * 出撃先をクリアしたことを記録する。
   * 返り値: { firstClear, unlocked:[新しく行けるようになった出撃先] }
   */
  function markCleared(ch, encId, data) {
    if (ch.cleared.indexOf(encId) >= 0) return { firstClear: false, unlocked: [] };
    ch.cleared.push(encId);
    const unlocked = data.encounters.filter(function (e) { return e.requires === encId; });
    return { firstClear: true, unlocked: unlocked };
  }

  // ---- スキルツリー ----

  const MESSAGES = {
    owned: 'もう持っています',
    locked: '前のスキルを解放してください',
    sp: 'SPが不足しています',
    unknown: 'そのスキルはツリーにありません',
  };

  function findNode(tree, skillId) {
    for (let b = 0; b < tree.length; b++) {
      for (let n = 0; n < tree[b].nodes.length; n++) {
        if (tree[b].nodes[n].skill === skillId) return tree[b].nodes[n];
      }
    }
    return null;
  }

  /** 獲得できるかを上から順に判定する：もう持っている → 前のスキルがない → SP不足 */
  function checkAcquire(ch, skillId, data) {
    const node = findNode(data.skillTree, skillId);
    const skill = data.skills[skillId];
    if (!node || !skill) return { ok: false, code: 'unknown', message: MESSAGES.unknown };
    if (ch.skills.indexOf(skillId) >= 0) return { ok: false, code: 'owned', message: MESSAGES.owned };
    if (node.requires && ch.skills.indexOf(node.requires) < 0) {
      return { ok: false, code: 'locked', message: MESSAGES.locked };
    }
    if (ch.sp < skill.sp) return { ok: false, code: 'sp', message: MESSAGES.sp };
    return { ok: true };
  }

  /** SPを消費してスキルを獲得する。パッシブで最大HP・最大MPが上がったら現在値も増やす */
  function acquireSkill(ch, skillId, data) {
    const check = checkAcquire(ch, skillId, data);
    if (!check.ok) return check;
    const skill = data.skills[skillId];
    const before = getEffectiveStats(ch, data);
    ch.sp -= skill.sp;
    ch.skills.push(skillId);
    const after = getEffectiveStats(ch, data);
    ch.hp += after.hp - before.hp;
    ch.mp += after.mp - before.mp;
    return { ok: true, skillId: skillId, spLeft: ch.sp };
  }

  /** ツリー上の表示状態：'owned'（獲得済み） / 'available'（獲得できる） / 'locked'（ロック中） */
  function getNodeState(ch, skillId, data) {
    if (ch.skills.indexOf(skillId) >= 0) return 'owned';
    const node = findNode(data.skillTree, skillId);
    if (node && node.requires && ch.skills.indexOf(node.requires) < 0) return 'locked';
    return 'available';
  }

  // ---- データ検証 ----

  /**
   * data.js の中身を確かめ、問題の一覧（文字列の配列）を返す。問題がなければ空配列。
   *  - 第7章のランク表から外れた値
   *  - スキルツリー・敵が存在しないスキルを参照していないか
   */
  function validateData(data) {
    const warnings = [];
    const inRange = function (v, r) { return v >= r[0] && v <= r[1]; };

    Object.keys(data.skills).forEach(function (id) {
      const s = data.skills[id];
      const rank = data.ranks[s.rank];
      const warn = function (msg) { warnings.push(s.name + '（' + s.rank + '）: ' + msg); };
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

    data.skillTree.forEach(function (branch) {
      branch.nodes.forEach(function (node) {
        if (!data.skills[node.skill]) warnings.push('スキルツリー「' + branch.name + '」: ' + node.skill + ' がありません');
        if (node.requires && !findNode(data.skillTree, node.requires)) {
          warnings.push('スキルツリー「' + branch.name + '」: 前のスキル ' + node.requires + ' がツリーにありません');
        }
      });
    });

    const encIds = (data.encounters || []).map(function (e) { return e.id; });
    (data.encounters || []).forEach(function (enc) {
      if (!enc.enemies || enc.enemies.length === 0) warnings.push('出撃先「' + enc.name + '」: 敵がいません');
      (enc.enemies || []).forEach(function (id) {
        if (!data.enemies[id]) warnings.push('出撃先「' + enc.name + '」: 敵 ' + id + ' がありません');
      });
      if (enc.requires && encIds.indexOf(enc.requires) < 0) {
        warnings.push('出撃先「' + enc.name + '」: 解放条件 ' + enc.requires + ' がありません');
      }
    });

    Object.keys(data.enemies).forEach(function (id) {
      const e = data.enemies[id];
      (e.actions || []).forEach(function (a) {
        if (!toAction(a, data)) warnings.push('敵「' + e.name + '」: ' + a + ' は行動として使えません');
      });
    });

    return warnings;
  }

  const Growth = {
    setRandom: setRandom,
    seededRandom: seededRandom,
    sequenceRandom: sequenceRandom,
    createCharacter: createCharacter,
    getPassiveBonus: getPassiveBonus,
    getEffectiveStats: getEffectiveStats,
    fullHeal: fullHeal,
    toAction: toAction,
    toActions: toActions,
    getBattleActions: getBattleActions,
    expToNext: expToNext,
    rollStatGains: rollStatGains,
    applyStatGains: applyStatGains,
    addExp: addExp,
    grantReward: grantReward,
    sumRewards: sumRewards,
    applyDefeat: applyDefeat,
    findEncounter: findEncounter,
    getEncounterState: getEncounterState,
    markCleared: markCleared,
    findNode: findNode,
    checkAcquire: checkAcquire,
    acquireSkill: acquireSkill,
    getNodeState: getNodeState,
    validateData: validateData,
    MESSAGES: MESSAGES,
  };

  if (typeof module === 'object' && module.exports) module.exports = Growth;
  else root.Growth = Growth;
})(typeof globalThis !== 'undefined' ? globalThis : this);
