# Hacker News Summarizer

Get a daily email digest of the most relevant Hacker News stories based on your interests. Uses GPT-5 to filter and summarize the top stories along with community discussion.

## Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure `.env` file:**
   ```bash
   OPENAI_API_KEY=your_key_here
   USER_INTERESTS=AI, machine learning, startups, developer tools
   DELIVERY_METHOD=resend
   RESEND_API_KEY=your_resend_key
   EMAIL_FROM=onboarding@resend.dev
   EMAIL_TO=your@email.com
   ```

3. **Run manually to test:**
   ```bash
   npm start
   ```

## How It Works

Every day (or when you run manually):

1. **Fetches** top 10 stories from Hacker News front page
2. **Filters** using GPT-5-mini based on your interests
3. **Skips** stories already processed (tracked for 7 days)
4. **Summarizes** relevant stories using GPT-5
5. **Emails** digest with story summaries, discussion insights, and why each story is relevant to you

## Daily Automation

A cron job runs every morning at 6 AM:
```bash
# Already set up in crontab
0 6 * * * /path/to/run-daily.sh
```

Check logs: `tail -f cron.log`

## What You Get

Each email includes:
- 📰 Story title and link
- 💬 HN discussion link with points/comments
- 🎯 **Why you might be interested** (AI reasoning)
- 📝 2-3 sentence summary
- 💡 Key insights from discussion

## Customization

- **Change interests:** Edit `USER_INTERESTS` in `.env`
- **More/fewer stories:** Change `hitsPerPage` in `fetchTopStories()` (line 73)
- **Longer history:** Adjust `HISTORY_EXPIRY_DAYS` (line 14)

## Features

- ✅ Smart filtering with GPT-5-mini
- ✅ Deduplication (no repeat stories)
- ✅ Article content extraction
- ✅ Top comment analysis
- ✅ Beautiful HTML email format
- ✅ Free email delivery via Resend (3,000/month)
- ✅ Fully automated daily delivery
- ✅ **Feedback system** - Click buttons in email to train the AI

## Feedback System

Each email includes 👍/👎 buttons to rate story relevance. Your feedback:
- Is stored locally in `feedback-history.json`
- Automatically improves future story filtering
- Uses past examples to refine GPT-5-mini's recommendations

**To use feedback:**
1. Start the feedback server: `npm run feedback`
2. Click buttons in your daily emails
3. System learns your preferences over time

For production: Deploy feedback server to Railway/Render and update `FEEDBACK_URL` in `.env`
