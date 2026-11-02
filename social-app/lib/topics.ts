export const TOPICS: readonly (readonly [string, readonly string[]])[] = [
  ['Fitness', ['Gym', 'Running', 'Sports', 'Yoga']],
  ['Learning', ['Reading', 'Studying', 'Languages', 'Writing']],
  ['Work and tech', ['Coding', 'AI and Claude', 'Design', 'Building']],
  ['Money and health', ['Trading', 'Investing', 'Cooking', 'Healthy eating']],
  ['Motivation', ['Quotes', 'Consistency']],
];

export const topicOf = (subtag: string) => TOPICS.find((t) => t[1].includes(subtag))?.[0] ?? '';
