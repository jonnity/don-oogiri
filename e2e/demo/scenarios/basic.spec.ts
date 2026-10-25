import { test } from '../fixtures';

test('観客の投票が3画面に連動し、青に反転する', async ({ demo }) => {
  const match = await demo.createMatch({
    topic: 'こんな大喜利大会はいやだ', redMembers: ['赤の回答者'], blueMembers: ['青の回答者'],
    edgeToEdgeSeconds: 120, timeLimitMinutes: null,
  });
  await demo.hold(1200);
  await demo.joinAudience(match);
  await demo.hold(1200);
  await demo.startMatch();
  await demo.hold(1200);
  await demo.firstDone('red');
  await demo.hold(1200);
  await demo.nominate();
  await demo.hold(1200);
  await demo.vote('blue');
  await demo.hold(1000);
  await demo.closeVoting();
  await demo.expectState({ phase: 'challenge_writing', advancingTeam: 'blue' });
  await demo.hold(2000);
});
