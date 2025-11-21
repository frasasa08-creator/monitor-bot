#!/bin/bash
echo "🚀 Starting Discord Monitor Bot Deployment..."

# Stop existing instance
pm2 stop discord-monitor-bot

# Pull latest changes (if using git)
# git pull origin main

# Install dependencies
npm install

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

echo "✅ Deployment completed!"
echo "📊 Check status with: pm2 status"
echo "📋 Check logs with: pm2 logs discord-monitor-bot"
