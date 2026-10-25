import { test } from '../fixtures';

test('同一観客の投票変更と次ラウンドの投票を実サーバで確認する', async ({ demo }) => {
  const match = await demo.createMatch({ topic: '投票を変更したくなる一言とは？', redMembers: ['赤の回答者'], blueMembers: ['青の回答者'], edgeToEdgeSeconds: 120, timeLimitMinutes: null });
  await demo.joinAudience(match);
  await demo.startMatch();
  await demo.firstDone('red');
  await demo.hold(1000);
  await demo.nominate();
  await demo.vote('red');
  await demo.hold(1000);
  await demo.changeVote('blue');
  await demo.expectState({ audienceVotes: { red: 0, blue: 1 }, votingRoundId: 1 });
  await demo.hold(1000);
  await demo.closeVoting();
  await demo.hold(1000);
  await demo.nominate();
  await demo.vote('red');
  await demo.expectState({ audienceVotes: { red: 1, blue: 0 }, votingRoundId: 2 });
  await demo.closeVoting();
  await demo.expectState({ phase: 'challenge_writing', advancingTeam: 'red' });
  await demo.hold(2000);
});
