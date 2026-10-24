# PR用デモ動画

WSL2 Linuxで実際のWorkers/DO・WebSocket・React UIを使って撮影する。MC操作卓・投影画面・観客スマホをPlaywright Chromiumの独立contextで操作し、2560×1080 / 25fps / H.264 / 音声なしのMP4にする。Tauri、Windowsブラウザ、DISPLAY、WSLg、Xvfbは不要。CIの録画処理は追加していない。

## 初回セットアップ

リポジトリルートでLinux版Node 20以上とpnpmを使う。

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
sudo apt-get update
sudo apt-get install -y ffmpeg fonts-noto-cjk fonts-dejavu-core
ffmpeg -version
ffprobe -version
```

`--with-deps`にはsudoが必要な場合がある。その場合は端末から導入を済ませる。システムライブラリが導入済みなら `pnpm exec playwright install chromium` でブラウザのみ取得できる。Playwrightはpackage.jsonとlockfileで固定しており、更新後は同じコマンドで対応するブラウザを再取得する。Playwright内部の録画用ffmpegとは別に、合成にはaptのLinux版ffmpeg/ffprobe（6.1系基準）を使う。[ブラウザ導入](https://playwright.dev/docs/browsers#install-system-dependencies)・[録画の確定](https://playwright.dev/docs/videos)・[FFmpegフィルタ](https://www.ffmpeg.org/ffmpeg-filters.html)も参照。

## 撮影

```bash
pnpm demo                         # basic
pnpm demo basic
pnpm demo --list
pnpm demo issue-1-vote-change      # このspecだけを実行
pnpm demo basic --port-offset 100
pnpm demo basic --max-mib 9
pnpm demo --help
```

`basic`はフォームによる試合作成→観客参加→開始→赤が先着→指名→観客が青に投票→締切→青への反転を見せる。到達時間120秒・制限時間なしを明示する。`issue-1-vote-change`は同じ観客の赤→青への票変更（総数1を維持）と次ラウンドへの投票を確認する。

シナリオ名は `^[a-z0-9][a-z0-9-]*$`。任意パスや正規表現は指定できない。既定の専用ポートはWorkers18787、inspector19229、MC15173、観客15174。非負整数の `--port-offset` は4ポートすべてに加算する。既存開発サーバは再利用・停止しない。ViteはstrictPort、DO永続化先も実行ごとに分離する。接続先envは子プロセスで上書きするため、通常の `.env`・localStorageの編集は不要。

`--max-mib` は正数、既定9MiB（プロジェクトの配布方針。Discord全環境の上限ではない）。超える場合は解像度・時間を維持して2passを一度試す。それでも超えるなら失敗となる。シナリオを短くするか、配布先に応じて上限を調整する。ツールはsudo・ブラウザ導入・ghログイン・投稿を自動実行しない。

成功時の最終stdout行は `DEMO_VIDEO=<MP4絶対パス>`。出力先は呼び出し元に依存せずリポジトリルートの `.demo-artifacts/<UTC>-<scenario>-<random>/`。過去の成果物は上書きしない。

```text
.demo-artifacts/<run-id>/
  demo.mp4              # 共有するファイル
  manifest.json         # status、撮影時のhead/dirty、サイズ/hash、校正値
  recording.json        # fixtureの時刻・生録画の情報
  raw/*.webm            # 3本の元動画
  logs/*.log            # server / mc-ui / audience-ui / playwright / ffmpeg
  test-results/         # JSON report、失敗時のscreenshot・各画面のtrace
  work/                 # 一時MP4、ffmpegのpasslog等
  wrangler-state/       # この実行だけのDOストレージ
  share/                # 明示的な投稿時だけ作るcomment・result等
```

全成果物は共有 `.gitignore` で除外する。動画をコミットしない。不要な実行ディレクトリは、使っていないことを確認して手動で削除できる。

終了コードは成功0、シナリオ/合成等の失敗1、入力/依存/ポート等の事前条件不備2、SIGINT130、SIGTERM143、SIGHUP129。失敗時には `DEMO_VIDEO` を出さず、配布用demo.mp4を確定しない。起動したプロセスグループだけを終了する（TERM→最大5秒→KILL）。割り込み時はPlaywrightに最大10秒の保存猶予を与える。テスト120秒、本編90秒、全体480秒、各ffmpeg処理120秒を上限とする。SIGKILLやWSL強制終了では片付けを保証できないので、manifestのPIDとログを確認する。

## UI PRごとのシナリオ

UIに触るPRでは、変更内容を見せる `e2e/demo/scenarios/pr-<N>-<内容>.spec.ts` を追加し、`pnpm demo pr-<N>-<内容>` で選択して撮影する。PR番号未確定なら `issue-<N>-<内容>.spec.ts`。固定の全機能テストを毎回録画する運用ではない。specはコードとしてPRに含める。

**1spec = 1test = 1動画**。`test.only`、skip、複数test、0test、retryは成功扱いにしない。configは選択したspecだけを実行し、worker1・retry0・headless Chromiumを使う。fixtureは `../fixtures` からimportする。

```ts
import { test } from '../fixtures';

test('変更された操作を見せる', async ({ demo }) => {
  const match = await demo.createMatch({
    topic: 'こんな大会はいやだ',
    redMembers: ['赤の回答者'], blueMembers: ['青の回答者'],
    edgeToEdgeSeconds: 120, timeLimitMinutes: null,
  });
  await demo.joinAudience(match);
  await demo.startMatch();
  await demo.firstDone('red');
  await demo.hold(1200);
  await demo.nominate();
  await demo.vote('red');
  await demo.changeVote('blue');
  await demo.expectState({ audienceVotes: { red: 0, blue: 1 } });
  await demo.closeVoting();
  await demo.expectState({ phase: 'challenge_writing', advancingTeam: 'blue' });
  await demo.hold(2000);
});
```

共通操作は `createMatch / joinAudience / startMatch / firstDone / nominate / vote / changeVote / closeVoting / expectState / hold`。`pages.mc / projection / audience` でPR固有のUI操作・検証もできる。試合作成フォームの人数は両チーム同数1〜3人。`expectState` は部分的な状態かpredicateを受け、HTTP・WS・対応するUI表示を待つ。`hold`は映像を読むためだけの0〜5000ms/回の待機で、状態待機の代用にしない。

ゲーム進行や投票をAPIで直接投入しない。観客の投票済み表示は楽観的なので、投票操作は操作前からのACKとaccepted=true、サーバ集計、MC表示も待つ。vote変更では旧票を取り消した総数を確認する。同数はtie_writing。voterIdや投票済みstorageを消して票を増やさない。マーカー・到達判定は常にサーバ権威。

録画開始の黒→白校正と作成前の待機カードはfixture専用ページで、アプリに遷移する前だけ表示する。実アプリのDOM、HTTP、WebSocket、時刻を偽装しない。黒ページのload・screenshot完了後、録画と同じscreencastのフレーム到着を監視する。黒判定内の微小な明度変化とscreenshotで再描画を促し、1秒以上にわたるフレーム到着を確認してから白へ切り替える（到着待ちは最大10秒、確認した長さをcalibration.blackFrameSpanMsへ保存）。白の描画もscreenshotで促す。3録画の校正境界PTSとNode時刻で開始を補正し、共通本編長へtrimする。本編終了時刻を記録した後、3ページそれぞれでscreenshotによる強制描画と300ms待機を行い、contextを閉じる前に末尾フレームを確保する。この待機は本編長に含めない。校正往復100ms超・境界不明・1秒超の末尾不足等はエラーにする。ラベルの高さ40px、列幅1120/960/480px（スマホの縦横比維持）。成功後も動画を再生して同期と読みやすさを確認する。

## PRとDiscordへの共有

録画とは別の明示的な操作。外部へ投稿するため、対象PRと成果物を確認して実行する。

```bash
# GitHub CLIをWSLに導入して事前に実行
# gh auth login
pnpm demo:publish --pr 123 --run .demo-artifacts/<run-id>
pnpm demo:publish --pr 123 --run .demo-artifacts/<run-id> --repo owner/repo
# 作業途中の動画を意図的に共有する場合だけ
pnpm demo:publish --pr 123 --run .demo-artifacts/<run-id> --allow-dirty
pnpm demo:publish --help
```

passedのmanifest、実ファイルのサイズ/hash、撮影headとPR headの一致を検証する。撮影開始・終了のどちらかがdirty、または途中でheadが変わればdirty扱い。既定はclean必須。`--allow-dirty`でもhead不一致は拒否し、コメントには「未コミット変更を含むローカル撮影」と明記する。コメント直前にもPR headを再確認する。

同一repoの固定タグ **demo-videos** の公開prereleaseを動画置き場にする。初回にはdefault branchの公開済みSHAを参照するリモートタグとprereleaseが作られる。git pushや新commitは不要。mc-ui-v*のネイティブリリースworkflowには一致しない。draft・通常release・immutable設定なら自動変更せず失敗する。immutableの場合は別運用の合意が必要。Contents writeとPRコメントへの書き込み権限が必要。

asset名はPR・scenario・SHA・runIdを含む。`--clobber`や過去assetの自動削除は行わない。[gh release create](https://cli.github.com/manual/gh_release_create)・[upload](https://cli.github.com/manual/gh_release_upload)・[pr comment](https://cli.github.com/manual/gh_pr_comment)参照。

`share/comment.md` と `share/result.json` に本文・asset ID/URL・comment URL・head SHAを残す。アップロード後のコメント失敗は動画を保持したまま非0終了する。同じrunを再実行するとremote assetの名前/容量/digest（提供時）を照合し再利用する。全ページの自分のPRコメントからrunIdマーカーを検索し、通信断で投稿成否が曖昧でも重複を防ぐ。`--repo`はPRとReleaseの両方を指し、gh apiは明示repoパス、`gh repo view`は位置引数、それ以外は対応する `--repo` / `GH_REPO` を使う。

PRコメントはダウンロードリンクとReleaseリンクを含む。inline playerは保証しない。private repoなら閲覧側にも権限が必要。レビュアーのアカウントでリンクへ到達し、保存した動画を再生できるか確認する。

Discordのマージ承認依頼にはURLだけでなくMP4の実ファイルを渡す。

```text
harness-phase <issue> awaiting-merge --pr <PR番号> --comment-file <本文ファイル> --file <MP4絶対パス>
```

必須の `--pr` / `--comment-file` と添付の `--file` を指定する。MP4は `DEMO_VIDEO` またはmanifestのrunDir + output.fileから解決し、「最新のglob」では推測しない。アプリ側は添付用ファイルを供給する。harness環境側の設定反映・実送信は別作業であり、`pnpm demo` や `demo:publish` はDiscordへ送らない。

## 検証・トラブル対応

```bash
pnpm demo:typecheck
pnpm demo:test                    # Node test runner。投稿は偽ghのみ
pnpm -r typecheck
pnpm test:run
pnpm build
```

ポート競合は所有者を勝手に止めず、offsetを変える。Chromium不足やライブラリ不足は導入コマンドを再実行する。ffmpeg/ffprobeはPATHから解決し、必要なら `DEMO_FFMPEG_PATH` / `DEMO_FFPROBE_PATH` にLinux実行ファイルの絶対パスだけを指定できる（引数入り文字列不可）。必要フィルタやlibx264のないビルドは開始前に拒否する。

失敗したrunのmanifest.error、logs/playwright.log、各サービスログを見る。`pnpm exec playwright show-trace .demo-artifacts/<run-id>/test-results/mc-trace.zip` で失敗traceを開ける。破損した入力、黒校正なし、区間不足、容量超過では配布用MP4を成功として出さない。UI操作が変わったら共通locatorをsupport/actions.tsに閉じ込めて更新する。

自動検証だけでは判断できないもの:

- 全画面再生での日本語・ボタン・QRの読みやすさ、スクロール位置、操作間隔、反転の伝わりやすさ。
- 録画負荷による体感の同期ずれ（指名・観客ボタン表示・MC集計を比較、目標200ms以内）。
- 実PRリンクの権限・再生、Discord添付の実容量上限・表示・再生、harnessの設定反映。
- スマホカメラのQR読取、実Safari/Chromeのスリープ復帰、会場回線、プロジェクター、Tauri/WebView2。
- SIGKILL/OS強制終了時の子孫回収。
