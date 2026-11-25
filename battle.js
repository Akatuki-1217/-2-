/*
 * battle.js — 戦闘計算（DOM非依存）
 * ダメージ・行動順・撃破判定・クールタイムを扱う。
 * 自キャラ専用／敵専用の書き方はせず、すべて「ユニット」同士で動く。
 *
 * ユニット: { id, name, side, controller, stats:{hp,mp,atk,def,matk,mdef,spd}, hp, mp, actions:[], cooldowns:{} }
 *   stats.hp / stats.mp は最大値、hp / mp は現在値。
 * 行動(action): { id, name, type:'attack'|'active'|'magic'|'heal'|'wait', power, mpCost, cooldown }
 *   heal は味方（自分を含む）のHPを「魔法攻撃力 × 威力倍率」だけ回復する。
 */
(function (root) {
  'use strict';

  // 浮動小数の誤差（例: 2.3 * 10 = 22.999...）で切り捨てがずれないよう丸めてから切り捨てる
  function floorSafe(x) {
    return Math.floor(Math.round(x * 1e6) / 1e6);
  }

  function createUnit(spec) {
    const stats = Object.assign({}, spec.stats);
    return {
      id: spec.id,
      name: spec.name,
      side: spec.side, // 'ally' | 'enemy'
      controller: spec.controller || 'auto', // 'player'（入力待ち） | 'auto'（自動行動）
      stats: stats,
      hp: spec.hp != null ? spec.hp : stats.hp,
      mp: spec.mp != null ? spec.mp : stats.mp,
      actions: (spec.actions || []).slice(),
      cooldowns: {},
    };
  }

  // 魔法・回復は魔法攻撃力／魔法防御力、それ以外（通常攻撃・アクティブスキル）は攻撃力／防御力
  function getDamageStats(action) {
    return action.type === 'magic' || action.type === 'heal' ? { atk: 'matk', def: 'mdef' } : { atk: 'atk', def: 'def' };
  }

  /** 回復量：魔法攻撃力 × 威力倍率（切り捨て）。最大HPを超えた分は捨てる */
  function calcHeal(healer, target, action) {
    const power = action.power != null ? action.power : 1;
    const amount = Math.max(0, floorSafe(healer.stats.matk * power));
    return Math.min(amount, Math.max(0, target.stats.hp - target.hp));
  }

  /** 相手に向ける行動か（回復・様子見以外） */
  function isOffensive(action) {
    return action.type !== 'heal' && action.type !== 'wait';
  }

  /** ダメージ計算：攻撃側の能力値 × 威力倍率 − 相手の防御側能力値（式全体のあとで切り捨て、0以下は0） */
  function calcDamage(attacker, defender, action) {
    const k = getDamageStats(action);
    const power = action.power != null ? action.power : 1;
    const value = floorSafe(attacker.stats[k.atk] * power - defender.stats[k.def]);
    return value > 0 ? { damage: value, effective: true } : { damage: 0, effective: false };
  }

  /** ユニットが持つ行動をIDで探す（並び順に頼らない） */
  function findAction(unit, actionId) {
    return unit.actions.find(function (a) { return a.id === actionId; }) || null;
  }

  function getCooldown(unit, actionId) {
    return unit.cooldowns[actionId] || 0;
  }

  /** 何もしない行動。使える行動が1つもないときに使う（クールタイムは通常どおり減る） */
  const WAIT = { id: 'wait', name: '様子を見る', type: 'wait', power: 0, mpCost: 0, cooldown: 0 };

  /** 行動が使えるか（MP・クールタイム） */
  function canUseAction(unit, action) {
    if (!action) return { ok: false, reason: 'no_action' };
    if (unit.hp <= 0) return { ok: false, reason: 'defeated' };
    if (action.type === 'wait') return { ok: true };
    const cd = getCooldown(unit, action.id);
    if (cd > 0) return { ok: false, reason: 'cooldown', remaining: cd };
    if ((action.mpCost || 0) > unit.mp) return { ok: false, reason: 'mp' };
    return { ok: true };
  }

  /**
   * 行動を実行する。「誰が・何を・誰に」を受け取り、結果を返す。
   * 返り値: { ok, actorId, targetId, actionId, actionName, actionType, damage, effective, mpCost, targetHp, defeated }
   */
  function executeAction(actor, target, action) {
    const check = canUseAction(actor, action);
    if (!check.ok) return Object.assign({ ok: false }, check);
    if (action.type === 'wait') {
      return {
        ok: true, actorId: actor.id, targetId: null, actionId: action.id, actionName: action.name,
        actionType: 'wait', damage: 0, effective: false, mpCost: 0, targetHp: null, defeated: false,
      };
    }
    if (!target || target.hp <= 0) return { ok: false, reason: 'invalid_target' };
    // 攻撃は相手の陣営に、回復は自分の陣営にだけ使える
    if (isOffensive(action) === (target.side === actor.side)) return { ok: false, reason: 'invalid_target' };

    const mpCost = action.mpCost || 0;
    actor.mp -= mpCost;
    if ((action.cooldown || 0) > 0) actor.cooldowns[action.id] = action.cooldown;

    if (action.type === 'heal') {
      const healed = calcHeal(actor, target, action);
      target.hp += healed;
      return {
        ok: true, actorId: actor.id, targetId: target.id, actionId: action.id, actionName: action.name,
        actionType: 'heal', damage: 0, heal: healed, effective: healed > 0, mpCost: mpCost,
        targetHp: target.hp, defeated: false,
      };
    }

    const dmg = calcDamage(actor, target, action);
    target.hp = Math.max(0, target.hp - dmg.damage);

    return {
      ok: true,
      actorId: actor.id,
      targetId: target.id,
      actionId: action.id,
      actionName: action.name,
      actionType: action.type,
      damage: dmg.damage,
      effective: dmg.effective,
      mpCost: mpCost,
      targetHp: target.hp,
      defeated: target.hp <= 0,
    };
  }

  /**
   * 自分の手番の終わりに呼ぶ。今回使った行動以外のクールタイムを1減らす。
   * 「クールタイムN」＝使ったあと自分の手番N回分は使えない。
   */
  function endTurn(unit, usedActionId) {
    Object.keys(unit.cooldowns).forEach(function (id) {
      if (id !== usedActionId && unit.cooldowns[id] > 0) unit.cooldowns[id] -= 1;
    });
  }

  function resetCooldowns(unit) {
    unit.cooldowns = {};
  }

  function isDefeated(unit) {
    return unit.hp <= 0;
  }

  /** 行動順：素早さが高い順。同じ値なら tieFirstSide の側が先、それも同じなら渡した順 */
  function getTurnOrder(units, opts) {
    const first = (opts && opts.tieFirstSide) || 'ally';
    return units
      .map(function (u, i) { return { u: u, i: i }; })
      .filter(function (x) { return x.u.hp > 0; })
      .sort(function (a, b) {
        return (b.u.stats.spd - a.u.stats.spd)
          || ((a.u.side === first ? 0 : 1) - (b.u.side === first ? 0 : 1))
          || (a.i - b.i);
      })
      .map(function (x) { return x.u; });
  }

  /** 勝敗判定：生き残っている陣営が1つだけならその陣営の勝ち。決着前は null */
  function getWinnerSide(units) {
    const alive = {};
    const all = {};
    units.forEach(function (u) {
      all[u.side] = true;
      if (u.hp > 0) alive[u.side] = true;
    });
    const aliveSides = Object.keys(alive);
    if (aliveSides.length === 0) return 'none';
    if (aliveSides.length === 1 && Object.keys(all).length > 1) return aliveSides[0];
    return null;
  }

  const hpRate = function (u) { return u.stats.hp > 0 ? u.hp / u.stats.hp : 0; };

  /** いちばんHPの割合が低いユニット（同じなら先に並んでいる方） */
  function weakest(list) {
    return list.reduce(function (best, u) { return !best || hpRate(u) < hpRate(best) ? u : best; }, null);
  }

  /**
   * 自動行動の「何を・誰に」を決める。行動は持っている順に優先して試す。
   *  - 回復：HPの割合が opts.healBelow 未満の味方がいるときだけ、いちばん減っている味方に使う
   *  - 攻撃：生きている相手のうち、いちばんHPの割合が低い相手を狙う
   * 使える行動がなければ null（呼び出し側で「様子を見る」にする）。
   */
  function chooseAutoMove(units, actor, opts) {
    const healBelow = opts && opts.healBelow != null ? opts.healBelow : 0.5;
    const alive = units.filter(function (u) { return u.hp > 0; });
    const foes = alive.filter(function (u) { return u.side !== actor.side; });
    const friends = alive.filter(function (u) { return u.side === actor.side; });
    for (let i = 0; i < actor.actions.length; i++) {
      const action = actor.actions[i];
      if (!canUseAction(actor, action).ok) continue;
      if (action.type === 'wait') continue;
      if (action.type === 'heal') {
        const hurt = friends.filter(function (u) { return hpRate(u) < healBelow; });
        if (hurt.length > 0) return { action: action, target: weakest(hurt) };
        continue;
      }
      if (foes.length > 0) return { action: action, target: weakest(foes) };
    }
    return null;
  }

  /**
   * 戦闘の進行を管理する。
   *   const b = Battle.createBattle([unitA, unitB]);
   *   b.current()           … 今行動するユニット（必要なら新しいターンを始める）
   *   b.act(actor, action, target) … 行動して結果を返す
   *   b.autoAct()           … 今のユニットを自動行動させる（行動できなければ様子を見る）
   *   b.pass()              … 今のユニットに様子を見させる
   */
  function createBattle(units, opts) {
    const state = { units: units, turn: 0, order: [], index: 0, over: false, winner: null };
    units.forEach(resetCooldowns);

    function current() {
      if (state.over) return null;
      while (state.index < state.order.length && state.order[state.index].hp <= 0) state.index++;
      if (state.index >= state.order.length) {
        state.turn += 1;
        state.order = getTurnOrder(units, opts);
        state.index = 0;
      }
      return state.order[state.index] || null;
    }

    function act(actor, action, target) {
      if (state.over) return { ok: false, reason: 'battle_over' };
      if (actor !== current()) return { ok: false, reason: 'not_your_turn' };
      const r = executeAction(actor, target, action);
      if (!r.ok) return r;

      endTurn(actor, action.id);
      state.index += 1;
      const winner = getWinnerSide(units);
      if (winner) {
        // 先に動いた側の行動で決着したら、後の側は行動せずに終了
        state.over = true;
        state.winner = winner;
        units.forEach(resetCooldowns); // 戦闘が終わるとクールタイムはリセット
      }
      r.turn = state.turn;
      r.battleOver = state.over;
      r.winner = state.winner;
      return r;
    }

    /** 今のユニットに「様子を見る」をさせてターンを進める（必ず成功する） */
    function pass(actor) {
      return act(actor || current(), WAIT, null);
    }

    /** 今のユニットを自動行動させる。使える行動がない・失敗したときは「様子を見る」で必ずターンを進める */
    function autoAct() {
      const actor = current();
      if (!actor) return { ok: false, reason: 'battle_over' };
      const move = chooseAutoMove(units, actor, opts);
      if (!move) return pass(actor);
      const r = act(actor, move.action, move.target);
      return r.ok ? r : pass(actor);
    }

    return {
      state: state,
      current: current,
      act: act,
      pass: pass,
      autoAct: autoAct,
      getUnit: function (id) { return units.find(function (u) { return u.id === id; }) || null; },
    };
  }

  /** テスト用：全ユニットを自動行動させて決着まで進める（コンソール確認用） */
  function simulate(units, opts) {
    const b = createBattle(units, opts);
    const log = [];
    let guard = 1000;
    while (!b.state.over && guard-- > 0) {
      const r = b.autoAct();
      if (!r.ok) break;
      log.push(r);
    }
    return { turns: b.state.turn, winner: b.state.winner, log: log };
  }

  const Battle = {
    WAIT: WAIT,
    createUnit: createUnit,
    calcDamage: calcDamage,
    findAction: findAction,
    canUseAction: canUseAction,
    executeAction: executeAction,
    getCooldown: getCooldown,
    endTurn: endTurn,
    resetCooldowns: resetCooldowns,
    isDefeated: isDefeated,
    getTurnOrder: getTurnOrder,
    getWinnerSide: getWinnerSide,
    calcHeal: calcHeal,
    isOffensive: isOffensive,
    chooseAutoMove: chooseAutoMove,
    createBattle: createBattle,
    simulate: simulate,
  };

  if (typeof module === 'object' && module.exports) module.exports = Battle;
  else root.Battle = Battle;
})(typeof globalThis !== 'undefined' ? globalThis : this);
