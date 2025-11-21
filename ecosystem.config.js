// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'discord-monitor-bot',
    script: './index.js',
    
    // USA FORK MODE INVECE DI CLUSTER
    exec_mode: 'fork',
    instances: 1,
    
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    
    // VARIABILI D'AMBIENTE
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    
    // LOG PATH RELATIVI
    log_file: './logs/combined.log',
    out_file: './logs/out.log', 
    error_file: './logs/error.log',
    time: true
  }]
};
