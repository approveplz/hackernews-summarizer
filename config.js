// Configuration for HN Summarizer
// Update this file and push to GitHub - Render will auto-deploy with new settings

module.exports = {
  // Your interests for filtering HN stories
  // The AI will use these to determine which stories are relevant to you
  userInterests: [
    'AI',
    'machine learning',
    'AI agents',
    'prompt engineering',
    'startups',
    'developer tools',
    'programming languages',
    'web development',
    'serverless',
    'distributed systems',
    'Node.js',
    'TypeScript',
    'JavaScript',
    'world events',
    'finance'
  ],

  // Number of top stories to fetch from HN
  topStoriesCount: 10,

  // How many days to keep processed story history
  historyExpiryDays: 7,

  // Maximum number of comments to analyze per story
  maxCommentsPerStory: 5
};
