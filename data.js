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

    // 敵
    enemies: {
      soldier: {
        name: '試験兵',
        // HPは未決事項（30のままか28にするか）。28にするとファイアが活きる（第8章 検証メモ）
        stats: { hp: 30, mp: 0, atk: 9, def: 4, matk: 0, mdef: 2, spd: 6 },
        actions: ['attack'], // 通常攻撃のみ
        reward: { exp: 10, sp: 1 },
      },
    },

    // 戦闘の設定
    battle: {
      // 出撃時に戦う敵（MVPは試験兵1体）。配列なのは、戦闘計算・戦闘画面が複数ユニットでも動く作りのため
      enemies: ['soldier'],
      tieFirstSide: 'ally', // 素早さが同じときに先に動く側（暫定：自キャラが先）
    },

    // 通常攻撃（威力倍率1.0）
    normalAttack: { id: 'attack', name: '攻撃', type: 'attack', power: 1.0, mpCost: 0, cooldown: 0 },

    /*
     * 魔法・スキル
     *  type: 'active'（物理・攻撃力を使う） / 'magic'（魔法攻撃力を使う） / 'passive'（常時発動）
     *  power: 威力倍率 / mpCost: MP消費 / cooldown: クールタイム / sp: 必要SP / bonus: パッシブの上昇量
     */
    skills: {
      power_strike: { name: '強打', type: 'active', rank: 'D', power: 1.4, mpCost: 3, cooldown: 1, sp: 1 },
      full_slash: { name: '渾身斬り', type: 'active', rank: 'C', power: 1.8, mpCost: 7, cooldown: 2, sp: 2 },
      fire: { name: 'ファイア', type: 'magic', rank: 'D', power: 1.2, mpCost: 4, cooldown: 0, sp: 1 },
      flame: { name: 'フレイム', type: 'magic', rank: 'C', power: 1.6, mpCost: 7, cooldown: 0, sp: 2 },
      strength: { name: '腕力', type: 'passive', rank: 'D', bonus: { atk: 2 }, sp: 1 },
      vitality: { name: '体力', type: 'passive', rank: 'C', bonus: { hp: 4 }, sp: 2 },
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
