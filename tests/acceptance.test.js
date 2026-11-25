/*
 * 完了条件（第12章）のうち、計算で確かめられるものを画面なしで検証する。
 * 実行: node tests/acceptance.test.js
 */
'use strict';

const DATA = require('../data.js');
const Battle = require('../battle.js');
const Growth = require('../growth.js');
const Validate = require('../validate.js');

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  OK   ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function makePlayerUnit(ch, data) {
  return Battle.createUnit({
    id: 'player', name: ch.name, side: 'ally', controller: 'player',
    stats: Growth.getEffectiveStats(ch, data), hp: ch.hp, mp: ch.mp,
    actions: Battle.buildActions(Growth.getBattleActionIds(ch, data), data),
  });
}
function makeEnemyUnit(data) {
  return Battle.createEnemyUnit(data, data.battle.enemyId, { id: 'enemy' });
}

/** プレイヤーは policy(player, enemy, battle) で行動を選ぶ。敵は自動 */
function fight(ch, data, policy) {
  const p = makePlayerUnit(ch, data);
  const e = makeEnemyUnit(data);
  const b = Battle.createBattle([p, e], { tieFirstSide: data.battle.tieFirstSide });
  const results = [];
  while (!b.state.over) {
    const actor = b.current();
    const r = actor === p ? b.act(p, policy(p, e, b), e) : b.autoAct();
    if (!r.ok) throw new Error('行動失敗: ' + r.reason);
    results.push(r);
  }
  ch.hp = p.hp; ch.mp = p.mp;
  return { winner: b.state.winner, turns: b.state.turn, results: results, player: p, enemy: e };
}
const attackOnly = function (p) { return p.actions[0]; };

console.log('■ 戦闘');
{
  const ch = Growth.createCharacter(DATA);
  const r = fight(ch, DATA, attackOnly);
  check('通常攻撃だけで5ターン目に勝つ', r.winner === 'ally' && r.turns === 5, { winner: r.winner, turns: r.turns });
  check('残りHPは30', ch.hp === 30, ch.hp);
  check('通常攻撃は6ダメージ', r.results.find(function (x) { return x.actorId === 'player'; }).damage === 6);
  check('敵の攻撃は4ダメージ（敵が先攻）', r.results[0].actorId === 'enemy' && r.results[0].damage === 4);

  const r2 = fight(ch, DATA, attackOnly);
  check('2戦目も勝ち、HP10', r2.winner === 'ally' && ch.hp === 10, ch.hp);
  const r3 = fight(ch, DATA, attackOnly);
  check('回復せず3戦目は負ける', r3.winner === 'enemy', r3.winner);
}
{
  // 最善手（MPを全部ファイアに使う）でも3戦目は負ける
  const ch = Growth.createCharacter(DATA);
  const bestPolicy = function (p) {
    const fire = p.actions.find(function (a) { return a.id === 'fire'; });
    return Battle.canUseAction(p, fire).ok ? fire : p.actions[0];
  };
  const w = [fight(ch, DATA, bestPolicy).winner, fight(ch, DATA, bestPolicy).winner, fight(ch, DATA, bestPolicy).winner];
  check('ファイアを使っても「2連勝・3戦目は負け」', w.join(',') === 'ally,ally,enemy', w);
}
{
  const ch = Growth.createCharacter(DATA);
  const p = makePlayerUnit(ch, DATA);
  const e = makeEnemyUnit(DATA);
  const fire = p.actions.find(function (a) { return a.id === 'fire'; });
  const r = Battle.executeAction(p, e, fire);
  check('ファイアで7ダメージ', r.damage === 7, r.damage);
  check('ファイアでMPが4減る', p.mp === 16, p.mp);
  p.mp = 3;
  check('MP不足だと使えない', Battle.canUseAction(p, fire).ok === false && Battle.canUseAction(p, fire).reason === 'mp');
}
{
  // クールタイム1：1ターン目に使うと2ターン目は使えず、3ターン目から使える
  const ch = Growth.createCharacter(DATA);
  ch.skills.push('power_strike');
  const p = makePlayerUnit(ch, DATA);
  const strike = p.actions.find(function (a) { return a.id === 'power_strike'; });
  const e = Battle.createUnit({ id: 'dummy', name: '的', side: 'enemy', stats: { hp: 999, mp: 0, atk: 0, def: 4, matk: 0, mdef: 2, spd: 1 }, actions: [DATA.normalAttack] });
  const b = Battle.createBattle([p, e]);
  const usable = [];
  for (let t = 1; t <= 4; t++) {
    b.current();
    usable.push(Battle.canUseAction(p, strike).ok);
    const r = b.act(p, Battle.canUseAction(p, strike).ok ? strike : p.actions[0], e);
    if (t === 1) check('強打は10ダメージ', r.damage === 10, r.damage);
    b.autoAct();
  }
  check('CT1: 使える/使えない/使える/使えない', usable.join(',') === 'true,false,true,false', usable);

  // クールタイム2
  const ch2 = Growth.createCharacter(DATA);
  ch2.skills.push('full_slash');
  ch2.base.mp = 99; Growth.fullHeal(ch2, DATA);
  const p2 = makePlayerUnit(ch2, DATA);
  const slash = p2.actions.find(function (a) { return a.id === 'full_slash'; });
  const e2 = Battle.createUnit({ id: 'dummy', name: '的', side: 'enemy', stats: { hp: 999, mp: 0, atk: 0, def: 4, matk: 0, mdef: 2, spd: 1 }, actions: [DATA.normalAttack] });
  const b2 = Battle.createBattle([p2, e2]);
  const u2 = []; const cdShown = [];
  for (let t = 1; t <= 4; t++) {
    b2.current();
    u2.push(Battle.canUseAction(p2, slash).ok);
    cdShown.push(Battle.getCooldown(p2, 'full_slash'));
    b2.act(p2, Battle.canUseAction(p2, slash).ok ? slash : p2.actions[0], e2);
    b2.autoAct();
  }
  check('CT2: 使える/使えない/使えない/使える', u2.join(',') === 'true,false,false,true', u2);
  check('CT2: 表示される残りターン 0,2,1,0', cdShown.join(',') === '0,2,1,0', cdShown);
}
{
  const a = Battle.createUnit({ id: 'a', name: 'A', side: 'ally', stats: { hp: 10, mp: 0, atk: 3, def: 0, matk: 0, mdef: 0, spd: 1 } });
  const d = Battle.createUnit({ id: 'd', name: 'D', side: 'enemy', stats: { hp: 10, mp: 0, atk: 0, def: 5, matk: 0, mdef: 0, spd: 1 } });
  const r = Battle.executeAction(a, d, DATA.normalAttack);
  check('0ダメージのとき効かなかった（HP減らず）', r.damage === 0 && r.effective === false && d.hp === 10);
  check('同じ素早さなら自キャラが先', Battle.getTurnOrder([d, a])[0] === a);
  check('浮動小数の誤差で切り捨てがずれない（10×2.3−0=23）',
    Battle.calcDamage({ stats: { atk: 10 } }, { stats: { def: 0 } }, { type: 'active', power: 2.3 }).damage === 23);
}
{
  // 途中終了：先に動いた側の行動で倒れたら、後の側は行動しない
  const fast = Battle.createUnit({ id: 'f', name: 'F', side: 'ally', stats: { hp: 10, mp: 0, atk: 99, def: 0, matk: 0, mdef: 0, spd: 9 }, actions: [DATA.normalAttack] });
  const slow = Battle.createUnit({ id: 's', name: 'S', side: 'enemy', stats: { hp: 10, mp: 0, atk: 99, def: 0, matk: 0, mdef: 0, spd: 1 }, actions: [DATA.normalAttack] });
  const sim = Battle.simulate([fast, slow]);
  check('途中終了（後攻は行動しない）', sim.log.length === 1 && sim.winner === 'ally' && fast.hp === 10);
}
{
  // 使える行動がない（MP不足のスキルだけ）ユニットは待機し、手番が止まらない
  const strike = { id: 'power_strike', name: '強打', type: 'active', power: 1.4, mpCost: 3, cooldown: 1 };
  const p = Battle.createUnit({ id: 'p', name: 'P', side: 'ally', stats: { hp: 30, mp: 0, atk: 10, def: 0, matk: 0, mdef: 0, spd: 1 }, actions: [DATA.normalAttack] });
  const e = Battle.createUnit({ id: 'e', name: 'E', side: 'enemy', stats: { hp: 30, mp: 0, atk: 10, def: 0, matk: 0, mdef: 0, spd: 9 }, actions: [strike] });
  const b = Battle.createBattle([p, e]);
  const r = b.autoAct();
  check('使える行動がなければ待機して手番が進む', r.ok && r.actionType === 'wait' && b.current() === p && p.hp === 30, r);
  const sim = Battle.simulate([
    Battle.createUnit({ id: 'p', name: 'P', side: 'ally', stats: { hp: 30, mp: 0, atk: 10, def: 0, matk: 0, mdef: 0, spd: 1 }, actions: [DATA.normalAttack] }),
    Battle.createUnit({ id: 'e', name: 'E', side: 'enemy', stats: { hp: 30, mp: 0, atk: 10, def: 0, matk: 0, mdef: 0, spd: 9 }, actions: [strike] }),
  ]);
  check('待機する敵とも決着までたどり着く', sim.winner === 'ally' && sim.turns === 3, sim);
}
{
  const e = Battle.createEnemyUnit(DATA, 'soldier');
  check('敵ユニットは data.js の定義から作られる（能力値・行動・報酬）',
    e.stats.hp === 30 && e.actions.length === 1 && e.actions[0].id === 'attack' && e.reward.exp === 10 && e.reward.sp === 1, e);
  check('戦闘用の行動にパッシブは含めない', Battle.buildActions(['attack', 'fire', 'strength'], DATA).map(function (a) { return a.id; }).join(',') === 'attack,fire');
}

console.log('■ 成長・拠点');
{
  for (let seed = 1; seed <= 200; seed++) {
    const ch = Growth.createCharacter(DATA);
    const rng = Growth.seededRandom(seed);
    const base = clone(ch.base);
    let res;
    for (let i = 0; i < 3; i++) res = Growth.grantReward(ch, DATA.enemies.soldier.reward, DATA, rng);
    const lu = res.levelUps[0];
    const sum = DATA.statKeys.reduce(function (s, k) { return s + (ch.base[k] - base[k]); }, 0);
    const okEach = DATA.statKeys.every(function (k) { return lu.gains[k] >= 0 && lu.gains[k] <= 2; });
    if (!(ch.level === 2 && ch.exp === 0 && ch.sp === 3 && sum >= 5 && sum <= 10 && sum === lu.total && okEach)) {
      check('3勝でLv2・上昇値合計5〜10（seed ' + seed + '）', false, { level: ch.level, sum: sum, gains: lu.gains });
      break;
    }
    if (seed === 200) check('3勝でLv2・上昇値は各0〜2、合計5〜10（乱数200通り）', true);
  }
  // 乱数の差し替え（固定）
  Growth.setRandom(Growth.sequenceRandom([0.99]));
  let threw = false;
  try { Growth.rollStatGains(DATA); } catch (err) { threw = true; }
  check('合計が範囲に入らない乱数（全部+2＝14）はやり直し続け、最後はエラーで止まる', threw);
  Growth.setRandom(Growth.sequenceRandom([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
  const one = Growth.rollStatGains(DATA);
  check('乱数固定：全部+1で合計7', one.total === 7 && one.attempts === 1, one);
  Growth.setRandom();

  // 現在HP・MPも上がる
  const ch = Growth.createCharacter(DATA);
  ch.hp = 20; ch.mp = 5;
  Growth.applyStatGains(ch, { hp: 2, mp: 1, atk: 1, def: 1, matk: 0, mdef: 0, spd: 0 });
  check('Lvアップで最大HP・MPが上がった分、現在値も増える', ch.hp === 22 && ch.mp === 6 && ch.base.hp === 52);

  // あふれた分の持ち越し・複数Lvアップ
  const data2 = clone(DATA); data2.growth.expToNext = [10, 10, 30];
  const ch2 = Growth.createCharacter(data2);
  const r2 = Growth.addExp(ch2, 25, data2, Growth.seededRandom(3));
  check('Lvごとの必要経験値・複数Lvアップ・持ち越し', ch2.level === 3 && ch2.exp === 5 && r2.levelUps.length === 2, { lv: ch2.level, exp: ch2.exp });
}
{
  const ch = Growth.createCharacter(DATA);
  Growth.grantReward(ch, { exp: 20, sp: 2 }, DATA);
  ch.skills.push('strength');
  ch.hp = 3; ch.mp = 1;
  const d = Growth.applyDefeat(ch, DATA);
  check('負けると経験値0（失った経験値20）', ch.exp === 0 && d.lostExp === 20);
  check('Lv・SP・スキルはそのまま', ch.level === 1 && ch.sp === 2 && ch.skills.indexOf('strength') >= 0 && ch.skills.indexOf('fire') >= 0);
  check('HP・MPは全回復', ch.hp === 50 && ch.mp === 20);
}
{
  const ch = Growth.createCharacter(DATA);
  check('例外: もう持っている（ファイア）', Growth.checkAcquire(ch, 'fire', DATA).message === 'もう持っています');
  check('例外: 前のスキルが未獲得（渾身斬り）', Growth.checkAcquire(ch, 'full_slash', DATA).message === '前のスキルを解放してください');
  check('例外: SP不足（強打・SP0）', Growth.checkAcquire(ch, 'power_strike', DATA).message === 'SPが不足しています');
  check('判定順: ロックとSP不足が重なったらロックを優先', Growth.checkAcquire(ch, 'flame', DATA).code === 'sp' && Growth.checkAcquire(ch, 'vitality', DATA).code === 'locked');
  check('表示状態', Growth.getNodeState(ch, 'fire', DATA) === 'owned' && Growth.getNodeState(ch, 'flame', DATA) === 'available' && Growth.getNodeState(ch, 'vitality', DATA) === 'locked');

  ch.sp = 3;
  const a1 = Growth.acquireSkill(ch, 'strength', DATA);
  check('腕力を獲得すると攻撃力12', a1.ok && Growth.getEffectiveStats(ch, DATA).atk === 12 && ch.sp === 2);
  ch.hp = 40;
  const a2 = Growth.acquireSkill(ch, 'vitality', DATA);
  const eff = Growth.getEffectiveStats(ch, DATA);
  check('体力を獲得すると最大HP54・現在HPも+4', a2.ok && eff.hp === 54 && ch.hp === 44 && ch.sp === 0);
  // パッシブ込みで戦闘のダメージも変わる
  const p = makePlayerUnit(ch, DATA);
  const e = makeEnemyUnit(DATA);
  check('腕力込みの通常攻撃は8ダメージ', Battle.calcDamage(p, e, DATA.normalAttack).damage === 8);
}

console.log('■ 設計');
{
  const warnings = Validate.validateData(DATA);
  check('data.js の今の値はランク表どおり（警告なし）', warnings.length === 0, warnings);
  const bad = clone(DATA);
  bad.skills.fire.power = 2.0;
  bad.skills.flame.cooldown = 1;
  bad.skills.strength.bonus.atk = 3;
  bad.skillTree[0].nodes[1].skill = 'no_such_skill';
  bad.enemies.soldier.actions = ['vitality'];
  const w = Validate.validateData(bad).join('\n');
  check('範囲外・魔法のクールタイム・パッシブ上昇量・参照切れ・敵の行動を警告する',
    /威力倍率 2/.test(w) && /魔法のクールタイム/.test(w) && /上昇量 3/.test(w) && /no_such_skill/.test(w) && /試験兵/.test(w), w);
}
{
  // data.js の数値を書き換えるだけで強さが変わる
  const data2 = clone(DATA);
  data2.enemies.soldier.stats.hp = 28;
  const ch = Growth.createCharacter(data2);
  const fire = function (p) {
    const f = p.actions.find(function (a) { return a.id === 'fire'; });
    return Battle.canUseAction(p, f).ok ? f : p.actions[0];
  };
  const r = fight(ch, data2, fire);
  check('試験兵HP28ならファイアで4ターン目に勝てる', r.winner === 'ally' && r.turns === 4, r.turns);
  const ch2 = Growth.createCharacter(data2);
  check('試験兵HP28でも通常攻撃は5ターン', fight(ch2, data2, attackOnly).turns === 5);
}
{
  // Lv1（攻撃とファイアだけ）で、回復なしに何連勝できるかを全パターンで調べる。
  // 1戦の中ではダメージの順番で必要な手数は変わらないので、各戦闘で「ファイアを何回使うか」だけを総当たりする
  function maxStreak(data) {
    const maxFire = Math.floor(data.player.stats.mp / data.skills.fire.mpCost);
    let best = 0;
    const plan = [];
    (function search(depth) {
      if (depth === 3) {
        const ch = Growth.createCharacter(data);
        let wins = 0;
        for (let i = 0; i < 3; i++) {
          let used = 0;
          const r = fight(ch, data, function (p) {
            const f = p.actions.find(function (a) { return a.id === 'fire'; });
            if (used < plan[i] && Battle.canUseAction(p, f).ok) { used++; return f; }
            return p.actions[0];
          });
          if (r.winner !== 'ally') break;
          wins++;
        }
        best = Math.max(best, wins);
        return;
      }
      for (let f = 0; f <= maxFire; f++) { plan[depth] = f; search(depth + 1); }
    })(0);
    return best;
  }
  [30, 28].forEach(function (hp) {
    const d = clone(DATA);
    d.enemies.soldier.stats.hp = hp;
    const best = maxStreak(d);
    check('試験兵HP' + hp + ': どう戦っても回復なしの連勝は2回まで（3戦目は負け）', best === 2, best);
  });
}

console.log(failed === 0 ? '\nすべて成功' : '\n失敗: ' + failed + '件');
process.exit(failed === 0 ? 0 : 1);
