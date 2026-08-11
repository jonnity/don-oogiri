# GOAL: ドン大喜利 Phase 3 — ネイティブアプリ化

`GOAL.md`（Phase 1）と同じ位置づけのゴール定義。`don-oogiri-spec.md` の「5. ロードマップ / Phase 3」を正とする。Phase 1・Phase 2は完了済み（`README.md`参照）。

## これは何か

Phase 1で作った素朴なデバッグ用Web UI（MC操作卓）をTauriでラップし、Mac/Windows向けデスクトップアプリとして配布できるようにする。あわせて、これまで存在しなかった「投影画面（プロジェクター用画面）」を新設し、そこに観客投票ページへのQRコードを表示する。

## Phase 3のゴール（Definition of Done）

1. MC操作卓とは別に「投影画面（Projection View）」が存在し、以下を表示する：
   - チーム名・現在のフェーズ・現走者・マーカー位置（既存の`MarkerBar`を流用）
   - 観客投票ページへのURLのQRコード（画像生成APIなど外部サービスは使わず、ローカルのnpmライブラリで生成する）
2. MC操作卓アプリから投影画面を別ウィンドウ（別モニタ/プロジェクター出力用）として開ける
3. サーバURL・観客投票ページのベースURLが、`window.location.hostname`からの自動推測に固く依存しない形で解決される（Tauriのwebviewでは`location.hostname`が`tauri.localhost`等になり、これまでの自動推測ロジックが壊れるため）。未設定時はMCが明示的に入力・保存できるUIを用意する
4. `packages/mc-ui`にTauriプロジェクト一式（`src-tauri/`）が存在し、`pnpm tauri dev`でネイティブウィンドウとしてMC操作卓が起動する
5. 既存の`pnpm test`（engineのユニットテスト）は引き続きグリーン。Phase 3はUIとネイティブラッパーが中心でエンジンのロジックには手を入れない

## 明示的にスコープ外（Phase 3ではやらない）

- 投影画面の演出・アニメーション（Phase 4）
- Mac/Windows向けの実際のインストーラビルド・配布・署名。開発環境がWSL2 Linuxのため、Linux上での`tauri dev`起動確認までを本Phaseのゴールとし、Mac/Windows実機での検証は別途行う
- マーカー速度のライブ調整・手動補正・試合リセット等の運用機能（Phase 5）
- 回答テキスト入力（Phase 5）
- DOC統合（Phase 6）

## 技術方針

- `src-tauri`は新規パッケージを作らず`packages/mc-ui`配下に置く（プロジェクション画面もMC操作卓も同じVite+Reactアプリのビューとして扱うため、配線が少なくて済む）
- 投影画面はルーティングライブラリを追加せず、URLクエリ（`?view=projection&m=<matchId>`）でMC操作卓と出し分ける
- QRコード生成はローカルライブラリ（`qrcode`系）を使う。外部の画像生成API（`api.qrserver.com`等）は使わない
- サーバURL/観客URLの設定は`localStorage`に保存してよい（Tauriのwebviewでも動作するため、Phase 1の「ブラウザ依存APIに固く依存させない」指針への抵触はない。問題なのは`location.hostname`からの自動推測であり、`localStorage`自体ではない）

## 進め方への指示

- Phase 1同様、仕様同士の矛盾や明確な穴に限り立ち止まって報告する。それ以外は妥当な解釈で判断して進めてよい
- Tauriのビルド・実行に必要なシステム依存（Rust/`libwebkit2gtk`等）のインストールはsudoが必要なため、ユーザーに実行してもらう
