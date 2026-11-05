const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { OfficeService } = require('../src/main/services/office-service.cjs');
const { SkillsService } = require('../src/main/services/skills-service.cjs');
const { GameSocket } = require('../src/main/services/game-socket.cjs');

// A fake /socket/: acks answer through `answer(event, payload)`, plain emits reply with an event.
function fakeGame(answer) {
  const calls = [];
  const createSocket = () => {
    const s = new EventEmitter();
    s.connected = true; s.off = s.removeListener; s.close = () => { s.connected = false; };
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    s.emit = (event, payload) => {
      calls.push({ event, payload });
      setImmediate(() => { const r = answer(event, payload); if (r && r.reply) local(r.reply, r.data); });
      return true;
    };
    s.timeout = () => ({ emit: (event, payload, cb) => { calls.push({ event, payload }); setImmediate(() => cb(null, answer(event, payload))); } });
    setImmediate(() => local('connect'));
    return s;
  };
  return { calls, createSocket };
}

function office(answer, now = Date.parse('2026-11-05T12:00:00Z')) {
  const game = fakeGame(answer);
  const logs = [];
  GameSocket._resetKicks();
  const svc = new OfficeService({
    store: { getAccounts: () => [{ id: 'a1', name: 'Trophy' }], getSettings: () => ({}) },
    activity: { add: e => logs.push(e) },
    sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'c=1' }) },
    createSocket: game.createSocket, now: () => now
  });
  return { svc, game, logs };
}

const coachState = over => ({
  coaches: [{ id: 'k1', name: 'Phil Jackson', offense: { name: 'Princeton', level: 'SUPERFINE', experience: 4000, trainable: true }, defense: { name: 'Press', level: 'BASE', experience: 1, trainable: false } }],
  selectedCoachId: 'k1', cards: { master: 2, change: 1 }, today: { used: 0, free: 2, max: 5, nextTicketCost: 0 }, training: null, ...over
});
const big3Common = (event) => {
  if (event === 'big3:getTeams') return { success: true, teams: [{ id: 't1', team: 'Atlanta Hawks', level: 3, ownsTrio: true }] };
  if (event === 'big3:getUserActiveBig3Type') return { success: true, activeBig3Type: null };
  return null;
};

test('Coach: a finished training is claimed and a free one started with a Master Card', async () => {
  let state = coachState({ training: { startedAt: '2026-11-05T08:00:00Z', endsAt: '2026-11-05T11:00:00Z' } });
  const { svc, game, logs } = office((event) => {
    if (event === 'getCoachState') return { reply: 'coachState', data: state };
    if (event === 'claimCoachTraining') { state = { ...state, training: null }; return { success: true }; }
    if (event === 'startCoachTraining') { state = { ...state, training: { startedAt: 'x', endsAt: '2026-11-05T15:00:00Z' }, today: { ...state.today, used: 1 } }; return { success: true }; }
    if (event === 'big3:getTrainingAttempts') return { success: true, attemptsRemaining: 3, maxAttempts: 3 };
    return big3Common(event) || { success: true };
  });
  assert.equal(await svc.coachTick('a1'), 'started');
  assert.deepEqual(game.calls.map(c => c.event).filter(e => /Coach/.test(e)), ['getCoachState', 'claimCoachTraining', 'getCoachState', 'startCoachTraining', 'getCoachState']);
  assert.ok(logs.some(l => l.code === 'of.coachClaimed') && logs.some(l => l.code === 'of.coachStarted'));
});

test('Coach: never a ticket attempt, never a coach with nothing to train', async () => {
  let state = coachState({ today: { used: 2, free: 2, max: 5, nextTicketCost: 50 } });
  const ans = event => event === 'getCoachState' ? { reply: 'coachState', data: state } : (big3Common(event) || { success: true, attemptsRemaining: 3 });
  const a = office(ans);
  assert.equal(await a.svc.coachTick('a1'), 'noFree');
  assert.ok(!a.game.calls.some(c => c.event === 'startCoachTraining'));
  state = coachState({ coaches: [{ id: 'k1', name: 'Red', offense: { trainable: false }, defense: { trainable: false } }] });
  const b = office(ans);
  assert.equal(await b.svc.coachTick('a1'), 'nothing');
  state = coachState({ cards: { master: 0, change: 0 } });
  const c = office(ans);
  assert.equal(await c.svc.coachTick('a1'), 'noCard');
  assert.ok(![...b.game.calls, ...c.game.calls].some(x => x.event === 'startCoachTraining'));
});

test('Big3: an ended training is finished, a normal (never intensive) one started', async () => {
  let progress = { level: 4, trainingStart: '2026-11-05T08:00:00Z', trainingEnd: '2026-11-05T11:00:00Z' };
  const { svc, game } = office((event, p) => {
    if (event === 'getCoachState') return { reply: 'coachState', data: coachState() };
    if (event === 'big3:getUserProgress') return { success: true, progress, levelCap: 15, magic: { status: 'LOCKED' } };
    if (event === 'big3:finishTraining') { progress = { level: 5, trainingStart: null, trainingEnd: null }; return { success: true }; }
    if (event === 'big3:getActiveTraining') return { success: true, hasActiveTraining: false };
    if (event === 'big3:getTrainingAttempts') return { success: true, attemptsRemaining: 2, maxAttempts: 3 };
    if (event === 'big3:startTraining') { progress = { ...progress, trainingEnd: '2026-11-05T15:00:00Z' }; return { success: true }; }
    return big3Common(event) || { success: true };
  });
  assert.equal(await svc.big3Tick('a1', 't1'), 'started');
  const start = game.calls.find(c => c.event === 'big3:startTraining');
  assert.equal(start.payload.useIntensive, false);
  assert.ok(game.calls.some(c => c.event === 'big3:finishTraining'));
  // no attempt left: nothing starts
  const b = office(event => {
    if (event === 'big3:getUserProgress') return { success: true, progress: { level: 5 }, levelCap: 15, magic: {} };
    if (event === 'big3:getActiveTraining') return { success: true, hasActiveTraining: false };
    if (event === 'big3:getTrainingAttempts') return { success: true, attemptsRemaining: 0 };
    if (event === 'getCoachState') return { reply: 'coachState', data: coachState() };
    return big3Common(event) || { success: true };
  });
  assert.equal(await b.svc.big3Tick('a1', 't1'), 'noAttempts');
  assert.ok(!b.game.calls.some(c => /startTraining/.test(c.event)));
});

test('Skills: a shuffle only when a free one is left', async () => {
  let free = 0;
  const game = fakeGame(event => {
    if (event === 'register') return { reply: 'registrationSuccess', data: { success: true } };
    if (event === 'skills:getShuffleStatus') return { reply: 'skills:shuffleStatus', data: { success: true, remainingFreeShuffles: free } };
    if (event === 'skills:getAvailableSkills') return { reply: 'skills:availableSkills', data: { success: true, skills: [], userLevel: 40 } };
    if (event === 'skills:getUserContainers') return { reply: 'skills:userContainers', data: { success: true, containers: [{ id: 'c1', containerNumber: 1, skills: [{ slotNumber: 1, isLocked: false, skill: { name: 'SKYHOOK' } }] }] } };
    if (event === 'skills:shuffleContainer') return { reply: 'skills:containerShuffled', data: { success: true } };
    return null;
  });
  GameSocket._resetKicks();
  const svc = new SkillsService({ store: { getAccounts: () => [{ id: 'a1', name: 'Trophy' }] }, activity: { add() {} }, sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'c=1' }) }, createSocket: game.createSocket });
  await assert.rejects(svc.shuffle('a1', 'c1'), /No free shuffle/);
  assert.ok(!game.calls.some(c => c.event === 'skills:shuffleContainer'));
  free = 1;
  const v = await svc.shuffle('a1', 'c1');
  assert.ok(game.calls.some(c => c.event === 'skills:shuffleContainer'));
  assert.equal(v.containers[0].slots[0].skill.name, 'SKYHOOK');
});

test('Super Big 3: a normal training only, never intensive; nothing without a trio', async () => {
  let progress = { id: 's1', level: 2, xp: 0, trainingEnd: null };
  const { svc, game } = office(event => {
    if (event === 'getCoachState') return { reply: 'coachState', data: coachState() };
    if (event === 'getUserStrategies') return { reply: 'userStrategies', data: { offense: [], defense: [] } };
    if (event === 'superBig3:getUserProgress') return { success: true, progress, playerInfo: [] };
    if (event === 'superBig3:getTrainingAttempts') return { success: true, attemptsRemaining: 1, maxAttempts: 3 };
    if (event === 'big3:getActiveTraining') return { success: true, hasActiveTraining: false };
    if (event === 'superBig3:startTraining') { progress = { ...progress, trainingEnd: '2026-11-05T15:00:00Z' }; return { success: true }; }
    return big3Common(event) || { success: true };
  });
  assert.equal(await svc.superTick('a1'), 'started');
  assert.equal(game.calls.find(c => c.event === 'superBig3:startTraining').payload.useIntensive, false);
  const b = office(event => {
    if (event === 'superBig3:getUserProgress') return { success: true, progress: null };
    if (event === 'getCoachState') return { reply: 'coachState', data: coachState() };
    return big3Common(event) || { success: true };
  });
  assert.equal(await b.svc.superTick('a1'), 'noTeam');
  assert.ok(!b.game.calls.some(c => c.event === 'superBig3:startTraining'));
});
