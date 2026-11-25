/*
 * growth.js — 経験値・Lvアップ・スキル獲得の判定（DOM非依存）
 * 数値はすべて引数の data（data.js の DATA）から読む。
 *
 * キャラクター: { name, level, exp, sp, base:{hp,mp,...}, hp, mp, skills:[skillId...] }
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

  /** 戦闘で使う行動のID（先頭は通常攻撃、続いて獲得済みのスキル）。戦闘用の行動は Battle.buildActions で作る */
  function getBattleActionIds(ch, data) {
    return [data.normalAttack.id].concat(ch.skills);
  }

  // ---- 経験値・Lvアップ ----

  /** 今のLvから次のLvに必要な経験値 */
  function expToNext(level, rules) {
    const t = rules.expToNext;
    if (Array.isArray(t)) return t[Math.min(level - 1, t.length - 1)];
    if (typeof t === 'function') return t(level);
    return t;
  }

  /** 7つの能力値（data.statKeys）の上昇値を決める。合計が範囲に入るまでやり直す */
  function rollStatGains(data, rng) {
    const rules = data.growth;
    rng = rng || random;
    for (let attempt = 1; attempt <= 10000; attempt++) {
      const gains = {};
      let total = 0;
      data.statKeys.forEach(function (k) {
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
      const roll = rollStatGains(data, rng);
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

  /** 敗北時：今のLvでためた経験値を0にし、HP・MPを全回復。Lv・SP・スキルは失わない */
  function applyDefeat(ch, data) {
    const lostExp = ch.exp;
    ch.exp = 0;
    fullHeal(ch, data);
    return { lostExp: lostExp };
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

  const Growth = {
    setRandom: setRandom,
    seededRandom: seededRandom,
    sequenceRandom: sequenceRandom,
    createCharacter: createCharacter,
    getPassiveBonus: getPassiveBonus,
    getEffectiveStats: getEffectiveStats,
    fullHeal: fullHeal,
    getBattleActionIds: getBattleActionIds,
    expToNext: expToNext,
    rollStatGains: rollStatGains,
    applyStatGains: applyStatGains,
    addExp: addExp,
    grantReward: grantReward,
    applyDefeat: applyDefeat,
    findNode: findNode,
    checkAcquire: checkAcquire,
    acquireSkill: acquireSkill,
    getNodeState: getNodeState,
    MESSAGES: MESSAGES,
  };

  if (typeof module === 'object' && module.exports) module.exports = Growth;
  else root.Growth = Growth;
})(typeof globalThis !== 'undefined' ? globalThis : this);
