const { Pool } = require('pg');

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  const client = await pool.connect();

  try {
    // Create processed_stories table
    await client.query(`
      CREATE TABLE IF NOT EXISTS processed_stories (
        story_id TEXT PRIMARY KEY,
        processed_at BIGINT NOT NULL
      )
    `);

    // Create feedback_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback_history (
        id SERIAL PRIMARY KEY,
        story_id TEXT NOT NULL,
        title TEXT,
        url TEXT,
        rating TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);

    // Create interests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS interests (
        id SERIAL PRIMARY KEY,
        interest TEXT NOT NULL UNIQUE,
        created_at BIGINT NOT NULL
      )
    `);

    // Create not_interested table
    await client.query(`
      CREATE TABLE IF NOT EXISTS not_interested (
        id SERIAL PRIMARY KEY,
        term TEXT NOT NULL UNIQUE,
        created_at BIGINT NOT NULL
      )
    `);

    console.log('Database tables initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Load processed stories from database
async function loadProcessedStories() {
  try {
    const result = await pool.query('SELECT story_id, processed_at FROM processed_stories');
    const stories = {};
    result.rows.forEach(row => {
      stories[row.story_id] = row.processed_at;
    });
    return stories;
  } catch (error) {
    console.error('Error loading processed stories:', error);
    return {};
  }
}

// Mark story as processed
async function markStoryAsProcessed(storyId) {
  try {
    await pool.query(
      'INSERT INTO processed_stories (story_id, processed_at) VALUES ($1, $2) ON CONFLICT (story_id) DO NOTHING',
      [storyId, Date.now()]
    );
  } catch (error) {
    console.error('Error marking story as processed:', error);
  }
}

// Clean up old entries from database
async function cleanupOldEntries(expiryDays) {
  try {
    const expiryTime = Date.now() - (expiryDays * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      'DELETE FROM processed_stories WHERE processed_at < $1',
      [expiryTime]
    );

    if (result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} old entries from database`);
    }
  } catch (error) {
    console.error('Error cleaning up old entries:', error);
  }
}

// Load feedback history from database
async function loadFeedback() {
  try {
    const result = await pool.query(
      'SELECT story_id, title, url, rating, created_at FROM feedback_history ORDER BY created_at ASC'
    );

    const feedback = { positive: [], negative: [] };
    result.rows.forEach(row => {
      const item = {
        storyId: row.story_id,
        title: row.title,
        url: row.url,
        timestamp: row.created_at
      };

      if (row.rating === 'positive') {
        feedback.positive.push(item);
      } else if (row.rating === 'negative') {
        feedback.negative.push(item);
      }
    });

    return feedback;
  } catch (error) {
    console.error('Error loading feedback:', error);
    return { positive: [], negative: [] };
  }
}

// Save feedback to database
async function saveFeedback(storyId, title, url, rating) {
  try {
    await pool.query(
      'INSERT INTO feedback_history (story_id, title, url, rating, created_at) VALUES ($1, $2, $3, $4, $5)',
      [storyId, title, url, rating, Date.now()]
    );
  } catch (error) {
    console.error('Error saving feedback:', error);
  }
}

// Load interests from database
async function loadInterests() {
  try {
    const result = await pool.query('SELECT interest FROM interests ORDER BY id ASC');
    return result.rows.map(row => row.interest);
  } catch (error) {
    console.error('Error loading interests:', error);
    return [];
  }
}

// Save interests to database (replaces all existing interests)
async function saveInterests(interests) {
  const client = await pool.connect();
  try {
    // Start transaction
    await client.query('BEGIN');

    // Clear existing interests
    await client.query('DELETE FROM interests');

    // Insert new interests
    for (const interest of interests) {
      await client.query(
        'INSERT INTO interests (interest, created_at) VALUES ($1, $2)',
        [interest, Date.now()]
      );
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log(`Saved ${interests.length} interests to database`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving interests:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Add a single interest
async function addInterest(interest) {
  try {
    await pool.query(
      'INSERT INTO interests (interest, created_at) VALUES ($1, $2) ON CONFLICT (interest) DO NOTHING',
      [interest, Date.now()]
    );
  } catch (error) {
    console.error('Error adding interest:', error);
  }
}

// Remove a single interest
async function removeInterest(interest) {
  try {
    await pool.query('DELETE FROM interests WHERE interest = $1', [interest]);
  } catch (error) {
    console.error('Error removing interest:', error);
  }
}

// Load not interested terms from database
async function loadNotInterested() {
  try {
    const result = await pool.query('SELECT term FROM not_interested ORDER BY id ASC');
    return result.rows.map(row => row.term);
  } catch (error) {
    console.error('Error loading not interested terms:', error);
    return [];
  }
}

// Add a term to not interested list
async function addNotInterested(term) {
  try {
    await pool.query(
      'INSERT INTO not_interested (term, created_at) VALUES ($1, $2) ON CONFLICT (term) DO NOTHING',
      [term, Date.now()]
    );
  } catch (error) {
    console.error('Error adding not interested term:', error);
  }
}

// Remove a term from not interested list
async function removeNotInterested(term) {
  try {
    await pool.query('DELETE FROM not_interested WHERE term = $1', [term]);
  } catch (error) {
    console.error('Error removing not interested term:', error);
  }
}

// Close pool (for graceful shutdown)
async function closePool() {
  await pool.end();
}

module.exports = {
  initializeDatabase,
  loadProcessedStories,
  markStoryAsProcessed,
  cleanupOldEntries,
  loadFeedback,
  saveFeedback,
  loadInterests,
  saveInterests,
  addInterest,
  removeInterest,
  loadNotInterested,
  addNotInterested,
  removeNotInterested,
  closePool
};
