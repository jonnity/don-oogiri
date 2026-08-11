# ドン大喜利 (Phase 1: コアエンジン / Phase 2: 観客投票 / Phase 3: ネイティブアプリ化)

`don-oogiri-spec.md` / `GOAL.md` / `GOAL_PHASE3.md` に基づく実装。pnpm workspaceのmonorepo構成。

## パッケージ構成

- `packages/engine` — 状態機械の型定義・遷移純粋関数（DOやUIから独立）。Vitestでユニットテスト。
- `packages/server` — Hono + Cloudflare Workers + Durable Objects。1試合 = 1 DO。マーカー位置はサーバ権威（開始時刻・速度・方向のみ配信）、到達判定はDOのalarmで実行。観客のWebSocketは`?voterId=`クエリ付きで同じ`/ws`エンドポイントに接続し、DOが1端末1票の重複投票をチェックする。
- `packages/mc-ui` — Vite + React。装飾なしのデバッグ用MC操作卓（演出はPhase4）。観客投票の集計表示・締め切り操作・観客投票URLの表示に加え、投影画面（`?view=projection`）とTauriラッパー（`src-tauri/`）を含む。
- `packages/audience-ui` — Vite + React。スマホ向けの観客投票ページ（ネイティブ化しない、Webのみ）。

## セットアップ・起動

```bash
pnpm install

# engineのユニットテスト
pnpm test

# サーバ + MC操作卓UI + 観客投票UIを同時起動
# (http://localhost:8787 / http://localhost:5173 / http://localhost:5174)
pnpm dev

# 個別に起動したい場合
pnpm dev:server
pnpm dev:mc-ui
pnpm dev:audience-ui
```

MC操作卓・観客投票ページはいずれも、アクセスしているホスト名から自動でサーバURLを算出する（`VITE_SERVER_URL` で上書き可）。そのためlocalhost以外（WSL2の実IPなど）からアクセスしても動く。ただしTauriアプリ版のMC操作卓では`location`からの自動推測ができないため、初回起動時に「接続設定」画面でサーバURL・観客投票ページURLを明示的に入力する（`localStorage`に保存され、以後は自動で使われる。MC操作卓画面の「接続設定を変更」からいつでも編集可）。

観客投票ページは `http://<host>:5174/?m=<matchId>` で試合に参加する。MC操作卓の投影画面にはこのURLのQRコードが表示される。

### Tauriネイティブアプリ（Phase 3）

```bash
# 初回のみ: Rustツールチェーンと、Linuxならビルド用のシステムライブラリが必要
# https://tauri.app/start/prerequisites/ を参照
# (Debian/Ubuntu系の例: libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libgtk-3-dev build-essential)

pnpm tauri:dev    # ネイティブウィンドウでMC操作卓を起動（サーバは別途 pnpm dev:server で起動しておく）
pnpm tauri:build  # インストーラのビルド
```

MC操作卓のネイティブウィンドウから「投影画面を開く」ボタンで、プロジェクター/別モニタ用の投影画面を別ウィンドウとして開ける（Rust側の`open_projection_window`コマンドがウィンドウ生成を担当し、既に開いていればフォーカスするだけにする）。投影画面はチーム名・フェーズ・マーカー位置・観客投票URLのQRコードを表示する（装飾はPhase4）。

`src-tauri/`は`packages/mc-ui`配下に置いている（投影画面もMC操作卓も同じVite+Reactアプリのビューの一つとして扱っているため）。

## スコープ

- **Phase 1（コアエンジン）**: `GOAL.md` の Definition of Done を満たす。
- **Phase 2（観客投票）**: QR join想定の`?m=`パラメータでの参加、匿名の1端末1票（localStorageのvoterId）、リアルタイム集計、MCによる締め切り（同数票は進んでる側の勝ち）、スマホのスリープ復帰を想定した自動再接続を実装。
- **Phase 3（ネイティブアプリ化）**: `GOAL_PHASE3.md` の Definition of Done を満たす。MC操作卓のTauriラップ、投影画面の新設とQRコード表示、接続設定のTauri対応。開発環境がWSL2 LinuxのためMac/Windows実機でのインストーラ検証は未実施（Linux上での`tauri dev`起動確認まで）。
- 引き続きスコープ外: 投影画面の演出・アニメーション、Mac/Windows実機でのインストーラビルド・配布・署名（Phase4以降）、マーカー速度のライブ調整・手動補正・試合リセット（Phase5）、回答テキスト保存（Phase5）、認証/D1永続化、DOC統合（Phase6）。

## 懸念点メモ（`don-oogiri-spec.md` 6. リスク・要検討 対応）

- **前進速度のバランス**: `centerToEdgeMs` は試合作成時のパラメータとして持たせてあるため定数変更は不要だが、実際の数値（何秒が適正か）はリハーサルでの検証が必要。現状はMC操作卓のフォームで試合ごとに自由に設定できる。
- **会場回線**: 観客投票ページ（`useAudienceSocket`）はWebSocket切断時に指数バックオフで自動再接続し、加えてタブが再びvisibleになった瞬間にも即座に再接続を試みる（スマホのスリープ復帰対策）。一方でMC操作卓（`useMatchSocket`）は単純接続のままで、切断後の再接続はページ側の再作成に頼っている。MC操作卓側の切断は稼働中のオペレーターが気づける前提で、Phase 2時点では意図的に据え置き。
- **投票の不正対策**: spec方針通り「イベント用途なので不正対策はゆるくてよい」に従い、1端末1票はDOのメモリ上のMap（voterId → 最後に投票したvotingRoundId）で担保するのみで、永続化はしていない。DOがエビクトされるとこのMapはリセットされ、ごく稀なタイミングで同一端末が1回余分に投票できる可能性があるが、許容範囲と判断。
- **得票の表示**: 観客側には得票数を表示せず「投票を受け付けました」とだけ表示している（バンドワゴン効果を避けるための判断）。MC操作卓側にはリアルタイムの生集計を表示し、締め切りタイミングの判断に使えるようにした。spec §6の「得票数の生表示か割合表示かは演出判断」に対応する暫定案。
- **WebSocket Hibernation API**: 今回は不使用（通常の `accept()` ベース）。DOがエビクトされるとセッション一覧・投票dedupの状態はリセットされるが、クライアントは再接続すれば最新state（DO storageから復元）を受け取れる。同時接続数が増えた場合に採用を検討。
