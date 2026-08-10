# ドン大喜利 (Phase 1: コアエンジン)

`don-oogiri-spec.md` / `GOAL.md` の Phase 1 定義に基づく実装。pnpm workspaceのmonorepo構成。

## パッケージ構成

- `packages/engine` — 状態機械の型定義・遷移純粋関数（DOやUIから独立）。Vitestでユニットテスト。
- `packages/server` — Hono + Cloudflare Workers + Durable Objects。1試合 = 1 DO。マーカー位置はサーバ権威（開始時刻・速度・方向のみ配信）、到達判定はDOのalarmで実行。
- `packages/mc-ui` — Vite + React。Phase 1時点では装飾なしのデバッグ用MC操作卓（演出はPhase4）。

## セットアップ・起動

```bash
pnpm install

# engineのユニットテスト
pnpm test

# サーバ (wrangler dev, http://localhost:8787)
pnpm dev:server

# MC操作卓UI (http://localhost:5173)
pnpm dev:mc-ui
```

MC操作卓UIはデフォルトで `http://localhost:8787` のサーバに接続する（`VITE_SERVER_URL` で変更可）。

## Phase 1 スコープ

`GOAL.md` の Definition of Done を満たす。観客投票UI・Tauriネイティブ化・演出・回答テキスト保存・認証/D1永続化は明示的にスコープ外（Phase 2以降）。

## 懸念点メモ（`don-oogiri-spec.md` 6. リスク・要検討 対応）

- **前進速度のバランス**: `centerToEdgeMs` は試合作成時のパラメータとして持たせてあるため定数変更は不要だが、実際の数値（何秒が適正か）はリハーサルでの検証が必要。現状はMC操作卓のフォームで試合ごとに自由に設定できる。
- **会場回線**: WebSocket切断時の自動再接続・ポーリングフォールバックはPhase 1では未実装。`useMatchSocket` は単純に `WebSocket` を張るだけで、切断後の再接続はページ側の再作成（新しい試合を作る導線）に頼っている。Phase 2（観客投票）でのスマホ再接続対応時に合わせて再接続ロジックを追加するのが妥当。
- **WebSocket Hibernation API**: 今回は不使用（通常の `accept()` ベース）。DOがエビクトされるとセッション一覧はリセットされるが、クライアントは再接続すれば最新state（DO storageから復元）を受け取れる。Phase以降で同時接続数が増えた場合に採用を検討。
