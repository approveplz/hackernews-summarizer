#!/bin/bash

# Load nvm and use the correct node version
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Change to script directory
cd /Users/alanzhang/dev/inversion-consultants/hackernews-summarizer

# Run the summarizer
node index.js >> /Users/alanzhang/dev/inversion-consultants/hackernews-summarizer/cron.log 2>&1

# Log completion
echo "Cron job completed at $(date)" >> /Users/alanzhang/dev/inversion-consultants/hackernews-summarizer/cron.log
