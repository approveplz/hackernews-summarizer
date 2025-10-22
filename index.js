require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Path to the processed stories history file
const HISTORY_FILE = path.join(__dirname, 'processed-stories.json');
const HISTORY_EXPIRY_DAYS = config.historyExpiryDays;

// Path to the feedback history file
const FEEDBACK_FILE = path.join(__dirname, 'feedback-history.json');

// Load processed stories history
function loadProcessedStories() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading processed stories:', error.message);
  }
  return {};
}

// Save processed stories history
function saveProcessedStories(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving processed stories:', error.message);
  }
}

// Clean up old entries from history
function cleanupOldEntries(history) {
  const now = Date.now();
  const expiryTime = HISTORY_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  let cleaned = 0;
  for (const [storyId, timestamp] of Object.entries(history)) {
    if (now - timestamp > expiryTime) {
      delete history[storyId];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} old entries from history`);
    saveProcessedStories(history);
  }

  return history;
}

// Add story to processed history
function markStoryAsProcessed(history, storyId) {
  history[storyId] = Date.now();
  saveProcessedStories(history);
}

// Load feedback history
function loadFeedback() {
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      const data = fs.readFileSync(FEEDBACK_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading feedback:', error.message);
  }
  return { positive: [], negative: [] };
}

// Format feedback examples for prompt
function formatFeedbackExamples(feedback) {
  let examples = '';

  if (feedback.positive.length > 0) {
    const recent = feedback.positive.slice(-5); // Get last 5
    examples += '\n\nExamples of stories the user found RELEVANT:\n';
    recent.forEach((f, i) => {
      examples += `${i + 1}. "${f.title}"\n`;
    });
  }

  if (feedback.negative.length > 0) {
    const recent = feedback.negative.slice(-5); // Get last 5
    examples += '\n\nExamples of stories the user found NOT RELEVANT:\n';
    recent.forEach((f, i) => {
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
      hitsPerPage: config.topStoriesCount
    }
  });

  return response.data.hits;
}

// Fetch story details including comments from Algolia
async function fetchStoryWithComments(storyId) {
  const response = await axios.get(`https://hn.algolia.com/api/v1/items/${storyId}`);
  return response.data;
}

// Extract top comment threads
function extractTopComments(story, maxComments = config.maxCommentsPerStory) {
  if (!story.children || story.children.length === 0) {
    return [];
  }

  return story.children.slice(0, maxComments).map(comment => ({
    author: comment.author,
    text: comment.text,
    points: comment.points
  }));
}

// Fetch article content from URL
async function fetchArticleContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HN-Summarizer/1.0)'
      }
    });

    const $ = cheerio.load(response.data);

    // Remove script, style, and nav elements
    $('script, style, nav, header, footer').remove();

    // Try to get main content
    const article = $('article').text() || $('main').text() || $('body').text();

    // Clean up whitespace
    return article.replace(/\s+/g, ' ').trim().slice(0, 5000); // Limit to 5000 chars
  } catch (error) {
    console.error(`Error fetching article from ${url}:`, error.message);
    return null;
  }
}

// Check if story is relevant using OpenAI o3-mini
async function checkRelevance(story, comments, articleContent, userInterests) {
  const topComments = comments.map((c, i) =>
    `Comment ${i + 1} by ${c.author}:\n${c.text}`
  ).join('\n\n');

  // Load feedback to improve relevance detection
  const feedback = loadFeedback();
  const feedbackExamples = formatFeedbackExamples(feedback);

  const prompt = `You are helping filter Hacker News stories based on user interests.

User interests: ${userInterests}
${feedbackExamples}

Story title: ${story.title}
Story URL: ${story.url || 'Discussion only'}
${articleContent ? `Article content (excerpt): ${articleContent.slice(0, 1000)}` : ''}

Top comments from HN discussion:
${topComments || 'No comments yet'}

Based on the user's interests, the story content, the HN discussion, and the examples of past feedback, is this story relevant?
Answer only YES or NO, followed by a brief one-sentence reason.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [
      { role: 'user', content: prompt }
    ]
  });

  const answer = response.choices[0].message.content.trim();
  const isRelevant = answer.toUpperCase().startsWith('YES');

  return { isRelevant, reason: answer };
}

// Summarize relevant story and extract key terms
async function summarizeStory(story, comments, articleContent) {
  const topComments = comments.map((c, i) =>
    `Comment ${i + 1} by ${c.author}:\n${c.text}`
  ).join('\n\n');

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
      messages: [{ role: 'user', content: summaryPrompt }]
    }),
    openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: keyTermsPrompt }]
    })
  ]);

  return {
    summary: summaryResponse.choices[0].message.content,
    keyTerms: keyTermsResponse.choices[0].message.content
  };
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

  ${summaries.map((s, i) => {
    const feedbackUrl = process.env.FEEDBACK_URL || 'http://localhost:3000';
    const encodedTitle = encodeURIComponent(s.story.title);
    const encodedUrl = encodeURIComponent(s.story.url || '');

    return `
    <div class="story">
      <h2>${i + 1}. ${s.story.title}</h2>
      ${s.story.url ? `<p><strong>URL:</strong> <a href="${s.story.url}" target="_blank">${s.story.url}</a></p>` : ''}
      <p class="meta">
        <a href="https://news.ycombinator.com/item?id=${s.story.objectID}" target="_blank">View on HN</a>
        | ${s.story.points} points
        | ${s.story.num_comments || 0} comments
      </p>
      <div class="why-relevant"><strong>Why you might be interested:</strong> ${s.reason}</div>
      <div class="summary">${s.summary}</div>
      ${s.keyTerms ? `<div class="key-terms">
        <h3>📚 Key Terms & Concepts</h3>
        <div class="key-terms-content">${s.keyTerms}</div>
      </div>` : ''}
      <div class="feedback">
        <p>Was this story relevant to you?</p>
        <div class="feedback-buttons">
          <a href="${feedbackUrl}/feedback?story=${s.story.objectID}&rating=positive&title=${encodedTitle}&url=${encodedUrl}" class="feedback-btn positive">👍 Yes, relevant</a>
          <a href="${feedbackUrl}/feedback?story=${s.story.objectID}&rating=negative&title=${encodedTitle}&url=${encodedUrl}" class="feedback-btn negative">👎 Not relevant</a>
        </div>
      </div>
    </div>
  `;
  }).join('')}
</body>
</html>
  `.trim();
}

// Delivery methods - easy to swap or extend
const deliveryMethods = {
  // Save to local HTML file
  file: async (summaries, date) => {
    const html = generateDigestHTML(summaries, date);
    const filename = `hn-digest-${date}.html`;
    const filepath = path.join(process.cwd(), filename);

    fs.writeFileSync(filepath, html, 'utf8');
    console.log(`✓ Digest saved to: ${filename}`);
    console.log(`  Open with: open ${filename}`);

    return filepath;
  },

  // Resend API
  resend: async (summaries, date) => {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const html = generateDigestHTML(summaries, date);

    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: `HN Digest - ${summaries.length} relevant stories from ${date}`,
      html: html
    });

    console.log('✓ Email sent via Resend');
  }
};

// Deliver digest using configured method
async function deliverDigest(summaries) {
  const date = new Date().toISOString().split('T')[0];
  const method = process.env.DELIVERY_METHOD || 'file';

  if (!deliveryMethods[method]) {
    throw new Error(`Unknown delivery method: ${method}. Available: ${Object.keys(deliveryMethods).join(', ')}`);
  }

  return await deliveryMethods[method](summaries, date);
}

// Main function
async function main() {
  try {
    console.log('Starting HN summarizer...\n');

    // Load and cleanup processed stories history
    let processedStories = loadProcessedStories();
    processedStories = cleanupOldEntries(processedStories);

    // User interests (configure in config.js)
    const userInterests = config.userInterests.join(', ');

    // Step 1: Fetch top stories
    const allStories = await fetchTopStories();
    console.log(`Found ${allStories.length} top stories`);

    // Filter out already processed stories
    const stories = allStories.filter(story => !processedStories[story.objectID]);
    const skippedCount = allStories.length - stories.length;

    if (skippedCount > 0) {
      console.log(`Skipped ${skippedCount} already-processed stories`);
    }
    console.log(`Processing ${stories.length} new stories\n`);

    const relevantSummaries = [];

    // Step 2: Process each story
    for (const story of stories) {
      console.log(`Processing: ${story.title}`);

      // Fetch full story with comments
      const fullStory = await fetchStoryWithComments(story.objectID);
      const comments = extractTopComments(fullStory);

      // Fetch article content if URL exists
      let articleContent = null;
      if (story.url) {
        articleContent = await fetchArticleContent(story.url);
      }

      // Check relevance
      const { isRelevant, reason } = await checkRelevance(story, comments, articleContent, userInterests);
      console.log(`  Relevant: ${isRelevant ? 'YES' : 'NO'} - ${reason}`);

      if (isRelevant) {
        // Summarize
        const { summary, keyTerms } = await summarizeStory(story, comments, articleContent);
        relevantSummaries.push({ story, summary, keyTerms, reason });
        console.log('  ✓ Added to digest\n');
      } else {
        console.log('  ✗ Skipped\n');
      }

      // Mark story as processed (whether relevant or not)
      markStoryAsProcessed(processedStories, story.objectID);

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 3: Deliver digest
    if (relevantSummaries.length > 0) {
      console.log(`\nDelivering digest with ${relevantSummaries.length} summaries...`);
      await deliverDigest(relevantSummaries);
    } else {
      console.log('\nNo relevant stories found.');
    }

    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the script
main();
