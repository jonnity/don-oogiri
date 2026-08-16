import { QRCodeSVG } from "qrcode.react";
import { currentWriters, type TeamId } from "@don-oogiri/engine";
import { buildAudienceUrl } from "./AudienceLink.js";
import { MarkerBar } from "./MarkerBar.js";
import { MatchTimer } from "./MatchTimer.js";
import { useMatchSocket } from "./useMatchSocket.js";

interface ProjectionViewProps {
  serverUrl: string;
  audienceBaseUrl: string;
  matchId: string;
}

/**
 * プロジェクター投影用の画面（装飾はPhase4）。会場の別モニタ/プロジェクターに
 * 表示する想定で、MC操作卓の入力UIは持たず状態の閲覧とQRコード表示のみ行う。
 */
export function ProjectionView({ serverUrl, audienceBaseUrl, matchId }: ProjectionViewProps) {
  const { state, clockOffset, status } = useMatchSocket(serverUrl, matchId);
  const audienceUrl = buildAudienceUrl(audienceBaseUrl, matchId);

  if (!state) {
    return (
      <main className="projection">
        <p>状態を読み込み中... (接続: {status})</p>
      </main>
    );
  }

  const writers = currentWriters(state);
  const nextWriterFor = (team: TeamId) => writers.find((w) => w.team === team)?.name ?? null;

  return (
    <main className="projection">
      <div className="projection__timer">
        <MatchTimer state={state} clockOffset={clockOffset} />
      </div>
      <p className="projection__topic">
        <span className="projection__topic-label">お題</span>
        {state.topic}
      </p>
      <MarkerBar state={state} clockOffset={clockOffset} />
      <div className="projection__next-writers">
        <div className="projection__next-writer projection__next-writer--red">
          <span className="projection__next-writer-label">次の回答者</span>
          <span className="projection__next-writer-name">{nextWriterFor("red") ?? "-"}</span>
        </div>
        <div className="projection__next-writer projection__next-writer--blue">
          <span className="projection__next-writer-label">次の回答者</span>
          <span className="projection__next-writer-name">{nextWriterFor("blue") ?? "-"}</span>
        </div>
      </div>
      {state.phase === "finished" && (
        <p className="projection__winner">
          {state.winner ? `🏆 勝者: ${state.teams[state.winner].name}` : "🤝 引き分け"}
          {state.matchEndReason === "time_limit" && "（時間切れ）"}
        </p>
      )}
      {state.qrVisible && (
        <div className="projection__qr">
          <QRCodeSVG value={audienceUrl} size={200} />
          <p>スマホで投票に参加</p>
        </div>
      )}
    </main>
  );
}
