// Alternativa ao Docker: pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'zapauto',
      script: 'src/server.js',
      node_args: '--env-file-if-exists=.env',
      autorestart: true,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
