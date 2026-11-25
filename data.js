/*
 * data.js — ゲームの数値・定義をまとめたファイル
 * 暫定値はすべてここで調整する（コードに数値を直書きしない）。
 */
(function (root) {
  'use strict';

  const DATA = {
    // 能力値の並び順と表示名
    statKeys: ['hp', 'mp', 'atk', 'def', 'matk', 'mdef', 'spd'],
    statLabels: {
      hp: 'HP',
      mp: 'MP',
      atk: '攻撃力',
      def: '防御力',
      matk: '魔法攻撃力',
      mdef: '魔法防御力',
      spd: '素早さ',
    },

    // 自キャラ（Lv1）
    player: {
      name: '主人公',
      level: 1,
      sp: 0,
      stats: { hp: 50, mp: 20, atk: 10, def: 5, matk: 8, mdef: 4, spd: 5 },
      initialSkills: ['fire'], // 魔法コマンドが空にならないよう最初から持っている
    },

    /*
     * 敵
     *  actions: 使う行動（'attack' か skills のキー）。上から順に優先して試す。
     *           回復は味方のHPが battle.aiHealBelow 未満のときだけ使う。
     *           使える行動が1つもない手番は「様子を見る」になる。
     */
    enemies: {
      soldier: {
        name: '試験兵',
        // HPは未決事項（30のままか28にするか）。28にするとファイアが活きる（第8章 検証メモ）
        stats: { hp: 30, mp: 0, atk: 9, def: 4, matk: 0, mdef: 2, spd: 6 },
        actions: ['attack'], // 通常攻撃のみ
        reward: { exp: 10, sp: 1 },
      },
      scout: {
        name: '斥候兵',
        // 打たれ弱いが速い。2体同時に出る
        stats: { hp: 18, mp: 0, atk: 9, def: 2, matk: 0, mdef: 1, spd: 7 },
        actions: ['attack'],
        reward: { exp: 7, sp: 1 },
      },
      archer: {
        name: '見張りの弓兵',
        // 狙い撃ち（クールタイム1）しか持たないので、撃った次の手番は様子を見る
        stats: { hp: 24, mp: 30, atk: 11, def: 3, matk: 0, mdef: 2, spd: 4 },
        actions: ['aimed_shot'],
        reward: { exp: 9, sp: 1 },
      },
      acolyte: {
        name: '見習い僧',
        // 仲間のHPが減ると癒しの光で回復する。先に倒すと楽になる
        stats: { hp: 20, mp: 20, atk: 7, def: 2, matk: 8, mdef: 5, spd: 3 },
        actions: ['healing_light', 'attack'],
        reward: { exp: 8, sp: 1 },
      },
      captain: {
        name: '砦の隊長',
        // 兜割り（クールタイム2）と通常攻撃を交互に使う
        stats: { hp: 56, mp: 24, atk: 13, def: 6, matk: 0, mdef: 3, spd: 5 },
        actions: ['helm_splitter', 'attack'],
        reward: { exp: 24, sp: 2 },
      },
    },

    /*
     * 出撃先
     *  enemies: 出てくる敵（同じ敵を並べると複数体） / requires: このステージをクリアすると解放
     *  recommendedLv: 目安のLv（表示のみ）
     */
    encounters: [
      { id: 'training', name: '訓練場', enemies: ['soldier'], recommendedLv: 1, requires: null },
      { id: 'woods', name: '森の小道', enemies: ['scout', 'scout'], recommendedLv: 2, requires: 'training' },
      { id: 'tower', name: '見張り塔', enemies: ['archer', 'acolyte'], recommendedLv: 3, requires: 'woods' },
      { id: 'fort', name: '古い砦', enemies: ['acolyte', 'captain'], recommendedLv: 4, requires: 'tower' },
    ],

    // 戦闘の設定
    battle: {
      tieFirstSide: 'ally', // 素早さが同じときに先に動く側（暫定：自キャラが先）
      aiHealBelow: 0.6, // 自動行動のユニットは、HPがこの割合未満の味方がいると回復を使う
    },

    // 通常攻撃（威力倍率1.0）
    normalAttack: { id: 'attack', name: '攻撃', type: 'attack', power: 1.0, mpCost: 0, cooldown: 0 },

    /*
     * 魔法・スキル
     *  type: 'active'（物理・攻撃力を使う） / 'magic'（魔法攻撃力を使う）
     *        / 'heal'（味方のHPを「魔法攻撃力 × 威力倍率」回復） / 'passive'（常時発動）
     *  power: 威力倍率 / mpCost: MP消費 / cooldown: クールタイム / sp: 必要SP / bonus: パッシブの上昇量
     */
    skills: {
      power_strike: { name: '強打', type: 'active', rank: 'D', power: 1.4, mpCost: 3, cooldown: 1, sp: 1 },
      full_slash: { name: '渾身斬り', type: 'active', rank: 'C', power: 1.8, mpCost: 7, cooldown: 2, sp: 2 },
      fire: { name: 'ファイア', type: 'magic', rank: 'D', power: 1.2, mpCost: 4, cooldown: 0, sp: 1 },
      flame: { name: 'フレイム', type: 'magic', rank: 'C', power: 1.6, mpCost: 7, cooldown: 0, sp: 2 },
      strength: { name: '腕力', type: 'passive', rank: 'D', bonus: { atk: 2 }, sp: 1 },
      vitality: { name: '体力', type: 'passive', rank: 'C', bonus: { hp: 4 }, sp: 2 },
      healing_light: { name: '癒しの光', type: 'heal', rank: 'D', power: 1.4, mpCost: 5, cooldown: 0, sp: 1 },
      spring_of_life: { name: '命の泉', type: 'heal', rank: 'C', power: 1.8, mpCost: 8, cooldown: 0, sp: 2 },
      // 敵が使う技（スキルツリーには無い）
      aimed_shot: { name: '狙い撃ち', type: 'active', rank: 'C', power: 1.5, mpCost: 6, cooldown: 1, sp: 2 },
      helm_splitter: { name: '兜割り', type: 'active', rank: 'C', power: 1.6, mpCost: 6, cooldown: 2, sp: 2 },
    },

    // スキルツリー（前のスキルは1つだけ。requires: null は1段目）
    skillTree: [
      {
        name: '剣技',
        nodes: [
          { skill: 'power_strike', requires: null },
          { skill: 'full_slash', requires: 'power_strike' },
        ],
      },
      {
        name: '魔法',
        nodes: [
          { skill: 'fire', requires: null },
          { skill: 'flame', requires: 'fire' },
        ],
      },
      {
        name: '鍛錬',
        nodes: [
          { skill: 'strength', requires: null },
          { skill: 'vitality', requires: 'strength' },
        ],
      },
      {
        name: '癒し',
        nodes: [
          { skill: 'healing_light', requires: null },
          { skill: 'spring_of_life', requires: 'healing_light' },
        ],
      },
    ],

    // 成長ルール
    growth: {
      // Lvアップに必要な経験値。数値ならずっと同じ。配列にするとLvごとに変えられる（[Lv1→2, Lv2→3, ...]）
      expToNext: 30,
      stats: ['hp', 'mp', 'atk', 'def', 'matk', 'mdef', 'spd'],
      gainMin: 0, // 各能力値の上昇幅（下限）
      gainMax: 2, // 各能力値の上昇幅（上限）
      totalMin: 5, // 7つの合計の下限
      totalMax: 10, // 7つの合計の上限
    },

    // 第7章 コストと威力のランク表（data検証用。範囲外の値はコンソールに警告を出す）
    ranks: {
      D: { power: [1.2, 1.4], mpCost: [3, 5], sp: 1, cooldown: [0, 1], passive: 2 },
      C: { power: [1.5, 1.8], mpCost: [6, 9], sp: 2, cooldown: [1, 2], passive: 4 },
      B: { power: [1.9, 2.3], mpCost: [10, 14], sp: 3, cooldown: [2, 3], passive: 6 },
      A: { power: [2.4, 3.0], mpCost: [15, 20], sp: 5, cooldown: [3, 4], passive: 10 },
    },

    // 演出の待ち時間（ミリ秒）
    timing: {
      battleStart: 500,
      beforeEnemyAction: 450,
      hitAnimation: 380,
      afterAction: 300,
      victoryToResult: 900,
      defeatInputDelay: 600,
      toast: 1600,
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = DATA;
  else root.DATA = DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this);
