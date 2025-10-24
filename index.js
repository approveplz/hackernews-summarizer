require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');
const cheerio = require('cheerio');
const config = require('./config');
const db = require('./db');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Format feedback examples for prompt
function formatFeedbackExamples(feedback) {
    let examples = '';

    if (feedback.positive.length > 0) {
        examples += '\n\nExamples of stories the user found RELEVANT:\n';
        feedback.positive.forEach((f, i) => {
            examples += `${i + 1}. "${f.title}"\n`;
        });
    }

    if (feedback.negative.length > 0) {
        examples += '\n\nExamples of stories the user found NOT RELEVANT:\n';
        feedback.negative.forEach((f, i) => {
            examples += `${i + 1}. "${f.title}"\n`;
        });
    }

    return examples;
}

// Fetch top stories from Hacker News front page via Algolia API
async function fetchTopStories() {
    console.log('Fetching top stories from Hacker News...');

    // Query Algolia HN API for current top stories (front page)
    const response = await axios.get('https://hn.algolia.com/api/v1/search', {
        params: {
            tags: 'front_page',
            hitsPerPage: config.topStoriesCount,
        },
    });

    return response.data.hits;
}

// Fetch story details including comments from Algolia
async function fetchStoryWithComments(storyId) {
    const response = await axios.get(
        `https://hn.algolia.com/api/v1/items/${storyId}`
    );
    return response.data;
}

// Recursively extract comments with replies
function extractCommentsRecursively(
    comment,
    depth = 0,
    maxDepth = config.maxCommentDepth,
    maxReplies = config.maxRepliesPerComment
) {
    const result = [];

    // Add the current comment
    result.push({
        author: comment.author,
        text: comment.text,
        points: comment.points,
        depth: depth,
    });

    // If we haven't reached max depth and there are replies, get them
    if (depth < maxDepth && comment.children && comment.children.length > 0) {
        // Sort children by points (descending) and take top N
        const topReplies = comment.children
            .filter((child) => child.text) // Only comments with text
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .slice(0, maxReplies);

        // Recursively extract replies
        for (const reply of topReplies) {
            const nestedComments = extractCommentsRecursively(
                reply,
                depth + 1,
                maxDepth,
                maxReplies
            );
            result.push(...nestedComments);
        }
    }

    return result;
}

// Extract top comment threads with replies
function extractTopComments(story) {
    if (!story.children || story.children.length === 0) {
        return [];
    }

    const allComments = [];

    // Get top root-level comments sorted by points
    const topRootComments = story.children
        .filter((comment) => comment.text) // Only comments with text
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, config.maxRootComments);

    // Recursively extract each root comment and its replies
    for (const rootComment of topRootComments) {
        const thread = extractCommentsRecursively(rootComment, 0);
        allComments.push(...thread);
    }

    return allComments;
}

// Fetch article content from URL
async function fetchArticleContent(url) {
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; HN-Summarizer/1.0)',
            },
        });

        const $ = cheerio.load(response.data);

        // Remove script, style, and nav elements
        $('script, style, nav, header, footer').remove();

        // Try to get main content
        const article =
            $('article').text() || $('main').text() || $('body').text();

        // Clean up whitespace
        return article.replace(/\s+/g, ' ').trim().slice(0, 5000); // Limit to 5000 chars
    } catch (error) {
        console.error(`Error fetching article from ${url}:`, error.message);
        return null;
    }
}

// Check if story is relevant using OpenAI o3-mini
async function checkRelevance(story, articleContent, userInterests) {
    // Load feedback to improve relevance detection
    const feedback = await db.loadFeedback();
    const feedbackExamples = formatFeedbackExamples(feedback);

    // Load not interested terms to avoid those topics
    const notInterested = await db.loadNotInterested();
    const notInterestedText =
        notInterested.length > 0
            ? `\n\nUser is NOT interested in: ${notInterested.join(
                  ', '
              )}\n\nAVOID stories heavily featuring these topics.`
            : '';

    const prompt = `You are helping filter Hacker News stories based on user interests.

User interests: ${userInterests}${notInterestedText}
${feedbackExamples}

Story title: ${story.title}
Story URL: ${story.url || 'Discussion only'}
${
    articleContent
        ? `Article content (excerpt): ${articleContent.slice(0, 1000)}`
        : ''
}

Based on the user's interests, NOT interested topics, the story content (title and article), and the examples of past feedback, is this story relevant?
Focus on whether the article content itself matches the user's interests. Prioritize stories matching interests. AVOID stories primarily about not-interested topics.
Answer only YES or NO, followed by a brief one-sentence reason.`;

    const response = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: prompt }],
    });

    const answer = response.choices[0].message.content.trim();
    const isRelevant = answer.toUpperCase().startsWith('YES');

    return { isRelevant, reason: answer };
}

// Extract main topics/themes from story for interest tracking
async function extractTopicsFromStory(story, summary, articleContent) {
    const prompt = `Based on this article, identify 10-15 main topics or themes.

Title: ${story.title}
Summary: ${summary}
${articleContent ? `Article excerpt: ${articleContent.slice(0, 1000)}` : ''}

Return ONLY a comma-separated list of topics. Topics should be:
- Broad themes (e.g., "AI", "Privacy", "Open Source")
- Technologies (e.g., "Kubernetes", "PostgreSQL", "React", "DuckDB", "Rust")
- Concepts (e.g., "Remote Work", "Startup Culture", "Security", "Performance Optimization")
- Industries (e.g., "Healthcare", "Finance", "Education")
- Technical areas (e.g., "Distributed Systems", "Event Sourcing", "Data Engineering")

Keep topics concise (1-4 words each). Return 5-10 topics that appear in the article.
Format: topic1, topic2, topic3
Example output: AI, Privacy, Machine Learning, Data Security, Cloud Computing, Python, Neural Networks`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
        });

        const topicsText = response.choices[0].message.content.trim();
        return topicsText
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t);
    } catch (error) {
        console.error('Error extracting topics:', error.message);
        return [];
    }
}

// Helper to escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract key terms from keyTerms text (format: **Term**: explanation)
function extractKeyTermsList(keyTermsText) {
    if (!keyTermsText) return [];
    const regex = /\*\*([^*]+)\*\*:/g;
    const terms = [];
    let match;
    while ((match = regex.exec(keyTermsText)) !== null) {
        terms.push(match[1].trim());
    }
    return terms;
}

// Linkify topics in text to make them clickable
function linkifyTopicsInText(text, topics, feedbackUrl) {
    if (!topics || topics.length === 0) return text;

    let linkedText = text;

    // Sort topics by length (longest first) to avoid partial replacements
    const sortedTopics = [...topics].sort((a, b) => b.length - a.length);

    for (const topic of sortedTopics) {
        // Create regex with word boundaries for exact matches (case-insensitive)
        const regex = new RegExp(`\\b(${escapeRegex(topic)})\\b`, 'gi');
        const encodedTopic = encodeURIComponent(topic);
        const replacement = `<a href="${feedbackUrl}/manage-term?term=${encodedTopic}" style="color: #0066cc; text-decoration: none; border-bottom: 1px dotted #17a2b8; cursor: pointer;" title="Click to like or dislike '${topic.replace(
            /'/g,
            '&#39;'
        )}'">$1</a>`;

        linkedText = linkedText.replace(regex, replacement);
    }

    return linkedText;
}

// Summarize relevant story and extract key terms
async function summarizeStory(story, comments, articleContent) {
    const topComments = comments
        .map((c, i) => {
            const indent = '  '.repeat(c.depth || 0);
            const prefix = c.depth > 0 ? '↳ Reply' : 'Comment';
            return `${indent}${prefix} by ${c.author} (${
                c.points || 0
            } points):\n${indent}${c.text}`;
        })
        .join('\n\n');

    const summaryPrompt = `Summarize this Hacker News story and discussion:

Title: ${story.title}
URL: ${story.url || 'Discussion only'}
Points: ${story.points}
${articleContent ? `\nArticle content: ${articleContent.slice(0, 2000)}` : ''}

Top HN comments:
${topComments || 'No comments yet'}

Provide:
1. A concise 2-3 sentence summary of the main topic
2. Key insights from the discussion
3. Why this might be interesting or important`;

    const keyTermsPrompt = `Based on this Hacker News story and discussion, identify the 3-5 most important technical terms, concepts, or jargon that a reader should understand. For each term, provide a clear, beginner-friendly explanation (1-2 sentences).

Title: ${story.title}
${articleContent ? `\nArticle content: ${articleContent.slice(0, 2000)}` : ''}

Top HN comments:
${topComments || 'No comments yet'}

Format your response as a list where each item is:
**Term**: Brief explanation

Only include terms that are actually discussed in the article or comments.`;

    // Run both prompts in parallel for efficiency
    const [summaryResponse, keyTermsResponse] = await Promise.all([
        openai.chat.completions.create({
            model: 'gpt-5',
            messages: [{ role: 'user', content: summaryPrompt }],
        }),
        openai.chat.completions.create({
            model: 'gpt-5',
            messages: [{ role: 'user', content: keyTermsPrompt }],
        }),
    ]);

    const summary = summaryResponse.choices[0].message.content;
    const keyTerms = keyTermsResponse.choices[0].message.content;

    // Extract topics for interest tracking
    const topics = await extractTopicsFromStory(story, summary, articleContent);

    return {
        summary,
        keyTerms,
        topics,
    };
}

// Parse key terms and wrap them as clickable links
function parseKeyTermsAsLinks(keyTermsText, feedbackUrl) {
    if (!keyTermsText) return '';

    // Match pattern: **Term**: explanation
    // Make each **Term** clickable
    return keyTermsText.replace(/\*\*([^*]+)\*\*:/g, (match, term) => {
        const encodedTerm = encodeURIComponent(term.trim());
        return `<strong><a href="${feedbackUrl}/manage-term?term=${encodedTerm}" style="color: #0c5460; text-decoration: none; border-bottom: 2px dotted #17a2b8;">${term}</a></strong>:`;
    });
}

// Generate HTML content for digest
function generateDigestHTML(summaries, date) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HN Digest - ${date}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 {
      color: #ff6600;
      border-bottom: 2px solid #ff6600;
      padding-bottom: 10px;
    }
    .story {
      margin: 30px 0;
      padding: 20px;
      border-left: 4px solid #ff6600;
      background: #f6f6f6;
    }
    .story h2 {
      margin-top: 0;
      color: #000;
    }
    .story a {
      color: #0066cc;
      text-decoration: none;
    }
    .story a:hover {
      text-decoration: underline;
    }
    .meta {
      color: #666;
      font-size: 0.9em;
      margin: 10px 0;
    }
    .why-relevant {
      background: #fff3cd;
      border-left: 3px solid #ffc107;
      padding: 10px 15px;
      margin: 15px 0;
      font-size: 0.95em;
      color: #856404;
    }
    .why-relevant strong {
      color: #856404;
    }
    .summary {
      margin-top: 15px;
      white-space: pre-line;
    }
    .key-terms {
      margin-top: 20px;
      padding: 15px;
      background: #e8f4f8;
      border-left: 3px solid #17a2b8;
      border-radius: 4px;
    }
    .key-terms h3 {
      margin-top: 0;
      margin-bottom: 10px;
      color: #0c5460;
      font-size: 1em;
    }
    .key-terms-content {
      white-space: pre-line;
      font-size: 0.95em;
      line-height: 1.6;
    }
    .feedback {
      margin-top: 20px;
      padding-top: 15px;
      border-top: 1px solid #ddd;
      text-align: center;
    }
    .feedback p {
      color: #666;
      font-size: 0.9em;
      margin-bottom: 10px;
    }
    .feedback-buttons {
      display: inline-flex;
      gap: 15px;
    }
    .feedback-btn {
      display: inline-block;
      padding: 10px 20px;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .feedback-btn.positive {
      background: #28a745;
      color: white;
    }
    .feedback-btn.positive:hover {
      background: #218838;
    }
    .feedback-btn.negative {
      background: #dc3545;
      color: white;
    }
    .feedback-btn.negative:hover {
      background: #c82333;
    }
  </style>
</head>
<body>
  <h1>Your Daily Hacker News Digest</h1>
  <p><strong>Date:</strong> ${date}</p>
  <p><strong>Found ${summaries.length} relevant stories</strong></p>

  ${summaries
      .map((s, i) => {
          const feedbackUrl =
              process.env.FEEDBACK_URL || 'http://localhost:3000';
          const encodedTitle = encodeURIComponent(s.story.title);
          const encodedUrl = encodeURIComponent(s.story.url || '');

          // Extract key terms and combine with topics for comprehensive linkifying
          const keyTermsList = extractKeyTermsList(s.keyTerms);
          const allTerms = [...(s.topics || []), ...keyTermsList];

          // Linkify all terms (topics + key terms) in summary for quick interest tracking
          const linkedSummary =
              allTerms.length > 0
                  ? linkifyTopicsInText(s.summary, allTerms, feedbackUrl)
                  : s.summary;

          return `
    <div class="story">
      <h2>${i + 1}. ${s.story.title}</h2>
      ${
          s.story.url
              ? `<p><strong>URL:</strong> <a href="${s.story.url}" target="_blank">${s.story.url}</a></p>`
              : ''
      }
      <p class="meta">
        <a href="https://news.ycombinator.com/item?id=${
            s.story.objectID
        }" target="_blank">View on HN</a>
        | ${s.story.points} points
        | ${s.story.num_comments || 0} comments
      </p>
      <div class="why-relevant"><strong>Why you might be interested:</strong> ${
          s.reason
      }</div>
      <div class="summary">${linkedSummary}</div>
      ${
          s.keyTerms
              ? `<div class="key-terms">
        <h3>📚 Key Terms & Concepts</h3>
        <div class="key-terms-content">${parseKeyTermsAsLinks(
            s.keyTerms,
            feedbackUrl
        )}</div>
      </div>`
              : ''
      }
      <div class="feedback">
        <p>Was this story relevant to you?</p>
        <div class="feedback-buttons">
          <a href="${feedbackUrl}/feedback?story=${
              s.story.objectID
          }&rating=positive&title=${encodedTitle}&url=${encodedUrl}" class="feedback-btn positive">👍 Yes, relevant</a>
          <a href="${feedbackUrl}/feedback?story=${
              s.story.objectID
          }&rating=negative&title=${encodedTitle}&url=${encodedUrl}" class="feedback-btn negative">👎 Not relevant</a>
        </div>
      </div>
    </div>
  `;
      })
      .join('')}
</body>
</html>
  `.trim();
}

// Deliver digest via Resend email
async function deliverDigest(summaries) {
    const date = new Date().toISOString().split('T')[0];
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const html = generateDigestHTML(summaries, date);

    await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
        subject: `HN Digest - ${summaries.length} relevant stories from ${date}`,
        html: html,
    });

    console.log('✓ Email sent via Resend');
}

// Main function
async function main() {
    try {
        console.log('Starting HN summarizer...\n');

        // Initialize database
        await db.initializeDatabase();

        // Load and cleanup processed stories history
        const processedStories = await db.loadProcessedStories();
        await db.cleanupOldEntries(config.historyExpiryDays);

        // Load user interests from database
        const interests = await db.loadInterests();

        // If no interests in database, show error
        if (interests.length === 0) {
            console.error(
                'ERROR: No interests found in database. Please add interests via the API.'
            );
            console.error(
                'Use: POST /interests/add or POST /interests with your CRON_SECRET'
            );
            await db.closePool();
            process.exit(1);
        }

        const userInterests = interests.join(', ');
        console.log(`Using interests: ${userInterests}\n`);

        // Step 1: Fetch top stories
        const allStories = await fetchTopStories();
        console.log(`Found ${allStories.length} top stories`);

        // Filter out already processed stories
        const unprocessedStories = allStories.filter(
            (story) => !processedStories[story.objectID]
        );
        const skippedCount = allStories.length - unprocessedStories.length;

        if (skippedCount > 0) {
            console.log(`Skipped ${skippedCount} already-processed stories`);
        }

        // Filter out hiring/job posts
        const hiringKeywords = [
            'is hiring',
            'hiring',
            'who wants to be hired',
            'who is hiring',
            'seeking',
            "we're hiring",
            'join our team',
            'careers at',
            'job opening',
        ];
        const contentStories = unprocessedStories.filter((story) => {
            const title = story.title.toLowerCase();
            return !hiringKeywords.some((keyword) => title.includes(keyword));
        });
        const hiringFilteredCount =
            unprocessedStories.length - contentStories.length;

        if (hiringFilteredCount > 0) {
            console.log(`Filtered out ${hiringFilteredCount} hiring/job posts`);
        }

        // Sort content stories by points (descending) to prioritize popular stories
        const stories = contentStories.sort((a, b) => b.points - a.points);
        console.log(
            `Processing ${stories.length} new stories (sorted by points)\n`
        );

        const relevantSummaries = [];

        // Step 2: Process each story until we have enough relevant ones
        for (const story of stories) {
            // Stop if we have enough relevant stories
            if (relevantSummaries.length >= config.maxRelevantStories) {
                console.log(
                    `\n✓ Found ${config.maxRelevantStories} relevant stories, stopping processing`
                );
                break;
            }

            console.log(`Processing: ${story.title} (${story.points} points)`);

            // Fetch full story with comments
            const fullStory = await fetchStoryWithComments(story.objectID);
            const comments = extractTopComments(fullStory);

            // Fetch article content if URL exists
            let articleContent = null;
            if (story.url) {
                articleContent = await fetchArticleContent(story.url);
            }

            // Check relevance (based on article content only, not comments)
            const { isRelevant, reason } = await checkRelevance(
                story,
                articleContent,
                userInterests
            );
            console.log(`  Relevant: ${isRelevant ? 'YES' : 'NO'} - ${reason}`);

            if (isRelevant) {
                // Summarize and extract topics
                const { summary, keyTerms, topics } = await summarizeStory(
                    story,
                    comments,
                    articleContent
                );
                relevantSummaries.push({
                    story,
                    summary,
                    keyTerms,
                    topics,
                    reason,
                });
                console.log(
                    `  ✓ Added to digest (${relevantSummaries.length}/${config.maxRelevantStories})\n`
                );
            } else {
                console.log('  ✗ Skipped\n');
            }

            // Mark story as processed (whether relevant or not)
            await db.markStoryAsProcessed(story.objectID);

            // Add delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Step 3: Deliver digest
        if (relevantSummaries.length > 0) {
            console.log(
                `\nDelivering digest with ${relevantSummaries.length} summaries...`
            );
            await deliverDigest(relevantSummaries);
        } else {
            console.log('\nNo relevant stories found.');
        }

        console.log('\nDone!');

        // Close database connection
        await db.closePool();
    } catch (error) {
        console.error('Error:', error);
        await db.closePool();
        process.exit(1);
    }
}

// Run the script
main();
