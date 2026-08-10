import { describe, expect, it } from "vitest";
import { createMatch, currentWriter, getMarkerPosition, transition } from "./engine.js";
import { IllegalTransitionError, type MatchState } from "./types.js";

const CONFIG = { laneLength: 100, centerToEdgeMs: 90_000 };

function newMatch(): MatchState {
  return createMatch(
    CONFIG,
    { name: "赤チーム", members: ["赤1", "赤2", "赤3"] },
    { name: "青チーム", members: ["青1", "青2", "青3"] },
  );
}

describe("createMatch", () => {
  it("starts in setup phase at center with no advancing team", () => {
    const match = newMatch();
    expect(match.phase).toBe("setup");
    expect(match.advancingTeam).toBeNull();
    expect(getMarkerPosition(match, 0)).toBe(50);
  });

  it("rejects non-positive config", () => {
    expect(() =>
      createMatch(
        { laneLength: 0, centerToEdgeMs: 1000 },
        { name: "赤", members: ["a", "b", "c"] },
        { name: "青", members: ["d", "e", "f"] },
      ),
    ).toThrow(IllegalTransitionError);
  });
});

describe("initial_writing", () => {
  it("first team to finish becomes tentative advancing and starts moving immediately", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    expect(match.phase).toBe("initial_writing");

    match = transition(match, { type: "FIRST_DONE", team: "red" }, 1_000);
    expect(match.advancingTeam).toBe("red");
    expect(match.defendingTeam).toBe("blue");
    expect(match.movement.status).toBe("advancing");

    // 前進を開始しているので、時間経過で位置が中央から動く
    const posAtStart = getMarkerPosition(match, 1_000);
    const posLater = getMarkerPosition(match, 46_000); // 45s経過
    expect(posAtStart).toBe(50);
    expect(posLater).toBeGreaterThan(50);
  });

  it("rejects a second FIRST_DONE", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    expect(() => transition(match, { type: "FIRST_DONE", team: "blue" }, 0)).toThrow(
      IllegalTransitionError,
    );
  });

  it("NOMINATE freezes the marker at its current interpolated position", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    // speed = 50 / 90000 per ms. after 9000ms -> +5
    match = transition(match, { type: "NOMINATE" }, 9_000);
    expect(match.movement).toEqual({ status: "frozen", position: 55 });

    // 凍結後は時間が進んでも位置は変わらない
    expect(getMarkerPosition(match, 999_999)).toBe(55);
  });

  it("ANSWER_DONE after NOMINATE moves to voting", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    match = transition(match, { type: "NOMINATE" }, 9_000);
    match = transition(match, { type: "ANSWER_DONE" }, 12_000);
    expect(match.phase).toBe("voting");
  });

  it("rejects ANSWER_DONE without a prior NOMINATE", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    expect(() => transition(match, { type: "ANSWER_DONE" }, 1_000)).toThrow(
      IllegalTransitionError,
    );
  });
});

function toVoting(advancingFirst: "red" | "blue", nominateAt = 9_000, answerAt = 12_000): MatchState {
  let match = newMatch();
  match = transition(match, { type: "START_MATCH" }, 0);
  match = transition(match, { type: "FIRST_DONE", team: advancingFirst }, 0);
  match = transition(match, { type: "NOMINATE" }, nominateAt);
  match = transition(match, { type: "ANSWER_DONE" }, answerAt);
  return match;
}

describe("VOTE_RESULT — advancing side wins (including ties)", () => {
  it("keeps the same advancing team and resumes advancing from the frozen position", () => {
    let match = toVoting("red");
    const frozenPosition = 55; // 9s * (50/90000) = 5 -> 50+5
    match = transition(match, { type: "VOTE_RESULT", redVotes: 5, blueVotes: 3 }, 13_000);

    expect(match.phase).toBe("challenge_writing");
    expect(match.advancingTeam).toBe("red");
    expect(match.defendingTeam).toBe("blue");
    expect(match.movement).toMatchObject({
      status: "advancing",
      startPosition: frozenPosition,
      startTime: 13_000,
      direction: 1,
    });
  });

  it("a tie vote counts as an advancing-side win", () => {
    let match = toVoting("red");
    match = transition(match, { type: "VOTE_RESULT", redVotes: 4, blueVotes: 4 }, 13_000);
    expect(match.phase).toBe("challenge_writing");
    expect(match.advancingTeam).toBe("red");
  });

  it("rotates the defending team's next runner after a loss", () => {
    let match = toVoting("red");
    expect(match.teams.blue.nextRunnerIndex).toBe(0);
    match = transition(match, { type: "VOTE_RESULT", redVotes: 5, blueVotes: 1 }, 13_000);
    expect(match.teams.blue.nextRunnerIndex).toBe(1);
    expect(match.teams.red.nextRunnerIndex).toBe(0);
  });
});

describe("VOTE_RESULT — defending side wins (reversal)", () => {
  it("flips the advancing team and continues from the frozen position in the opposite direction", () => {
    let match = toVoting("red");
    const frozenPosition = 55;
    match = transition(match, { type: "VOTE_RESULT", redVotes: 2, blueVotes: 5 }, 13_000);

    expect(match.phase).toBe("challenge_writing");
    // 進んでる側が入れ替わる: blueが新たな進んでる側
    expect(match.advancingTeam).toBe("blue");
    expect(match.defendingTeam).toBe("red");
    expect(match.movement).toMatchObject({
      status: "advancing",
      startPosition: frozenPosition,
      startTime: 13_000,
      direction: -1, // blueは0方向へ押し返す
    });
  });

  it("rotates the old advancing team's next runner into the new defending role", () => {
    let match = toVoting("red");
    expect(match.teams.red.nextRunnerIndex).toBe(0);
    match = transition(match, { type: "VOTE_RESULT", redVotes: 1, blueVotes: 9 }, 13_000);
    expect(match.teams.red.nextRunnerIndex).toBe(1); // 旧advancing(red)の次走者
    expect(match.teams.blue.nextRunnerIndex).toBe(0); // 新advancing(blue)は変化なし
  });

  it("supports repeated reversals swapping sides back and forth", () => {
    let match = toVoting("red");
    match = transition(match, { type: "VOTE_RESULT", redVotes: 1, blueVotes: 9 }, 13_000); // blue advancing now
    expect(match.advancingTeam).toBe("blue");

    match = transition(match, { type: "NOMINATE" }, 14_000);
    match = transition(match, { type: "ANSWER_DONE" }, 15_000);
    match = transition(match, { type: "VOTE_RESULT", redVotes: 9, blueVotes: 1 }, 16_000); // red reverses back
    expect(match.advancingTeam).toBe("red");
    expect(match.defendingTeam).toBe("blue");
  });
});

describe("marker arrival at the edge", () => {
  it("finishes the match immediately when the marker reaches the opponent's edge while advancing (no vote needed)", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    // red advances from 50 toward 100 at 50/90000 per ms -> reaches 100 after 90_000ms
    const beforeArrival = transition(match, { type: "NOMINATE" }, 89_000);
    expect(beforeArrival.phase).toBe("initial_writing");

    // 到達前は voting へ遷移できる（まだfinishedではない）
    match = transition(match, { type: "NOMINATE" }, 10_000);
    match = transition(match, { type: "ANSWER_DONE" }, 11_000);
    match = transition(match, { type: "VOTE_RESULT", redVotes: 5, blueVotes: 5 }, 12_000);
    // frozen position was 50 + (10000 * 50/90000) = ~55.56, resumes advancing from there
    expect(match.phase).toBe("challenge_writing");

    // 端(100)に到達する時刻を計算し、その時点以降でチェックすると即finishedになる
    const distanceLeft = 100 - (match.movement as { startPosition: number }).startPosition;
    const speed = 50 / 90_000;
    const timeToEdge = distanceLeft / speed;
    const nowAtEdge = 12_000 + timeToEdge + 1;

    const finished = transition(match, { type: "NOMINATE" }, nowAtEdge);
    expect(finished.phase).toBe("finished");
    expect(finished.winner).toBe("red");
    expect(finished.movement).toMatchObject({ status: "frozen", position: 100 });
  });

  it("finishes with the correct winner when blue pushes the marker down to 0", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "blue" }, 0);
    match = transition(match, { type: "NOMINATE" }, 9_000);
    match = transition(match, { type: "ANSWER_DONE" }, 10_000);
    match = transition(match, { type: "VOTE_RESULT", redVotes: 5, blueVotes: 5 }, 11_000);
    expect(match.advancingTeam).toBe("blue");

    const startPosition = (match.movement as { startPosition: number }).startPosition;
    const speed = 50 / 90_000;
    const timeToEdge = startPosition / speed;
    const nowAtEdge = 11_000 + timeToEdge + 1;

    const finished = transition(match, { type: "NOMINATE" }, nowAtEdge);
    expect(finished.phase).toBe("finished");
    expect(finished.winner).toBe("blue");
    expect(finished.movement).toMatchObject({ status: "frozen", position: 0 });
  });

  it("does not allow further transitions once finished", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    match = transition(match, { type: "NOMINATE" }, 90_000);
    expect(match.phase).toBe("finished");
    expect(() => transition(match, { type: "ANSWER_DONE" }, 90_001)).toThrow(
      IllegalTransitionError,
    );
  });
});

describe("currentWriter", () => {
  it("is null while both teams write simultaneously at match start", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    expect(currentWriter(match)).toBeNull();
  });

  it("identifies the trailing team's writer once the first team is done", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    expect(currentWriter(match)).toEqual({ team: "blue", name: "青1" });
  });

  it("identifies the defending team's next runner during challenge_writing", () => {
    let match = toVoting("red");
    match = transition(match, { type: "VOTE_RESULT", redVotes: 5, blueVotes: 1 }, 13_000);
    expect(currentWriter(match)).toEqual({ team: "blue", name: "青2" });
  });
});

describe("audience voting", () => {
  it("starts each voting round with a zeroed tally and an incremented round id", () => {
    let match = toVoting("red");
    expect(match.audienceVotes).toEqual({ red: 0, blue: 0 });
    expect(match.votingRoundId).toBe(1);
  });

  it("AUDIENCE_VOTE_CAST is rejected outside the voting phase", () => {
    let match = newMatch();
    match = transition(match, { type: "START_MATCH" }, 0);
    match = transition(match, { type: "FIRST_DONE", team: "red" }, 0);
    expect(() =>
      transition(match, { type: "AUDIENCE_VOTE_CAST", team: "red" }, 1_000),
    ).toThrow(IllegalTransitionError);
  });

  it("tallies individual votes per team", () => {
    let match = toVoting("red");
    match = transition(match, { type: "AUDIENCE_VOTE_CAST", team: "red" }, 13_000);
    match = transition(match, { type: "AUDIENCE_VOTE_CAST", team: "red" }, 13_100);
    match = transition(match, { type: "AUDIENCE_VOTE_CAST", team: "blue" }, 13_200);
    expect(match.audienceVotes).toEqual({ red: 2, blue: 1 });
  });

  it("CLOSE_VOTING resolves using the current tally like a manual VOTE_RESULT (reversal case)", () => {
    let match = toVoting("red");
    match = transition(match, { type: "AUDIENCE_VOTE_CAST", team: "red" }, 13_000);
    match = transition(match, { type: "AUDIENCE_VOTE_CAST", team: "blue" }, 13_100);
    match = transition(match, { type: "AUDIENCE_VOTE_CAST", team: "blue" }, 13_200);
    match = transition(match, { type: "CLOSE_VOTING" }, 13_300);

    expect(match.phase).toBe("challenge_writing");
    expect(match.advancingTeam).toBe("blue"); // 1票 vs 2票で阻止する側(blue)が勝ち反転
  });

  it("CLOSE_VOTING with a 0-0 tally falls through to the tie rule (advancing side wins)", () => {
    let match = toVoting("red");
    match = transition(match, { type: "CLOSE_VOTING" }, 13_000);
    expect(match.phase).toBe("challenge_writing");
    expect(match.advancingTeam).toBe("red");
  });

  it("resets the tally and bumps the round id again on the following round", () => {
    let match = toVoting("red");
    match = transition(match, { type: "AUDIENCE_VOTE_CAST", team: "red" }, 13_000);
    match = transition(match, { type: "CLOSE_VOTING" }, 13_100); // advancing(red) wins, back to challenge_writing
    expect(match.votingRoundId).toBe(1);

    match = transition(match, { type: "NOMINATE" }, 14_000);
    match = transition(match, { type: "ANSWER_DONE" }, 15_000);
    expect(match.votingRoundId).toBe(2);
    expect(match.audienceVotes).toEqual({ red: 0, blue: 0 });
  });
});
