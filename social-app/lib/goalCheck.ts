// Spots goals the intro must not cheer on. A free phrase list that runs on the phone,
// because no account exists yet and each AI check would cost money.
//
// ponytail: a list misses new wording and spelling tricks. It only guards the intro's
// tone: posts still go through the AI check. Add phrases here as real ones turn up.
// Goals nobody could ever prove on video, or that aren't goals at all. Whole-goal matches
// only, so "Win a tournament" and "Be a better runner" still pass.
const NOT_A_GOAL = new Set([
  'nothing', 'none', 'no', 'na', 'idk', 'i dont know', 'dunno', 'no goal', 'no goals', 'goal', 'my goal', 'a goal', 'test', 'testing',
  'asdf', 'qwerty', 'lol', 'lmao', 'haha', 'hello', 'hi', 'hey', 'whatever', 'anything', 'something', 'everything', 'stuff',
  'be happy', 'be better', 'be good', 'be great', 'be the best', 'be rich', 'be cool', 'be successful', 'get better', 'get good',
  'get rich', 'do better', 'do good', 'do my best', 'do stuff', 'succeed', 'success', 'win', 'winning', 'improve', 'grow', 'life', 'money',
  '없음', '없어', '없어요', '몰라', '몰라요', '모름', '테스트', '그냥', '목표', '행복', '행복하기', '잘하기', '돈', '성공', '성공하기',
]);

/** True when this can't be a goal a video could prove. Free, and runs on the phone like the rest of this file. */
export function goalTooVague(goal: string) {
  const text = goal.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return true;
  if (/^(.)\1+$/u.test(letters)) return true;
  if (/^[ㄱ-ㅎㅏ-ㅣ]+$/u.test(letters)) return true;
  return NOT_A_GOAL.has(text);
}

const FIX_HOURS = 24;

/** Hours left to fix a goal, 0 once it's locked until a video proves it. The database enforces this too. */
export function goalFixHoursLeft(setAt: string | null | undefined, now = Date.now()) {
  if (!setAt) return 0;
  return Math.max(0, Math.ceil(FIX_HOURS - (now - Date.parse(setAt)) / 36e5));
}

export type GoalConcern = 'care' | 'harm' | null;

// Someone may be struggling. These come first, so "kill myself" never reads as a threat.
const CARE = [
  /\b(kill|killing|hurt|hurting|cut|cutting|harm|harming) (myself|my self)\b/,
  /\bsuicid/,
  /\bself[ -]?harm/,
  /\b(want|wanna|going) (to )?die\b/,
  /\bend (my life|it all)\b/,
  // Only eating as a whole: "stop eating junk food" is a fine goal.
  /\b(stop|quit) eating( again| anymore| completely| at all)?$/,
  /\b(never|not) eat(ing)?( again| anymore| anything| at all)?$/,
  /\bstarv(e|ing)\b/,
  /\banorexi/,
  /\bbulimi/,
  /\bpurg(e|ing)\b/,
  /\blose \d+ ?(pounds?|lbs?|kgs?|kilos?) (in|by) (a|one|\d+) ?(day|days|week|weeks)\b/,
];

// "My knee" and "my record" aren't people, so this names who counts.
const PEOPLE = '(him|her|them|someone|somebody|people|others|everyone|everybody|my (ex|brother|sister|friends?|classmates?|teacher|boss|mom|dad|parents|girlfriend|boyfriend|coworkers?))';

const HARM = [
  new RegExp(`\\b(kill|hurt|stab|shoot|poison|bully|stalk|punch) ${PEOPLE}\\b`),
  // Not plain "beat": "beat my brother at chess" and "beat my record" are fine.
  new RegExp(`\\bbeat ${PEOPLE} up\\b`),
  /\bbeat up\b/,
  /\brevenge\b/,
  /\bget back at\b/,
  /\bscam(s|ming)?\b/,
  /\bshoplift/,
  /\bsteal (from|money)\b/,
  /\bmake (him|her|them|everyone|everybody|people) (hate|suffer|cry)\b/,
  /\bruin (his|her|their|someone'?s)\b/,
];

// Korean is matched with the spaces removed, since spacing varies so much in typing.
const CARE_KO = ['자살', '죽고싶', '죽을래', '자해', '굶', '밥안먹', '아무것도안먹', '먹토', '사라지고싶', '목숨을끊'];
const HARM_KO = ['복수하', '복수할', '때리', '때려', '패버', '죽일', '죽이', '괴롭히', '사기쳐', '사기치', '훔치', '왕따시', '스토킹'];

export function goalConcern(goal: string): GoalConcern {
  const text = goal.toLowerCase().replace(/\s+/g, ' ').trim();
  const korean = text.replace(/ /g, '');
  if (CARE.some((p) => p.test(text)) || CARE_KO.some((w) => korean.includes(w))) return 'care';
  if (HARM.some((p) => p.test(text)) || HARM_KO.some((w) => korean.includes(w))) return 'harm';
  return null;
}
