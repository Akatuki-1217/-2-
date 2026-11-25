# 戦略RPG（MVP）

「戦闘する → 報酬で強化する → また戦闘する」の基本サイクルを、1対1のコマンドバトルで遊べるブラウザゲームです。
要件定義書 v1.1 に沿って作り、その後のコードレビューで出た不具合の修正と作りの改善（下の「レビュー対応」）を入れています。

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
| `growth.js` | 経験値・Lvアップ・スキル獲得の判定、行動データの作成、data.js の検証（DOM非依存） |
| `ui.js` | 画面の描画（引数で受け取った値だけを使う） |
| `main.js` | ゲームの状態、入力、画面遷移 |
| `tests/acceptance.test.js` | 第12章の完了条件のうち計算で確かめられるもののテスト（data.js の検証で警告0件も確認） |
| `tests/ui.test.js` | 画面操作のテスト（連打・連戦・敗北、スマホのタップだけ・PCのキーボードだけで1サイクルなど） |
| `.github/workflows/test.yml` | push・プルリクエストのたびに両方のテストを自動実行 |

## テスト

```sh
node tests/acceptance.test.js   # 計算のテスト（Node だけで動く）

# 画面操作のテスト（初回だけ Playwright を入れる）
npm install --no-save playwright@1.63.0
npx playwright install chromium
node tests/ui.test.js
```

どちらも失敗があると終了コード1で終わります。GitHub Actions でも自動で実行されます。

ブラウザのコンソールからも直接呼べます（例）:

```js
// ファイアのダメージ（7）
const p = Battle.createUnit({ id: 'p', name: '主人公', side: 'ally', stats: DATA.player.stats });
const e = Battle.createUnit({ id: 'e', name: '試験兵', side: 'enemy', stats: DATA.enemies.soldier.stats });
Battle.calcDamage(p, e, { type: 'magic', power: 1.2 });   // → { damage: 7, effective: true }

// 通常攻撃だけで戦わせる（5ターンで勝利）
Battle.simulate([
  Battle.createUnit({ id: 'p', name: '主人公', side: 'ally', stats: DATA.player.stats, actions: Growth.toActions(['attack'], DATA) }),
  Battle.createUnit({ id: 'e', name: '試験兵', side: 'enemy', stats: DATA.enemies.soldier.stats, actions: Growth.toActions(['attack'], DATA) }),
]);

// data.js の検証（問題がなければ []）
Growth.validateData(DATA);

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
- スキル・魔法の値：`skills`。第7章のランク表（`ranks`）の範囲外だとコンソールに警告が出ます（テストでも警告0件を確認）
- 魔法にクールタイムを付ける：魔法の `cooldown` を1以上にすると、戦闘・一覧・確認表示にそのまま反映されます

## レビュー対応

不具合の修正と、将来の複数ユニット戦（第1章の将来構想）に向けた作りの改善です。
遊べる内容（1対1・試験兵のみ・セーブなし）は要件 v1.1 のままで、第10章のスコープ外の機能は入れていません。

- **不具合の修正**：使える行動がない敵（クールタイム中・MP切れ・行動なし）は「様子を見る」でターンを進め、そのときもクールタイムを減らします。以前は戦闘がそこで止まっていました（今の試験兵は通常攻撃を持っているので起きませんが、敵を変えると起きます）
- 通常攻撃は並び順ではなく `id === 'attack'` で探します（`Battle.findAction`）
- 行動データは `Growth.toAction` 1つで作り、敵と味方の両方で使います
- データ検証は `Growth.validateData` に移し、テストで警告0件を確認します
- 戦闘画面はユニットの配列から描画します。出撃時の敵は `battle.enemies`（今は `['soldier']`）で、敵が2体以上いるときは攻撃先を選べる作りになっています（テストでのみ確認。ゲームでは試験兵1体）
- テストを GitHub Actions で自動実行し、画面操作のテストを追加しました

## 要件で決まっていなかった点の扱い

- 試験兵のHPは要件どおり **30** のまま（未決事項）。28にした場合も「2連勝・3戦目は負け」が崩れないことをテストで確認済み
- 本の画面からスキルツリーへのキー操作は **Enter** にしました
- スキル獲得の確認表示は「獲得する」が最初に選ばれた状態です（←→で「やめる」に切り替え）
- 押しっぱなしによるキーの連続入力は無視します（矢印キーを除く）
- スキル獲得数には、最初から持っているファイアも数えます
