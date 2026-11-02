// Exact port of isBad() from design/NamePassword.dc.html. Do not shorten the word
// lists. supabase/functions/_shared/profanity.ts is a copy; tests/profanity.test.ts
// fails if the two drift apart.
export function isBad(text: string | null | undefined): boolean {
  if (!text) return false;
  const raw = String(text).toLowerCase();
  const ko = raw.replace(/시발점/g, '').replace(/[\s.\-_*~!?·]/g, '');
  const KO = ['씨발', '씨팔', '시팔', '시발', 'ㅅㅂ', 'ㅆㅂ', '씨바', '병신', 'ㅂㅅ', '븅신', '개새끼', '개새기', '개색끼', '좆', '지랄', 'ㅈㄹ', '미친놈', '미친년', '니미', '엠창', '썅', '존나', '졸라', 'ㅈㄴ', '꺼져'];
  if (KO.some((w) => ko.indexOf(w) !== -1)) return true;
  const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '+': 't', '9': 'g' };
  const ALLOW = /shi+take|shitake|scunthorpe|matsushita|cockpit|cocktail|peacock|hancock|dickens|cumulative|cucumber|document|assassin|classic|passion|grape|therapist|therapeutic|analys/g;
  const leet = raw.replace(/[01!|34589@$7+]/g, (c) => LEET[c]);
  const runs = (w: string) => new RegExp(w.replace(/(.)\1*/g, (m, c) => c + (m.length > 1 ? '{' + m.length + ',}' : '+')));
  const STRONG = ['fuck', 'fck', 'fuk', 'fuq', 'phuck', 'shit', 'bitch', 'biatch', 'cunt', 'nigger', 'nigga', 'faggot', 'fagot', 'asshole', 'dumbass', 'jackass', 'asshat', 'assface', 'asswipe', 'bastard', 'whore', 'slut', 'retard', 'pussy', 'dickhead', 'cocksucker', 'wanker', 'twat', 'dildo', 'porn', 'motherf', 'bullsh', 'jerkoff', 'tranny', 'kys'];
  const WHOLE = ['ass', 'arse', 'dick', 'cock', 'tit', 'tits', 'titty', 'titties', 'piss', 'pissed', 'wank', 'fag', 'fags', 'rape', 'raped', 'damn', 'dammit', 'crap', 'crappy', 'hoe', 'hoes', 'cum', 'jizz', 'boob', 'boobs', 'prick', 'douche', 'douchebag', 'skank', 'thot', 'asses', 'dicks', 'cocks'];
  const strongRx = STRONG.map(runs);
  const wholeRx = WHOLE.map((w) => new RegExp('^' + runs(w).source + '$'));
  const words = leet.replace(ALLOW, ' ').split(/\s+/).filter(Boolean);
  const joined: string[] = [];
  let run = '';
  words.forEach((w) => { const c = w.replace(/[^a-z]/g, ''); if (c.length === 1) { run += c; } else { if (run.length >= 3) joined.push(run); run = ''; } });
  if (run.length >= 3) joined.push(run);
  const squashed = words.map((w) => w.replace(/[^a-z]/g, '')).concat(joined);
  if (squashed.some((w) => strongRx.some((rx) => rx.test(w)))) return true;
  const parts = leet.replace(ALLOW, ' ').split(/[^a-z]+/).filter(Boolean).concat(joined);
  return parts.some((w) => wholeRx.some((rx) => rx.test(w)));
}
