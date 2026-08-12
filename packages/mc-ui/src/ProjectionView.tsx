import { QRCodeSVG } from "qrcode.react";
import { currentWriter, type MatchState } from "@don-oogiri/engine";
import { buildAudienceUrl } from "./AudienceLink.js";
import { MarkerBar } from "./MarkerBar.js";
import { useMatchSocket } from "./useMatchSocket.js";

interface ProjectionViewProps {
  serverUrl: string;
  audienceBaseUrl: string;
  matchId: string;
}

const PHASE_LABEL: Record<MatchState["phase"], string> = {
  setup: "準備中",
  initial_writing: "両チーム執筆中",
  voting: "観客投票中",
  challenge_writing: "挑戦中",
  finished: "試合終了",
};

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

  const writer = currentWriter(state);

  return (
    <main className="projection">
      <h1 className="projection__phase">{PHASE_LABEL[state.phase]}</h1>
      <p className="projection__topic">
        <span className="projection__topic-label">お題</span>
        {state.topic}
      </p>
      <MarkerBar state={state} clockOffset={clockOffset} />
      {writer && (
        <p className="projection__writer">
          次の回答者: {writer.team === "red" ? "🔴" : "🔵"} {writer.name}
        </p>
      )}
      {state.phase === "finished" && (
        <p className="projection__winner">
          🏆 勝者: {state.winner ? state.teams[state.winner].name : "-"}
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
