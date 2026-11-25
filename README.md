# 戦略RPG（MVP）

「戦闘する → 報酬で強化する → また戦闘する」の基本サイクルを、1対1のコマンドバトルで遊べるブラウザゲームです。
要件定義書 v1.1 に沿って作っています。

## 遊び方

`index.html` をブラウザで開くだけで動きます（ビルド・サーバー不要）。スマホ縦画面・PC両対応。
セーブはありません。再読み込みすると Lv1・拠点に戻ります。

| 画面 | スマホ | PC |
| --- | --- | --- |
| 拠点 | 「出撃」「本」をタップ | Enter＝出撃、Esc＝本 |
| 戦闘 | 攻撃／魔法／スキルをタップ → 一覧からタップ、「戻る」 | A＝攻撃、W＝魔法、S＝スキル、一覧は ↑↓＋Enter、Esc で閉じる |
| 敗北表示 | タップ | Enter |
| 結果画面 | 「次の戦闘へ」「拠点に戻る」 | 矢印で選んで Enter |
| 本（ステータス） | 「スキルツリー」「戻る」 | Enter＝スキルツリー、Esc＝拠点 |
| スキルツリー | スキルをタップ → 「獲得する／やめる」 | 矢印で選んで Enter、確認は ←→＋Enter、Esc で戻る |

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` / `style.css` | 画面の骨組みと見た目 |
| `data.js` | 能力値・魔法・スキル・敵・スキルツリー・成長ルール・ランク表・演出時間 |
| `battle.js` | 戦闘計算（DOM非依存）：ダメージ、行動順、撃破判定、クールタイム |
| `growth.js` | 経験値・Lvアップ・スキル獲得の判定（DOM非依存） |
| `ui.js` | 画面の描画 |
| `main.js` | ゲームの状態、入力、画面遷移 |
| `tests/acceptance.test.js` | 完了条件のうち計算で確かめられるものの自動テスト |

## テスト

```sh
node tests/acceptance.test.js
```

ブラウザのコンソールからも直接呼べます（例）:

```js
// ファイアのダメージ（7）
const p = Battle.createUnit({ id: 'p', name: '主人公', side: 'ally', stats: DATA.player.stats });
const e = Battle.createUnit({ id: 'e', name: '試験兵', side: 'enemy', stats: DATA.enemies.soldier.stats });
Battle.calcDamage(p, e, { type: 'magic', power: 1.2 });   // → { damage: 7, effective: true }

// 通常攻撃だけで戦わせる（5ターンで勝利）
Battle.simulate([
  Battle.createUnit({ id: 'p', name: '主人公', side: 'ally', stats: DATA.player.stats, actions: [DATA.normalAttack] }),
  Battle.createUnit({ id: 'e', name: '試験兵', side: 'enemy', stats: DATA.enemies.soldier.stats, actions: [DATA.normalAttack] }),
]);

// Lvアップの乱数を固定する
Growth.setRandom(Growth.seededRandom(42));
Growth.addExp(Game.ch, 30, DATA);
Growth.setRandom(); // 元に戻す

Game.ch // 今のキャラクターの状態
```

## 調整のしかた

数値はすべて `data.js` にあります。書き換えて再読み込みするだけで反映されます。

- 試験兵のHPを28にする：`enemies.soldier.stats.hp`
- 必要経験値をLvごとに変える：`growth.expToNext` を配列にする（例：`[30, 40, 50]`）
- スキル・魔法の値：`skills`。第7章のランク表（`ranks`）の範囲外だとコンソールに警告が出ます
- 魔法にクールタイムを付ける：魔法の `cooldown` を1以上にすると、戦闘・一覧・確認表示にそのまま反映されます

## 要件で決まっていなかった点の扱い

- 試験兵のHPは要件どおり **30** のまま（未決事項）。28にした場合も「2連勝・3戦目は負け」が崩れないことをテストで確認済み
- 本の画面からスキルツリーへのキー操作は **Enter** にしました
- スキル獲得の確認表示は「獲得する」が最初に選ばれた状態です（←→で「やめる」に切り替え）
- 押しっぱなしによるキーの連続入力は無視します（矢印キーを除く）
- スキル獲得数には、最初から持っているファイアも数えます
