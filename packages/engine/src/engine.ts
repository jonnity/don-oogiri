import {
  IllegalTransitionError,
  type MatchConfig,
  type MatchEvent,
  type MatchState,
  type TeamId,
  type TeamRoster,
} from "./types.js";

const MIN_TEAM_SIZE = 1;
const MAX_TEAM_SIZE = 3;

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
  /** 1〜3人（タイマン〜3人チーム）。 */
  members: readonly string[];
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
  for (const team of [red, blue]) {
    if (team.members.length < MIN_TEAM_SIZE || team.members.length > MAX_TEAM_SIZE) {
      throw new IllegalTransitionError(
        `team members must be between ${MIN_TEAM_SIZE} and ${MAX_TEAM_SIZE}, got ${team.members.length}`,
      );
    }
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
    bothWritingFirstDone: false,
    winner: null,
    currentAnswerer: { red: null, blue: null },
    audienceVotes: { red: 0, blue: 0 },
    votingRoundId: 0,
    topic,
    qrVisible: true,
    speedMultiplier: 1,
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
  now: number,
): MatchState {
  const inBothWritingPhase =
    state.phase === "initial_writing" || state.phase === "tie_writing";
  if (!inBothWritingPhase) {
    throw new IllegalTransitionError(
      `FIRST_DONE is only valid in 'initial_writing'/'tie_writing', got '${state.phase}'`,
    );
  }
  if (state.bothWritingFirstDone) {
    throw new IllegalTransitionError(
      "FIRST_DONE was already recorded for this writing round",
    );
  }
  // startPositionはgetMarkerPositionで決まる: 試合開始直後(idle)なら中央、
  // tie_writing(frozen)なら同数になった時点のマーカー位置から書き直しが始まる。
  const startPosition = getMarkerPosition(state, now);
  const withFlag: MatchState = {
    ...state,
    bothWritingFirstDone: true,
    currentAnswerer: {
      ...state.currentAnswerer,
      [team]: currentRunnerName(state.teams[team]),
    },
  };
  return startAdvancing(withFlag, team, startPosition, now);
}

function applyNominate(state: MatchState, now: number): MatchState {
  const inWritingPhase =
    state.phase === "initial_writing" ||
    state.phase === "tie_writing" ||
    state.phase === "challenge_writing";
  if (!inWritingPhase || state.movement.status !== "advancing") {
    throw new IllegalTransitionError(
      `NOMINATE requires an advancing marker in initial_writing/tie_writing/challenge_writing, got phase='${state.phase}' movement='${state.movement.status}'`,
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
    state.phase === "initial_writing" ||
    state.phase === "tie_writing" ||
    state.phase === "challenge_writing";
  if (!inWritingPhase || state.movement.status !== "frozen") {
    throw new IllegalTransitionError(
      `ANSWER_DONE requires a frozen marker (after NOMINATE) in initial_writing/tie_writing/challenge_writing, got phase='${state.phase}' movement='${state.movement.status}'`,
    );
  }
  // ANSWER_DONE時点でstate.defendingTeamは常にセットされている
  // (NOMINATE可能な時点でstartAdvancing済みのため、initial_writing/tie_writing/challenge_writing問わず成立する)。
  const writer = state.defendingTeam;
  return {
    ...state,
    phase: "voting",
    audienceVotes: { red: 0, blue: 0 },
    votingRoundId: state.votingRoundId + 1,
    currentAnswerer: writer
      ? { ...state.currentAnswerer, [writer]: currentRunnerName(state.teams[writer]) }
      : state.currentAnswerer,
  };
}

/**
 * previousTeamが指定された場合（同一投票ラウンド内での再選択）は、旧選択を取り消してから新選択を加える。
 * previousTeamとteamが同じ場合は変更なしのため何もしない。
 */
function applyAudienceVoteCast(
  state: MatchState,
  team: TeamId,
  previousTeam: TeamId | undefined,
): MatchState {
  if (state.phase !== "voting") {
    throw new IllegalTransitionError(
      `AUDIENCE_VOTE_CAST is only valid in 'voting', got '${state.phase}'`,
    );
  }
  if (previousTeam === team) return state;
  const withoutPrevious = previousTeam
    ? {
        ...state.audienceVotes,
        [previousTeam]: Math.max(0, state.audienceVotes[previousTeam] - 1),
      }
    : state.audienceVotes;
  return {
    ...state,
    audienceVotes: {
      ...withoutPrevious,
      [team]: withoutPrevious[team] + 1,
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
  const nextRunnerIndex = (roster.nextRunnerIndex + 1) % roster.members.length;
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
  const isTie = advancingVotes === defendingVotes;
  const frozenPosition =
    state.movement.status === "frozen"
      ? state.movement.position
      : getMarkerPosition(state, now);

  if (isTie) {
    // 同数票 = 防衛成功（反転はしない）。ただし同じ顔合わせが続かないよう両チームとも
    // 次走者に交代し、initial_writingと同じ「両チーム同時執筆」の形でゼロから書き直す。
    // マーカーは同数になった時点の位置のまま(frozen)で止まっており、次のFIRST_DONEで
    // その位置から改めて前進が始まる。
    const withBothRotated = incrementRunner(
      incrementRunner(state, defendingTeam),
      advancingTeam,
    );
    return {
      ...withBothRotated,
      phase: "tie_writing",
      advancingTeam: null,
      defendingTeam: null,
      bothWritingFirstDone: false,
      movement: { status: "frozen", position: frozenPosition },
    };
  }

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
    state.phase === "tie_writing" ||
    state.phase === "challenge_writing" ||
    state.phase === "voting";
  if (!correctablePhase || state.movement.status === "idle") {
    throw new IllegalTransitionError(
      `CORRECT_MARKER_POSITION requires an active marker (advancing/frozen) in initial_writing/tie_writing/challenge_writing/voting, got phase='${state.phase}' movement='${state.movement.status}'`,
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
    bothWritingFirstDone: false,
    winner: null,
    currentAnswerer: { red: null, blue: null },
    audienceVotes: { red: 0, blue: 0 },
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
      return applyFirstDone(current, event.team, now);
    case "NOMINATE":
      return applyNominate(current, now);
    case "ANSWER_DONE":
      return applyAnswerDone(current);
    case "VOTE_RESULT":
      return applyVoteResult(current, event.redVotes, event.blueVotes, now);
    case "AUDIENCE_VOTE_CAST":
      return applyAudienceVoteCast(current, event.team, event.previousTeam);
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

/**
 * 現在のnextRunnerIndexが指す走者名。nextRunnerIndexはincrementRunnerで常に
 * members.lengthの範囲内に保たれるため、未定義になることはない。
 */
function currentRunnerName(roster: TeamRoster): string {
  const name = roster.members[roster.nextRunnerIndex];
  if (name === undefined) {
    throw new IllegalTransitionError(
      `nextRunnerIndex ${roster.nextRunnerIndex} is out of range for ${roster.members.length} members`,
    );
  }
  return name;
}

/**
 * 次に執筆すべき人（表示用、単一）。initial_writing/tie_writingで両チームがまだ
 * 同時執筆中（どちらも書き終えていない）の場合は1人に特定できないためnull
 * （その場合はcurrentWritersで両チーム分を取得する）。該当者がいなければnull。
 */
export function currentWriter(
  state: MatchState,
): { team: TeamId; name: string } | null {
  const inBothWritingPhase =
    state.phase === "initial_writing" || state.phase === "tie_writing";
  if (inBothWritingPhase && !state.bothWritingFirstDone) return null;
  if (!inBothWritingPhase && state.phase !== "challenge_writing") return null;
  const defending = state.defendingTeam;
  if (!defending) return null;
  return { team: defending, name: currentRunnerName(state.teams[defending]) };
}

/**
 * 次に執筆すべき人（表示用、複数対応）。initial_writing/tie_writingで両チームが
 * 同時執筆中の間は両チーム分（最大2件）、それ以外はcurrentWriterと同じ1件（該当者なしなら0件）を返す。
 */
export function currentWriters(
  state: MatchState,
): { team: TeamId; name: string }[] {
  const inBothWritingPhase =
    state.phase === "initial_writing" || state.phase === "tie_writing";
  if (inBothWritingPhase && !state.bothWritingFirstDone) {
    return (["red", "blue"] as const).map((team) => ({
      team,
      name: currentRunnerName(state.teams[team]),
    }));
  }
  const single = currentWriter(state);
  return single ? [single] : [];
}
