# ドン大喜利 (Phase 1: コアエンジン / Phase 2: 観客投票)

`don-oogiri-spec.md` / `GOAL.md` に基づく実装。pnpm workspaceのmonorepo構成。

## パッケージ構成

- `packages/engine` — 状態機械の型定義・遷移純粋関数（DOやUIから独立）。Vitestでユニットテスト。
- `packages/server` — Hono + Cloudflare Workers + Durable Objects。1試合 = 1 DO。マーカー位置はサーバ権威（開始時刻・速度・方向のみ配信）、到達判定はDOのalarmで実行。観客のWebSocketは`?voterId=`クエリ付きで同じ`/ws`エンドポイントに接続し、DOが1端末1票の重複投票をチェックする。
- `packages/mc-ui` — Vite + React。装飾なしのデバッグ用MC操作卓（演出はPhase4）。観客投票の集計表示・締め切り操作・観客投票URLの表示を含む。
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

MC操作卓・観客投票ページはいずれも、アクセスしているホスト名から自動でサーバURLを算出する（`VITE_SERVER_URL` で上書き可）。そのためlocalhost以外（WSL2の実IPなど）からアクセスしても動く。

観客投票ページは `http://<host>:5174/?m=<matchId>` で試合に参加する（QRコードでの配布はPhase3で対応、それまではMC操作卓に表示されるURLを共有する）。

## スコープ

- **Phase 1（コアエンジン）**: `GOAL.md` の Definition of Done を満たす。
- **Phase 2（観客投票）**: QR join想定の`?m=`パラメータでの参加、匿名の1端末1票（localStorageのvoterId）、リアルタイム集計、MCによる締め切り（同数票は進んでる側の勝ち）、スマホのスリープ復帰を想定した自動再接続を実装。
- 引き続きスコープ外: Tauriネイティブ化・QRコード画像生成（Phase3）、演出（Phase4）、回答テキスト保存、認証/D1永続化。

## 懸念点メモ（`don-oogiri-spec.md` 6. リスク・要検討 対応）

- **前進速度のバランス**: `centerToEdgeMs` は試合作成時のパラメータとして持たせてあるため定数変更は不要だが、実際の数値（何秒が適正か）はリハーサルでの検証が必要。現状はMC操作卓のフォームで試合ごとに自由に設定できる。
- **会場回線**: 観客投票ページ（`useAudienceSocket`）はWebSocket切断時に指数バックオフで自動再接続し、加えてタブが再びvisibleになった瞬間にも即座に再接続を試みる（スマホのスリープ復帰対策）。一方でMC操作卓（`useMatchSocket`）は単純接続のままで、切断後の再接続はページ側の再作成に頼っている。MC操作卓側の切断は稼働中のオペレーターが気づける前提で、Phase 2時点では意図的に据え置き。
- **投票の不正対策**: spec方針通り「イベント用途なので不正対策はゆるくてよい」に従い、1端末1票はDOのメモリ上のMap（voterId → 最後に投票したvotingRoundId）で担保するのみで、永続化はしていない。DOがエビクトされるとこのMapはリセットされ、ごく稀なタイミングで同一端末が1回余分に投票できる可能性があるが、許容範囲と判断。
- **得票の表示**: 観客側には得票数を表示せず「投票を受け付けました」とだけ表示している（バンドワゴン効果を避けるための判断）。MC操作卓側にはリアルタイムの生集計を表示し、締め切りタイミングの判断に使えるようにした。spec §6の「得票数の生表示か割合表示かは演出判断」に対応する暫定案。
- **WebSocket Hibernation API**: 今回は不使用（通常の `accept()` ベース）。DOがエビクトされるとセッション一覧・投票dedupの状態はリセットされるが、クライアントは再接続すれば最新state（DO storageから復元）を受け取れる。同時接続数が増えた場合に採用を検討。
