# デプロイ手順（Phase 6: 実戦投入）

`don-oogiri-spec.md` 5章 Phase 6（実戦投入 → DOC統合検討）に対応する、実際に会場でこのツールを動かすための手順。身内リハ・イベント本番のいずれもこの手順で立てたインフラ上で行う想定。

## 現在の本番URL

server・audience-uiはデプロイ済み（2026-08-13）。

- サーバ: `https://don-oogiri-server.jonny1996-ty.workers.dev`
- 観客投票ページ: `https://don-oogiri-audience.pages.dev`

以降の`<SERVER_URL>` / `<AUDIENCE_URL>`はこの値。再デプロイ時に値が変わった場合はこの節を更新すること。

## 全体構成

| コンポーネント | 配布先 | 理由 |
|---|---|---|
| `packages/server`（Hono + Durable Objects） | Cloudflare Workers | 唯一の状態権威。WebSocket + Durable Objectをホストできるのは実質Workersのみ |
| `packages/audience-ui`（観客投票ページ） | Cloudflare Pages | 静的サイト。観客のスマホがQRから直接アクセスする |
| `packages/mc-ui`（MC操作卓） | Tauriデスクトップアプリ（会場PCにインストール） | Phase 3のゴール通り、会場PC1台にインストールしたアプリで完結させる。動作確認だけならブラウザ版でも可（下記オプションA） |

デプロイ順序は **server → audience-ui → mc-ui** 固定。`audience-ui`のビルド時に`VITE_SERVER_URL`をビルド成果物へ焼き込む（`packages/audience-ui/src/serverUrl.ts`）ため、サーバのURLが先に確定していないとビルドし直しになる。

## 前提: Cloudflareへのログイン

```bash
pnpm --filter @don-oogiri/server exec wrangler login
```

ブラウザでのOAuth承認が必要なため、ユーザー自身が実行すること。ログイン後、以降の`wrangler`コマンドはこのマシンから叩ける（完了済み）。

## 1. サーバ（Cloudflare Workers + Durable Objects）

```bash
pnpm --filter @don-oogiri/server run deploy
```

- `wrangler.toml`の設定（`new_sqlite_classes = ["MatchRoom"]`）によりDurable ObjectsはSQLiteバックエンドで作成される。無料プランでも利用可能な形式。
- 追加のシークレットや環境変数は不要（`Env`は`MATCH_ROOM`バインディングのみ）。
- デプロイ完了時に表示される`https://don-oogiri-server.<your-subdomain>.workers.dev`を控える。以降これを`<SERVER_URL>`と呼ぶ（現在の値は上記「現在の本番URL」参照）。
- カスタムドメインを使う場合は`wrangler.toml`に`[[routes]]`を追加するか、Cloudflareダッシュボードの当該Workerの「Triggers」からドメインを割り当てる（本手順では省略、workers.devの既定URLで十分機能する）。

## 2. 観客投票ページ（Cloudflare Pages）

```bash
VITE_SERVER_URL=<SERVER_URL> pnpm --filter @don-oogiri/audience-ui run build
# wranglerは@don-oogiri/serverにのみ devDependency として入っているため、そちら経由で実行する
# 初回のみ: プロジェクト作成
pnpm --filter @don-oogiri/server exec wrangler pages project create don-oogiri-audience --production-branch=main
pnpm --filter @don-oogiri/server exec wrangler pages deploy ../audience-ui/dist --project-name=don-oogiri-audience --commit-dirty=true
```

- リポジトリがgitリポジトリでuncommittedな変更がある状態でデプロイすると警告が出るため`--commit-dirty=true`を付けている（デプロイ自体には影響しない、警告を黙らせるだけ）。

- デプロイ完了時に表示される`https://don-oogiri-audience.pages.dev`（または割り当てたカスタムドメイン）を控える。以降これを`<AUDIENCE_URL>`と呼ぶ（現在の値は上記「現在の本番URL」参照）。
- リハーサルとイベント本番で同じプロジェクトに`wrangler pages deploy`し続けて問題ない（Pagesは自動でデプロイ履歴を残す）。プロジェクト作成は初回のみでよい。
- 初回デプロイ直後は`don-oogiri-audience.pages.dev`が一時的に522（オリジン未伝播）を返すことがある。数十秒待って再アクセスすれば解消する。

## 3. MC操作卓

### オプションA: ブラウザ版でそのまま動作確認（追加ビルド不要・最速）

`packages/mc-ui`の接続設定画面（Tauri未検出時は`location.hostname`から自動推測、明示設定も可）から`<SERVER_URL>`・`<AUDIENCE_URL>`を入力すればブラウザでも進行できる。ネイティブアプリの動作確認前にサーバ/観客ページ疎通を確認する用途に向く。

```bash
pnpm --filter @don-oogiri/mc-ui run dev
# または本番ビルドをローカルでプレビュー
pnpm --filter @don-oogiri/mc-ui run build
pnpm --filter @don-oogiri/mc-ui run preview
```

### オプションB: Tauriネイティブアプリをビルド（会場PCと同じOS上で実行する場合）

開発機がWSL2 Linuxのため、Mac/Windows向けインストーラはそれぞれのOS上でのみビルドできる（クロスコンパイル不可）。会場で使うPCがWindowsなら、そのPC自体（またはWindows環境）で以下を実行するのが最短:

```bash
pnpm install
VITE_SERVER_URL=<SERVER_URL> VITE_AUDIENCE_URL=<AUDIENCE_URL> pnpm --filter @don-oogiri/mc-ui exec tauri build
```

生成物は`packages/mc-ui/src-tauri/target/release/bundle/`配下（Windowsなら`msi`/`nsis`、Macなら`dmg`/`macos`）。

Tauriのビルドには各OSのシステム依存関係が必要（[Tauri Prerequisites](https://tauri.app/start/prerequisites/)参照）。

このビルドコマンド自体はLinux向け（`.deb`）で実際に検証済み（本番URLが正しくフロントエンドに焼き込まれた状態でビルド成功を確認）。`tauri.conf.json`の`build.beforeBuildCommand`が`tauri build`実行前にVite側の本番ビルドを自動で走らせる設定になっているため、Mac/Windows上でも同じコマンドで同様に動くはず。

### オプションC: GitHub Actionsでmac/windows両方のインストーラをビルド（推奨・追加した）

`.github/workflows/tauri-build.yml`を追加した。手元にMac/Windows実機がなくても、GitHub Actionsのホストランナー上でネイティブビルドできる。

- 手動実行: GitHubリポジトリの Actions タブ → `Build Tauri MC App` → `Run workflow`
- または`mc-ui-v*`形式のタグをpushすると自動実行（例: `git tag mc-ui-v0.1.0 && git push origin mc-ui-v0.1.0`）
- `VITE_SERVER_URL` / `VITE_AUDIENCE_URL`はワークフロー実行時の入力（`workflow_dispatch`のinputs）から渡す設計にしてある。値を空のまま実行すると、ビルドされたアプリは初回起動時に接続設定画面での手入力を要求する（`resolveServerUrl`が`null`を返すため）。
- 成果物はGitHub Releasesのドラフトとしてアップロードされる（`releaseDraft: true`）。ビルド確認後に手動でPublishすること。
- **一部未検証**: `beforeBuildCommand`によるフロントエンドビルド連動とTauriバンドル自体はLinux上での実ビルドで確認済み（オプションB参照）。ただしこのワークフロー自体（GitHub Actions環境固有のセットアップ）は実行確認できていない。初回実行時にRust/pnpmのバージョン起因で微調整が必要になる可能性がある。

## 4. イベント当日チェックリスト

1. サーバが応答するか確認: `curl <SERVER_URL>/`（`{"name":"don-oogiri-server","status":"ok",...}`が返ればOK）
2. MC操作卓の接続設定で`<SERVER_URL>`・`<AUDIENCE_URL>`が正しく設定されているか確認
3. 試合を1件作成し、投影画面のQRコードをスマホで読み取って観客投票ページに到達できるか確認（会場のWi-Fi/回線でのテスト必須。`don-oogiri-spec.md` 6章の「会場回線」リスクに対応）
4. リハーサルでは`SET_SPEED_MULTIPLIER`（Phase 5で実装済み）で前進速度を早送りし、フロー全体を素早く通しで確認する
5. 本番前に`RESET_MATCH`でリハーサル分の状態をクリアする（チーム名・お題・パラメータは維持されるので再入力不要）

## 5. Phase 6後半: DOC統合検討

本番後に評価する項目（現時点では未着手）:
- DOCの認証基盤への統合要否
- 試合履歴の永続化（D1）要否
- 複数試合の同時進行・会場外からの閲覧など、単発イベントを超えた運用要件の有無

この節はイベント本番の結果を踏まえて追記する。
