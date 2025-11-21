// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'discord-monitor-bot',
    script: './index.js',
    
    // CONFIGURAZIONE BASE
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    
    // VARIABILI D'AMBIENTE
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    
    // CONFIGURAZIONE LOG
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    time: true,
    
    // RESTART STRATEGIES
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // MONITORING PM2
    exp_backoff_restart_delay: 100
  }]
};
