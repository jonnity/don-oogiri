/**
 * ドン大喜利（どんじゃんけん形式）の状態機械の型定義。
 * spec: don-oogiri-spec.md 「1. 確定事項」を正とする。
 */

export type TeamId = "red" | "blue";

/** 各チームは3人固定。members[nextRunnerIndex] が次に執筆すべき人。 */
export interface TeamRoster {
  name: string;
  members: readonly [string, string, string];
  nextRunnerIndex: 0 | 1 | 2;
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
  | "finished";

/** 回答テキスト入力（任意機能）。MCが入力した場合のみ記録される。 */
export interface AnswerLogEntry {
  team: TeamId;
  text: string;
  recordedAt: number;
}

export interface MatchState {
  phase: Phase;
  config: MatchConfig;
  teams: Record<TeamId, TeamRoster>;
  movement: MarkerMovement;
  /** 現在「進んでる側」（暫定含む）。setup中とinitial_writingで誰も書き終えていない間はnull。 */
  advancingTeam: TeamId | null;
  /** 現在執筆すべき（あるいは執筆中の）「阻止する側」。 */
  defendingTeam: TeamId | null;
  /** initial_writingで最初に書き終えたチームが確定するまでのフラグ。 */
  initialFirstDone: boolean;
  winner: TeamId | null;
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
  /** 回答テキストの履歴（任意機能）。MCが入力した回答のみ記録される。 */
  answerLog: AnswerLogEntry[];
}

export type MatchEvent =
  | { type: "START_MATCH" }
  | { type: "FIRST_DONE"; team: TeamId; text?: string }
  | { type: "NOMINATE" }
  | { type: "ANSWER_DONE"; text?: string }
  | { type: "VOTE_RESULT"; redVotes: number; blueVotes: number }
  | { type: "AUDIENCE_VOTE_CAST"; team: TeamId }
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
