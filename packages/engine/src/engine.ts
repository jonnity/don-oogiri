import {
  IllegalTransitionError,
  type AnswerLogEntry,
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

/** speedMultiplierはconfig.centerToEdgeMsを変更せずに前進速度を調整するための倍率（ライブ調整・リハーサル早送り用）。 */
function advanceSpeed(config: MatchConfig, speedMultiplier: number): number {
  // 中央(laneLength/2)から端まで centerToEdgeMs かかる = 距離/時間
  return (config.laneLength / 2 / config.centerToEdgeMs) * speedMultiplier;
}

export interface CreateTeamInput {
  name: string;
  members: readonly [string, string, string];
}

export function createMatch(
  config: MatchConfig,
  red: CreateTeamInput,
  blue: CreateTeamInput,
  topic: string,
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
    audienceVotes: { red: 0, blue: 0 },
    votingRoundId: 0,
    topic,
    qrVisible: true,
    speedMultiplier: 1,
    answerLog: [],
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
  const speed = advanceSpeed(config, state.speedMultiplier);
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
  const speed = advanceSpeed(config, state.speedMultiplier);
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

function applyFirstDone(
  state: MatchState,
  team: TeamId,
  text: string | undefined,
  now: number,
): MatchState {
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
  const withFlag: MatchState = {
    ...state,
    initialFirstDone: true,
    answerLog: appendAnswerLog(state.answerLog, team, text, now),
  };
  return startAdvancing(withFlag, team, state.config.laneLength / 2, now);
}

/** 回答テキスト入力（任意機能）。textが空/未入力なら記録しない。 */
function appendAnswerLog(
  log: readonly AnswerLogEntry[],
  team: TeamId,
  text: string | undefined,
  recordedAt: number,
): AnswerLogEntry[] {
  const trimmed = text?.trim();
  if (!trimmed) return [...log];
  return [...log, { team, text: trimmed, recordedAt }];
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

function applyAnswerDone(
  state: MatchState,
  text: string | undefined,
  now: number,
): MatchState {
  const inWritingPhase =
    state.phase === "initial_writing" || state.phase === "challenge_writing";
  if (!inWritingPhase || state.movement.status !== "frozen") {
    throw new IllegalTransitionError(
      `ANSWER_DONE requires a frozen marker (after NOMINATE) in initial_writing/challenge_writing, got phase='${state.phase}' movement='${state.movement.status}'`,
    );
  }
  // ANSWER_DONE時点でstate.defendingTeamは常にセットされている(NOMINATE可能な時点でstartAdvancing済みのため)。
  const writer = state.defendingTeam;
  return {
    ...state,
    phase: "voting",
    audienceVotes: { red: 0, blue: 0 },
    votingRoundId: state.votingRoundId + 1,
    answerLog: writer
      ? appendAnswerLog(state.answerLog, writer, text, now)
      : state.answerLog,
  };
}

function applyAudienceVoteCast(state: MatchState, team: TeamId): MatchState {
  if (state.phase !== "voting") {
    throw new IllegalTransitionError(
      `AUDIENCE_VOTE_CAST is only valid in 'voting', got '${state.phase}'`,
    );
  }
  return {
    ...state,
    audienceVotes: {
      ...state.audienceVotes,
      [team]: state.audienceVotes[team] + 1,
    },
  };
}

function applyCloseVoting(state: MatchState, now: number): MatchState {
  if (state.phase !== "voting") {
    throw new IllegalTransitionError(
      `CLOSE_VOTING is only valid in 'voting', got '${state.phase}'`,
    );
  }
  return applyVoteResult(
    state,
    state.audienceVotes.red,
    state.audienceVotes.blue,
    now,
  );
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

/** お題の訂正（誤字修正など）。spec通り「1試合1お題固定」なのでゲーム進行上の変更ではなく、あくまで表記の訂正用途。 */
function applySetTopic(state: MatchState, topic: string): MatchState {
  const trimmed = topic.trim();
  if (!trimmed) {
    throw new IllegalTransitionError("topic must not be empty");
  }
  return { ...state, topic: trimmed };
}

/** 投影画面のQRコード表示切り替え。常時表示ではなくMCが必要なタイミングだけ表示する運用のための操作。 */
function applySetQrVisible(state: MatchState, visible: boolean): MatchState {
  return { ...state, qrVisible: visible };
}

/**
 * 前進速度のライブ調整・リハーサル早送り用。config.centerToEdgeMsは変更しない。
 * advancing中に倍率を変えると速度の分母が変わるため、現在位置を基準に startPosition/startTime を
 * 引き継ぎ直す（そうしないと巻き戻り/急なジャンプが起きる）。frozen/idle中は位置が速度に依存しないため
 * 倍率を差し替えるだけでよい。
 */
function applySetSpeedMultiplier(
  state: MatchState,
  multiplier: number,
  now: number,
): MatchState {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new IllegalTransitionError("speed multiplier must be a positive number");
  }
  if (state.movement.status !== "advancing") {
    return { ...state, speedMultiplier: multiplier };
  }
  const currentPosition = getMarkerPosition(state, now);
  const rebased: MatchState = {
    ...state,
    speedMultiplier: multiplier,
    movement: {
      status: "advancing",
      startPosition: currentPosition,
      startTime: now,
      direction: state.movement.direction,
    },
  };
  return checkArrival(rebased, now);
}

/**
 * マーカー位置の手動補正（トラブルリカバリ）。誤操作/回線トラブル等で位置がずれた場合に使う。
 * idle中は位置が常に中央固定でありそもそも補正の余地がないため対象外。
 * advancing中の補正で端(0/laneLength)を指定した場合はcheckArrivalによりその場で試合が確定する
 * （＝MCが「もう到達したとみなす」ための明示的なショートカットとして機能する。意図的な仕様）。
 */
function applyCorrectMarkerPosition(
  state: MatchState,
  position: number,
  now: number,
): MatchState {
  const correctablePhase =
    state.phase === "initial_writing" ||
    state.phase === "challenge_writing" ||
    state.phase === "voting";
  if (!correctablePhase || state.movement.status === "idle") {
    throw new IllegalTransitionError(
      `CORRECT_MARKER_POSITION requires an active marker (advancing/frozen) in initial_writing/challenge_writing/voting, got phase='${state.phase}' movement='${state.movement.status}'`,
    );
  }
  if (!Number.isFinite(position)) {
    throw new IllegalTransitionError("position must be a finite number");
  }
  const clamped = clamp(position, 0, state.config.laneLength);
  if (state.movement.status === "frozen") {
    return { ...state, movement: { status: "frozen", position: clamped } };
  }
  const rebased: MatchState = {
    ...state,
    movement: {
      status: "advancing",
      startPosition: clamped,
      startTime: now,
      direction: state.movement.direction,
    },
  };
  return checkArrival(rebased, now);
}

/**
 * 試合リセット（トラブルリカバリ）。チーム名/メンバー/お題/パラメータはそのままに、
 * 進行状態だけをsetup直後の状態へ戻す。メンバー登録のやり直しを避けるための機能。
 * votingRoundIdはリセットしない: DO側の投票dedup(voterId -> 最後に投票したround)はメモリ上に残るため、
 * ここを0に戻すと直前のラウンドで投票済みの観客が「まだ投票していない」と誤認識されて二重投票が発生しうる。
 */
function applyResetMatch(state: MatchState): MatchState {
  return {
    ...state,
    phase: "setup",
    teams: {
      red: { ...state.teams.red, nextRunnerIndex: 0 },
      blue: { ...state.teams.blue, nextRunnerIndex: 0 },
    },
    movement: { status: "idle" },
    advancingTeam: null,
    defendingTeam: null,
    initialFirstDone: false,
    winner: null,
    audienceVotes: { red: 0, blue: 0 },
    answerLog: [],
  };
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
      return applyFirstDone(current, event.team, event.text, now);
    case "NOMINATE":
      return applyNominate(current, now);
    case "ANSWER_DONE":
      return applyAnswerDone(current, event.text, now);
    case "VOTE_RESULT":
      return applyVoteResult(current, event.redVotes, event.blueVotes, now);
    case "AUDIENCE_VOTE_CAST":
      return applyAudienceVoteCast(current, event.team);
    case "CLOSE_VOTING":
      return applyCloseVoting(current, now);
    case "SET_TOPIC":
      return applySetTopic(current, event.topic);
    case "SET_QR_VISIBLE":
      return applySetQrVisible(current, event.visible);
    case "SET_SPEED_MULTIPLIER":
      return applySetSpeedMultiplier(current, event.multiplier, now);
    case "CORRECT_MARKER_POSITION":
      return applyCorrectMarkerPosition(current, event.position, now);
    case "RESET_MATCH":
      return applyResetMatch(current);
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
