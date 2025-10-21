require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || process.env.FEEDBACK_PORT || 3000;

// Feedback storage file
const FEEDBACK_FILE = path.join(__dirname, 'feedback-history.json');

// Middleware
app.use(cors());
app.use(express.json());

// Load existing feedback
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

// Save feedback
function saveFeedback(feedback) {
  try {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving feedback:', error.message);
  }
}

// Feedback endpoint
app.get('/feedback', (req, res) => {
  const { story, rating, title, url } = req.query;

  if (!story || !rating) {
    return res.status(400).send('Missing required parameters: story, rating');
  }

  if (!['positive', 'negative'].includes(rating)) {
    return res.status(400).send('Rating must be "positive" or "negative"');
  }

  // Load existing feedback
  const feedback = loadFeedback();

  // Add new feedback entry
  const entry = {
    storyId: story,
    title: decodeURIComponent(title || 'Unknown'),
    url: decodeURIComponent(url || ''),
    timestamp: Date.now(),
    userInterests: process.env.USER_INTERESTS || 'Not specified'
  };

  feedback[rating].push(entry);

  // Save updated feedback
  saveFeedback(feedback);

  console.log(`Feedback received: ${rating} for story ${story}`);

  // Send a nice HTML response
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Feedback Recorded</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          background: #f5f5f5;
        }
        .container {
          text-align: center;
          padding: 40px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          max-width: 400px;
        }
        .icon {
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          margin: 0 0 10px 0;
          font-size: 24px;
        }
        p {
          color: #666;
          line-height: 1.6;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${rating === 'positive' ? '👍' : '👎'}</div>
        <h1>Thanks for your feedback!</h1>
        <p>Your preference has been recorded and will help improve future story recommendations.</p>
      </div>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', feedbackCount: loadFeedback() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Feedback server running on http://localhost:${PORT}`);
  console.log(`Feedback endpoint: http://localhost:${PORT}/feedback`);
});
