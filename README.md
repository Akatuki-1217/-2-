# 戦略RPG（MVP）

「戦闘する → 報酬で強化する → また戦闘する」の基本サイクルを、コマンドバトルで遊べるブラウザゲームです。
要件定義書 v1.1 に沿って作り、その後のレビューで出た改善（下の「MVPからの変更点」）を入れています。

## 遊び方

`index.html` をブラウザで開くだけで動きます（ビルド・サーバー不要）。スマホ縦画面・PC両対応。
進み具合はこのブラウザに自動で保存され、次に開くと拠点から続きを遊べます（本の画面の「データを消して最初から」で消せます）。

| 画面 | スマホ | PC |
| --- | --- | --- |
| 拠点 | 「出撃」「本」をタップ | Enter＝出撃、Esc＝本 |
| 出撃先 | 行き先をタップ、「戻る」 | ↑↓＋Enter、Esc＝拠点 |
| 戦闘 | 攻撃／魔法／スキルをタップ → 一覧からタップ、「戻る」 | A＝攻撃、W＝魔法、S＝スキル、一覧は ↑↓＋Enter、Esc で閉じる |
| 攻撃先の選択（敵が2体以上） | 敵のパネルをタップ、「戻る」 | ←→（↑↓）＋Enter、Esc で戻る |
| 敗北表示 | タップ | Enter |
| 結果画面 | 「次の戦闘へ」「拠点に戻る」 | 矢印で選んで Enter |
| 本（ステータス） | 「スキルツリー」「戻る」 | Enter＝スキルツリー、Esc＝拠点 |
| スキルツリー | スキルをタップ → 「獲得する／やめる」 | 矢印で選んで Enter、確認は ←→＋Enter、Esc で戻る |

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` / `style.css` | 画面の骨組みと見た目 |
| `data.js` | 能力値・魔法・スキル・敵・出撃先・スキルツリー・成長ルール・ランク表・演出時間 |
| `battle.js` | 戦闘計算（DOM非依存）：ダメージ、回復、行動順、撃破判定、クールタイム、自動行動 |
| `growth.js` | 経験値・Lvアップ・スキル獲得・出撃先の解放・セーブデータ・data.js の検証（DOM非依存） |
| `ui.js` | 画面の描画（引数で受け取った値だけを使う） |
| `main.js` | ゲームの状態、入力、画面遷移、保存 |
| `tests/acceptance.test.js` | 計算で確かめられるもののテスト（完了条件・data.js の検証で警告0件など） |
| `tests/ui.test.js` | 画面操作のテスト（ブラウザで実際にクリック・キー入力する） |
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
- 敵を増やす：`enemies` に追加。`actions` は上から順に優先して使い、回復は味方のHPが `battle.aiHealBelow`（6割）未満のときだけ使います
- 出撃先を増やす：`encounters` に追加。`enemies` に同じ敵を並べると複数体、`requires` のステージをクリアすると解放されます

## 敵と出撃先

| 出撃先 | 推奨Lv | 敵 | ねらい |
| --- | --- | --- | --- |
| 訓練場 | 1 | 試験兵 | MVPの基準の敵（通常攻撃のみ） |
| 森の小道 | 2 | 斥候兵 ×2 | 複数の敵。どちらから倒すかを選ぶ |
| 見張り塔 | 3 | 見張りの弓兵・見習い僧 | 見習い僧が仲間を回復する。回復役を先に倒さないと長引く |
| 古い砦 | 4 | 見習い僧・砦の隊長 | 隊長の兜割り（大ダメージ・クールタイム2）を回復でしのぐ |

追加したスキル：癒しの光（回復・D）→ 命の泉（回復・C）をスキルツリー「癒し」で覚えられます。敵専用の技として狙い撃ち・兜割りがあります。

## MVPからの変更点（レビュー対応）

- 使える行動がない敵（クールタイム中・MP切れ・行動なし）は「様子を見る」でターンを進めます。以前は戦闘がそこで止まっていました
- 通常攻撃は並び順ではなく `id === 'attack'` で探します
- 行動データは `Growth.toAction` 1つで作り、敵と味方の両方で使います
- データ検証は `Growth.validateData` に移し、テストで警告0件を確認します
- 戦闘画面はユニットの配列から描画し、敵が複数なら攻撃先を選べます
- セーブ機能を追加しました（要件 v1.1 では「セーブなし」でしたが、ステージが増えて続けて遊ぶ前提になったため変更）

## 要件で決まっていなかった点の扱い

- 試験兵のHPは要件どおり **30** のまま（未決事項）。28にした場合も「2連勝・3戦目は負け」が崩れないことをテストで確認済み
- 本の画面からスキルツリーへのキー操作は **Enter** にしました
- スキル獲得の確認表示は「獲得する」が最初に選ばれた状態です（←→で「やめる」に切り替え）
- 押しっぱなしによるキーの連続入力は無視します（矢印キーを除く）
- スキル獲得数には、最初から持っているファイアも数えます
- 保存データを読み直したときは拠点から再開するので、HP・MPは全回復します
- 「次の戦闘へ」は同じ出撃先にもう一度出撃します
