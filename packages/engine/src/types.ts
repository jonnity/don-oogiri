/**
 * ドン大喜利（どんじゃんけん形式）の状態機械の型定義。
 * spec: don-oogiri-spec.md 「1. 確定事項」を正とする。
 */

export type TeamId = "red" | "blue";

/** 各チームは1〜3人（タイマン〜3人チーム）。members[nextRunnerIndex] が次に執筆すべき人。 */
export interface TeamRoster {
  name: string;
  members: readonly string[];
  nextRunnerIndex: number;
}

export interface MatchConfig {
  /** レーン全長（0 = redの陣地端、laneLength = blueの陣地端、laneLength/2 = 中央） */
  laneLength: number;
  /** 中央から端まで到達するのにかかる時間（ms）。前進速度はこれで一意に決まる。 */
  centerToEdgeMs: number;
}

/** マーカーの動き。サーバ権威: advancing中はstartTime+速度+方向のみを保持し、現在位置はクライアント側で補間する。 */
export type MarkerMovement =
  | { status: "idle" }
  | {
      status: "advancing";
      startPosition: number;
      startTime: number;
      direction: 1 | -1;
    }
  | { status: "frozen"; position: number };

export type Phase =
  | "setup"
  | "initial_writing"
  | "voting"
  | "challenge_writing"
  /** 観客投票が同数だった場合の「防衛成功」状態。同じ顔合わせが続かないよう両チームとも
   * 次走者に交代し、initial_writingと同じ「両チーム同時執筆」の形でゼロから書き直す。
   * 開始位置は同数になった時点のマーカー位置（中央ではない）。 */
  | "tie_writing"
  | "finished";

export interface MatchState {
  phase: Phase;
  config: MatchConfig;
  teams: Record<TeamId, TeamRoster>;
  movement: MarkerMovement;
  /** 現在「進んでる側」（暫定含む）。setup中とinitial_writing/tie_writingで誰も書き終えていない間はnull。 */
  advancingTeam: TeamId | null;
  /** 現在執筆すべき（あるいは執筆中の）「阻止する側」。 */
  defendingTeam: TeamId | null;
  /** initial_writing/tie_writingで最初に書き終えたチームが確定するまでのフラグ。両フェーズで共用する。 */
  bothWritingFirstDone: boolean;
  winner: TeamId | null;
  /**
   * 「今の回答者」＝各チームの現在アクティブな回答（進んでる側の現チャンピオン回答、または
   * 阻止する側の直近の挑戦回答）を書いたメンバー名。FIRST_DONE/NOMINATEで更新される。
   * まだ誰も書き終えていなければnull。
   */
  currentAnswerer: Record<TeamId, string | null>;
  /** 観客投票の現在ラウンドの集計。votingフェーズ開始のたびに0にリセットされる。 */
  audienceVotes: Record<TeamId, number>;
  /** 投票ラウンドの識別子。votingフェーズに入るたびに+1。観客側の「このラウンドは投票済みか」判定に使う。 */
  votingRoundId: number;
  /** この試合のお題。1試合1お題固定（spec通り）だが、誤字修正のためSET_TOPICで訂正可能。 */
  topic: string;
  /** 投影画面のQRコード表示状態。常時表示ではなく、MCが必要なタイミングだけ表示する運用を想定。 */
  qrVisible: boolean;
  /** 前進速度の倍率（デフォルト1）。config.centerToEdgeMsは変えずに、ライブ調整・リハーサル早送りに使う。 */
  speedMultiplier: number;
}

export type MatchEvent =
  | { type: "START_MATCH" }
  | { type: "FIRST_DONE"; team: TeamId }
  /**
   * 阻止する側の前進停止と投票開始を1アクションで行う。回答完了とnominateの間に
   * 挟むワンクッションは運用上不要と判断し、ANSWER_DONEと統合した（旧仕様は分離していた）。
   */
  | { type: "NOMINATE" }
  | { type: "VOTE_RESULT"; redVotes: number; blueVotes: number }
  /** previousTeamは同一投票ラウンド内で票を変更する場合に指定する（旧選択を取り消して新選択に付け替える）。 */
  | { type: "AUDIENCE_VOTE_CAST"; team: TeamId; previousTeam?: TeamId }
  | { type: "CLOSE_VOTING" }
  | { type: "SET_TOPIC"; topic: string }
  | { type: "SET_QR_VISIBLE"; visible: boolean }
  | { type: "SET_SPEED_MULTIPLIER"; multiplier: number }
  | { type: "CORRECT_MARKER_POSITION"; position: number }
  | { type: "RESET_MATCH" };

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTransitionError";
  }
}
