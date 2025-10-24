// Configuration for HN Summarizer
// Update this file and push to GitHub - Render will auto-deploy with new settings

module.exports = {
    // Number of top stories to fetch from HN
    topStoriesCount: 50,

    // Maximum number of relevant stories to include in digest
    maxRelevantStories: 10,

    // How many days to keep processed story history
    historyExpiryDays: 7,

    // Comment extraction settings
    maxRootComments: 5, // Top-level comments to fetch
    maxRepliesPerComment: 3, // Best replies per comment thread
    maxCommentDepth: 2, // How deep to recurse into nested replies
};
