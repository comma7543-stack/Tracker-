import { describe, expect, it } from 'vitest';
import { goalConcern, goalTooVague } from '../lib/goalCheck';

describe('goalTooVague', () => {
  it.each(['', ' ', 'a', '123', '!!!', 'aaaaaa', 'ㅋㅋㅋ', 'nothing', 'IDK', 'be happy', 'Be Happy!', 'get rich', 'test', 'win', '없음', '행복하기'])('rejects %j', (goal) => {
    expect(goalTooVague(goal)).toBe(true);
  });
  it.each(['Run a marathon', 'Read 50 books', 'Win a tournament', 'Be a better runner', 'Squat 180kg', 'Get rich by building an app', '마라톤 완주', '책 50권 읽기', 'Do 100 pushups'])('allows %j', (goal) => {
    expect(goalTooVague(goal)).toBe(false);
  });
});

describe('goalConcern', () => {
  it.each([
    'Kill myself', 'kill  MYSELF', 'I want to die', 'end my life', 'end it all', 'hurt myself', 'cutting myself', 'self-harm', 'suicide',
    'Stop eating', 'never eat again', 'starve myself', 'Lose 20 pounds in a week', 'lose 10kg in 5 days',
    '죽고 싶어요', '자 살', '자해', '굶기', '밥 안 먹기',
  ])('offers care for %s', (goal) => {
    expect(goalConcern(goal)).toBe('care');
  });

  it.each([
    'Beat up my classmate', 'beat him up', 'Get revenge on my ex', 'Hurt him', 'kill everyone', 'bully someone',
    'Get rich by scamming people', 'steal from my boss', 'make everyone hate me',
    '복수하기', '친구 때리기', '걔를 괴롭히기',
  ])('refuses %s', (goal) => {
    expect(goalConcern(goal)).toBe('harm');
  });

  it.each([
    'Run a marathon', 'Kill it at the gym', 'Killing it in math class', 'Beat my personal record', 'Beat my brother at chess someday',
    'Lose 20 pounds this year', 'Eat healthier', 'Stop eating junk food', 'Never eat fast food', 'Quit vaping', 'Shoot 100 free throws a day', 'Cut sugar',
    'Hit a new deadlift best', 'Stop procrastinating', 'Die Hard marathon', 'Heal my hurt knee', '마라톤 완주하기', '건강하게 먹기', '매일 공부하기', '복수전공 끝내기',
  ])('lets %s through', (goal) => {
    expect(goalConcern(goal)).toBeNull();
  });

  it('puts care first when both could match', () => {
    expect(goalConcern('hurt myself and revenge')).toBe('care');
  });
});
