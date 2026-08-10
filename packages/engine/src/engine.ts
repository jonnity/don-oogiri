import {
  IllegalTransitionError,
  type MatchConfig,
  type MatchEvent,
  type MatchState,
  type TeamId,
} from "./types.js";

const OTHER_TEAM: Record<TeamId, TeamId> = { red: "blue", blue: "red" };

function otherTeam(team: TeamId): TeamId {
  return OTHER_TEAM[team];
}

/** 進んでる側から見た前進方向。redは陣地端0→laneLength方向(+1)、blueはlaneLength→0方向(-1)。 */
function directionFor(advancingTeam: TeamId): 1 | -1 {
  return advancingTeam === "red" ? 1 : -1;
}

function advanceSpeed(config: MatchConfig): number {
  // 中央(laneLength/2)から端まで centerToEdgeMs かかる = 距離/時間
  return config.laneLength / 2 / config.centerToEdgeMs;
}

export interface CreateTeamInput {
  name: string;
  members: readonly [string, string, string];
}

export function createMatch(
  config: MatchConfig,
  red: CreateTeamInput,
  blue: CreateTeamInput,
): MatchState {
  if (config.laneLength <= 0 || config.centerToEdgeMs <= 0) {
    throw new IllegalTransitionError(
      "laneLength and centerToEdgeMs must be positive",
    );
  }
  return {
    phase: "setup",
    config,
    teams: {
      red: { name: red.name, members: red.members, nextRunnerIndex: 0 },
      blue: { name: blue.name, members: blue.members, nextRunnerIndex: 0 },
    },
    movement: { status: "idle" },
    advancingTeam: null,
    defendingTeam: null,
    initialFirstDone: false,
    winner: null,
  };
}

/** マーカーの現在位置を計算する（クライアント側の補間描画と同じロジック）。 */
export function getMarkerPosition(state: MatchState, now: number): number {
  const { movement, config } = state;
  if (movement.status === "idle") {
    return config.laneLength / 2;
  }
  if (movement.status === "frozen") {
    return movement.position;
  }
  const speed = advanceSpeed(config);
  const elapsed = Math.max(0, now - movement.startTime);
  const raw = movement.startPosition + movement.direction * speed * elapsed;
  return clamp(raw, 0, config.laneLength);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** advancing中のマーカーが端に到達する予定時刻。advancing中でなければnull。 */
export function nextArrivalTime(state: MatchState): number | null {
  const { movement, config } = state;
  if (movement.status !== "advancing") return null;
  const speed = advanceSpeed(config);
  const distanceToEdge =
    movement.direction === 1
      ? config.laneLength - movement.startPosition
      : movement.startPosition;
  const timeToArrive = Math.max(0, distanceToEdge) / speed;
  return movement.startTime + timeToArrive;
}

/** advancing中のマーカーが現在時刻nowまでに端へ到達していれば即finishedにする。 */
export function checkArrival(state: MatchState, now: number): MatchState {
  if (state.phase === "finished") return state;
  if (state.movement.status !== "advancing") return state;
  const position = getMarkerPosition(state, now);
  if (position <= 0 || position >= state.config.laneLength) {
    return {
      ...state,
      phase: "finished",
      winner: state.advancingTeam,
      movement: { status: "frozen", position },
    };
  }
  return state;
}

function startAdvancing(
  state: MatchState,
  advancingTeam: TeamId,
  startPosition: number,
  now: number,
): MatchState {
  const next: MatchState = {
    ...state,
    advancingTeam,
    defendingTeam: otherTeam(advancingTeam),
    movement: {
      status: "advancing",
      startPosition,
      startTime: now,
      direction: directionFor(advancingTeam),
    },
  };
  return checkArrival(next, now);
}

function applyStartMatch(state: MatchState): MatchState {
  if (state.phase !== "setup") {
    throw new IllegalTransitionError(
      `START_MATCH is only valid in 'setup', got '${state.phase}'`,
    );
  }
  return { ...state, phase: "initial_writing" };
}

function applyFirstDone(state: MatchState, team: TeamId, now: number): MatchState {
  if (state.phase !== "initial_writing") {
    throw new IllegalTransitionError(
      `FIRST_DONE is only valid in 'initial_writing', got '${state.phase}'`,
    );
  }
  if (state.initialFirstDone) {
    throw new IllegalTransitionError(
      "FIRST_DONE was already recorded for this match",
    );
  }
  const withFlag: MatchState = { ...state, initialFirstDone: true };
  return startAdvancing(withFlag, team, state.config.laneLength / 2, now);
}

function applyNominate(state: MatchState, now: number): MatchState {
  const inWritingPhase =
    state.phase === "initial_writing" || state.phase === "challenge_writing";
  if (!inWritingPhase || state.movement.status !== "advancing") {
    throw new IllegalTransitionError(
      `NOMINATE requires an advancing marker in initial_writing/challenge_writing, got phase='${state.phase}' movement='${state.movement.status}'`,
    );
  }
  const position = getMarkerPosition(state, now);
  return {
    ...state,
    movement: { status: "frozen", position },
  };
}

function applyAnswerDone(state: MatchState): MatchState {
  const inWritingPhase =
    state.phase === "initial_writing" || state.phase === "challenge_writing";
  if (!inWritingPhase || state.movement.status !== "frozen") {
    throw new IllegalTransitionError(
      `ANSWER_DONE requires a frozen marker (after NOMINATE) in initial_writing/challenge_writing, got phase='${state.phase}' movement='${state.movement.status}'`,
    );
  }
  return { ...state, phase: "voting" };
}

function incrementRunner(state: MatchState, team: TeamId): MatchState {
  const roster = state.teams[team];
  const nextRunnerIndex = ((roster.nextRunnerIndex + 1) % 3) as 0 | 1 | 2;
  return {
    ...state,
    teams: {
      ...state.teams,
      [team]: { ...roster, nextRunnerIndex },
    },
  };
}

function applyVoteResult(
  state: MatchState,
  redVotes: number,
  blueVotes: number,
  now: number,
): MatchState {
  if (state.phase !== "voting") {
    throw new IllegalTransitionError(
      `VOTE_RESULT is only valid in 'voting', got '${state.phase}'`,
    );
  }
  if (redVotes < 0 || blueVotes < 0) {
    throw new IllegalTransitionError("vote counts must be non-negative");
  }
  const advancingTeam = state.advancingTeam;
  const defendingTeam = state.defendingTeam;
  if (!advancingTeam || !defendingTeam) {
    throw new IllegalTransitionError(
      "VOTE_RESULT requires advancingTeam and defendingTeam to be set",
    );
  }
  const advancingVotes = advancingTeam === "red" ? redVotes : blueVotes;
  const defendingVotes = defendingTeam === "red" ? redVotes : blueVotes;
  // 同数票は進んでる側の勝ち（阻止する側は上回る必要がある）
  const defendingWins = defendingVotes > advancingVotes;
  const frozenPosition =
    state.movement.status === "frozen"
      ? state.movement.position
      : getMarkerPosition(state, now);

  if (!defendingWins) {
    // 進んでる側の勝ち: そのままchallenge_writing継続。負けた阻止側の次走者が執筆。
    const withNextRunner = incrementRunner(state, defendingTeam);
    const resumed = startAdvancing(
      withNextRunner,
      advancingTeam,
      frozenPosition,
      now,
    );
    return { ...resumed, phase: "challenge_writing" };
  }

  // 阻止する側の勝ち（反転）: この位置から反転。負けた側(旧advancing)の次走者が新defenderとして執筆。
  const withNextRunner = incrementRunner(state, advancingTeam);
  const reversed = startAdvancing(
    withNextRunner,
    defendingTeam,
    frozenPosition,
    now,
  );
  return { ...reversed, phase: "challenge_writing" };
}

/** 状態機械の唯一のエントリポイント。不正な遷移は IllegalTransitionError を投げる。 */
export function transition(
  state: MatchState,
  event: MatchEvent,
  now: number,
): MatchState {
  // 前進中の端到達は最優先: 「前進中いつでも、マーカーが相手陣地の端に到達した瞬間に確定（投票を待たない）」
  // 到達によってfinishedになった場合は、元のイベントより到達確定を優先して即返す。
  const current = checkArrival(state, now);
  if (current.phase === "finished" && state.phase !== "finished") {
    return current;
  }
  switch (event.type) {
    case "START_MATCH":
      return applyStartMatch(current);
    case "FIRST_DONE":
      return applyFirstDone(current, event.team, now);
    case "NOMINATE":
      return applyNominate(current, now);
    case "ANSWER_DONE":
      return applyAnswerDone(current);
    case "VOTE_RESULT":
      return applyVoteResult(current, event.redVotes, event.blueVotes, now);
    default: {
      const _exhaustive: never = event;
      throw new IllegalTransitionError(
        `Unknown event: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/** 次に執筆すべき人（表示用）。該当者がいなければnull。 */
export function currentWriter(
  state: MatchState,
): { team: TeamId; name: string } | null {
  if (state.phase === "initial_writing") {
    if (!state.initialFirstDone) return null; // 両チーム同時執筆中で特定不可
    const defending = state.defendingTeam;
    if (!defending) return null;
    const roster = state.teams[defending];
    return { team: defending, name: roster.members[roster.nextRunnerIndex] };
  }
  if (state.phase === "challenge_writing") {
    const defending = state.defendingTeam;
    if (!defending) return null;
    const roster = state.teams[defending];
    return { team: defending, name: roster.members[roster.nextRunnerIndex] };
  }
  return null;
}
