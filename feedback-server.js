require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || process.env.FEEDBACK_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Feedback endpoint
app.get('/feedback', async (req, res) => {
  const { story, rating, title, url } = req.query;

  if (!story || !rating) {
    return res.status(400).send('Missing required parameters: story, rating');
  }

  if (!['positive', 'negative'].includes(rating)) {
    return res.status(400).send('Rating must be "positive" or "negative"');
  }

  // Save feedback to database
  await db.saveFeedback(
    story,
    decodeURIComponent(title || 'Unknown'),
    decodeURIComponent(url || ''),
    rating
  );

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
app.get('/health', async (req, res) => {
  const feedback = await db.loadFeedback();
  res.json({
    status: 'ok',
    feedbackCount: {
      positive: feedback.positive.length,
      negative: feedback.negative.length
    }
  });
});

// Trigger digest endpoint (for cron-job.org)
app.get('/trigger-digest', (req, res) => {
  const { secret } = req.query;

  // Verify secret token
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Digest triggered via cron endpoint');

  // Spawn the digest script as a child process
  const digest = spawn('node', ['index.js'], {
    cwd: __dirname,
    env: process.env
  });

  let output = '';
  let errorOutput = '';

  digest.stdout.on('data', (data) => {
    const message = data.toString();
    output += message;
    console.log(message);
  });

  digest.stderr.on('data', (data) => {
    const message = data.toString();
    errorOutput += message;
    console.error(message);
  });

  digest.on('close', (code) => {
    if (code === 0) {
      console.log('Digest completed successfully');
    } else {
      console.error(`Digest process exited with code ${code}`);
    }
  });

  // Respond immediately (don't wait for digest to finish)
  res.json({
    status: 'started',
    message: 'Digest generation started in background'
  });
});

// Get all interests
app.get('/interests', async (req, res) => {
  try {
    const interests = await db.loadInterests();
    res.json({
      count: interests.length,
      interests: interests
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load interests' });
  }
});

// Replace all interests (requires secret)
app.post('/interests', async (req, res) => {
  const { secret, interests } = req.body;

  // Verify secret token
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!Array.isArray(interests)) {
    return res.status(400).json({ error: 'interests must be an array' });
  }

  try {
    await db.saveInterests(interests);
    res.json({
      success: true,
      message: `Updated interests (${interests.length} total)`,
      interests: interests
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save interests' });
  }
});

// Add a single interest (requires secret)
app.post('/interests/add', async (req, res) => {
  const { secret, interest } = req.body;

  // Verify secret token
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!interest || typeof interest !== 'string') {
    return res.status(400).json({ error: 'interest must be a string' });
  }

  try {
    await db.addInterest(interest);
    const allInterests = await db.loadInterests();
    res.json({
      success: true,
      message: `Added interest: ${interest}`,
      interests: allInterests
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add interest' });
  }
});

// Remove a single interest (requires secret)
app.delete('/interests/:interest', async (req, res) => {
  const { secret } = req.query;
  const { interest } = req.params;

  // Verify secret token
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await db.removeInterest(interest);
    const allInterests = await db.loadInterests();
    res.json({
      success: true,
      message: `Removed interest: ${interest}`,
      interests: allInterests
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove interest' });
  }
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database tables
    await db.initializeDatabase();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`Feedback server running on http://localhost:${PORT}`);
      console.log(`Feedback endpoint: http://localhost:${PORT}/feedback`);
      console.log(`Digest trigger endpoint: http://localhost:${PORT}/trigger-digest`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
