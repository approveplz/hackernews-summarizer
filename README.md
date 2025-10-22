# Hacker News Summarizer

Get a daily email digest of the most relevant Hacker News stories based on your interests. Uses GPT-5 to filter and summarize the top stories along with community discussion.

**Deploy to the cloud for free** or run locally - your choice!

## Features

- ✅ Smart filtering with GPT-5-mini based on your interests
- ✅ Deduplication (no repeat stories for 7 days)
- ✅ Article content extraction and analysis
- ✅ Top comment analysis from HN discussion
- ✅ Beautiful HTML email format
- ✅ **Feedback system** - Click 👍/👎 buttons in emails to train the AI
- ✅ Free deployment via Render + cron-job.org
- ✅ Free email delivery via Resend (3,000/month)

## Quick Start (Local)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Run manually to test:**
   ```bash
   npm start
   ```

## Cloud Deployment (Free!)

Deploy both the feedback server and automated daily digest for **$0/month**.

### Prerequisites

1. **Resend account** - Sign up at https://resend.com (free tier: 3,000 emails/month)
2. **OpenAI API key** - Get from https://platform.openai.com
3. **Render account** - Sign up at https://render.com (free tier)
4. **cron-job.org account** - Sign up at https://console.cron-job.org (free)

### Step 1: Generate a Secret Token

```bash
openssl rand -hex 32
```

Save this - you'll use it to secure your digest trigger endpoint.

### Step 2: Deploy to Render

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Deploy to Render"
   git push
   ```

2. **Go to Render**: https://render.com/dashboard

3. **Create a new Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub account (if not already connected)
   - Select your `hackernews-summarizer` repository
   - Render will detect the `render.yaml` file

4. **Configure the service**:
   - **Name**: `hn-feedback-server` (or any name you prefer)
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node feedback-server.js` (IMPORTANT: Not `index.js`!)
   - Click "Create Web Service"

5. **Wait for the build to complete** (2-3 minutes)
   - You'll see build logs in real-time
   - When successful, you'll get a URL like: `https://hn-feedback-server.onrender.com`

### Step 3: Configure Environment Variables in Render

After deployment, add these environment variables:

1. In your Render dashboard, click on your service
2. Go to the "Environment" tab in the left sidebar
3. Add each variable below:

| Variable | Value | Description |
|----------|-------|-------------|
| `OPENAI_API_KEY` | `sk-...` | Your OpenAI API key |
| `RESEND_API_KEY` | `re_...` | Your Resend API key |
| `EMAIL_FROM` | `digest@yourdomain.com` | Sender email (must be verified in Resend) |
| `EMAIL_TO` | `you@example.com` | Your email address |
| `USER_INTERESTS` | `AI, startups, web3` | Customize to your interests |
| `CRON_SECRET` | `abc123...` | The secret token you generated |
| `FEEDBACK_URL` | `https://your-app.onrender.com` | Your Render app URL |

### Step 4: Setup Daily Automation with cron-job.org (FREE)

Now let's set up the daily trigger using cron-job.org's free tier:

1. **Sign up for cron-job.org**:
   - Go to https://console.cron-job.org/signup
   - Create a free account (no credit card required)
   - Verify your email

2. **Create a new cron job**:
   - Go to https://console.cron-job.org/jobs/create
   - Or click "Cronjobs" → "Create cronjob" in the dashboard

3. **Configure the job**:
   - **Title**: `HN Daily Digest`
   - **Address (URL)**:
     ```
     https://hackernews-summarizer.onrender.com/trigger-digest?secret=aec9042c61baebd4a9537bb62d78d64dd16fa59f1571fa64a013fa2858f523a6
     ```
     (Replace with YOUR Render URL and YOUR secret token)

   - **Schedule**:
     - **Execution**: Every day
     - **Time**: Choose your preferred time (e.g., `09:00`)
     - **Timezone**: Select your timezone (e.g., `America/Los_Angeles`)

   - **Notifications** (optional):
     - Enable "Notify me on failure" to get alerts if it fails

   - **Request method**: GET
   - **Request timeout**: 30 seconds (or higher if needed)

4. **Save the cron job**:
   - Click "Create cronjob"
   - You'll see it in your dashboard

5. **Optional: Keep Render awake**:
   - Render free tier sleeps after 15 minutes of inactivity
   - First request after sleep takes ~30 seconds to wake up
   - **Solution**: Create a second cron job to ping every 14 minutes:
     - **Title**: `Keep HN Server Awake`
     - **URL**: `https://hackernews-summarizer.onrender.com/health`
     - **Schedule**: Every 14 minutes (cron expression: `*/14 * * * *`)
     - This keeps your server warm and ensures fast digest generation

### Step 5: Test Your Setup

**Test the trigger endpoint manually:**

```bash
curl "https://hackernews-summarizer.onrender.com/trigger-digest?secret=aec9042c61baebd4a9537bb62d78d64dd16fa59f1571fa64a013fa2858f523a6"
```

**Expected response:**
```json
{"status":"started","message":"Digest generation started in background"}
```

**Check your email** in 2-3 minutes! You should receive a digest with relevant HN stories.

**Verify in cron-job.org:**
- Go to your dashboard
- Check the "Executions" tab for your job
- You should see a successful execution with status 200

## How It Works

Every day at your scheduled time:

1. **cron-job.org** calls your `/trigger-digest` endpoint
2. Server **fetches** top 10 stories from Hacker News front page
3. **Filters** using GPT-5-mini based on your interests
4. **Skips** stories already processed (tracked for 7 days)
5. **Summarizes** relevant stories using GPT-5
6. **Emails** digest with story summaries, discussion insights, and why each story is relevant

## Feedback System

Each email includes 👍/👎 buttons to rate story relevance. Your feedback:
- Stored in `feedback-history.json` on the server
- Automatically improves future story filtering
- Uses past examples to refine GPT-5-mini's recommendations

The system learns your preferences over time - just click the buttons!

## What You Get

Each email includes:
- 📰 Story title and link
- 💬 HN discussion link with points/comments
- 🎯 **Why you might be interested** (AI reasoning based on your feedback)
- 📝 2-3 sentence summary
- 💡 Key insights from discussion
- 👍 👎 Feedback buttons to train the AI

## Customization

- **Change interests:** Update `USER_INTERESTS` in Render environment variables
- **Change schedule:** Update your cron-job.org schedule
- **More/fewer stories:** Change `hitsPerPage` in `fetchTopStories()` (index.js:112)
- **Longer history:** Adjust `HISTORY_EXPIRY_DAYS` (index.js:14)

## Local Development

Run the feedback server locally:

```bash
npm run feedback
```

Run the digest script locally:

```bash
npm start
```

## API Endpoints

- `GET /health` - Health check
- `GET /feedback?story=ID&rating=positive|negative` - Submit feedback (called by email buttons)
- `GET /trigger-digest?secret=SECRET` - Trigger digest generation (called by cron-job.org)

## Troubleshooting

**Render free tier sleep:**
- Free tier web services sleep after 15 minutes of inactivity
- First request after sleep takes ~30 seconds to wake up
- Optional: Set up a second cron-job.org job to ping `/health` every 14 minutes to keep it awake

**No emails received:**
- Check Render logs for errors
- Verify all environment variables are set
- Ensure `EMAIL_FROM` is verified in Resend dashboard
- Check Resend dashboard for delivery status

**Wrong stories:**
- Click 👍/👎 buttons in emails to train the system
- Update `USER_INTERESTS` to be more specific
- After 5-10 feedback submissions, filtering improves significantly

## Cost Breakdown

| Service | Free Tier | What We Use |
|---------|-----------|-------------|
| Render | 750 hours/month | ~1 hour/month (digest runs ~2min/day) |
| cron-job.org | Unlimited | 1 job, daily trigger |
| Resend | 3,000 emails/month | ~30 emails/month (1 per day) |
| OpenAI | Pay as you go | ~$0.10-0.30/month |

**Total: ~$0.10-0.30/month** (OpenAI API costs only)
