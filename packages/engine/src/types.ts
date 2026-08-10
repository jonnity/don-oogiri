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
}

export type MatchEvent =
  | { type: "START_MATCH" }
  | { type: "FIRST_DONE"; team: TeamId }
  | { type: "NOMINATE" }
  | { type: "ANSWER_DONE" }
  | { type: "VOTE_RESULT"; redVotes: number; blueVotes: number };

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTransitionError";
  }
}
