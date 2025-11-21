// monitor-bot/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

const app = express();

// CONFIGURAZIONE DA .env
const config = {
    mainBotId: process.env.MAIN_BOT_ID,
    statusChannelId: process.env.STATUS_CHANNEL_ID,
    checkInterval: parseInt(process.env.CHECK_INTERVAL) || 10000,
    guildId: process.env.GUILD_ID,
    adminUserId: process.env.ADMIN_USER_ID,
    port: parseInt(process.env.PORT) || 3001,
    renderHealthCheckUrl: process.env.RENDER_HEALTH_CHECK_URL,
    renderPingInterval: parseInt(process.env.RENDER_PING_INTERVAL) || 30000
};

// Verifica che tutte le variabili siano presenti
const requiredEnvVars = ['DISCORD_TOKEN', 'MAIN_BOT_ID', 'STATUS_CHANNEL_ID', 'GUILD_ID'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Variabile d'ambiente mancante: ${envVar}`);
        process.exit(1);
    }
}

let statusMessage = null;
let lastStatus = null;
let mainBotStatus = {
    online: false,
    lastSeen: null,
    uptime: 0,
    startedAt: Date.now(),
    lastChange: null,
    monitorStartTime: Date.now()
};

client.once('ready', async () => {
    console.log(`✅ Bot Monitor online! Loggato come ${client.user.tag}`);
    console.log(`📊 Configurazione caricata:`);
    console.log(`   - Server: ${config.guildId}`);
    console.log(`   - Canale Status: ${config.statusChannelId}`);
    console.log(`   - Check ogni: ${config.checkInterval}ms`);
    
    // PRIMA avvia il server web (IMPORTANTE per Render)
    startWebServer();
    
    // POI aspetta 3 secondi che il server web sia pronto
    setTimeout(async () => {
        await findExistingStatusMessage();
        startMonitoring();
        startKeepAlive(); // Avvia il keep-alive per Render
        
        console.log('🔄 Tutti i servizi avviati con successo');
    }, 3000);
});

// CERCA IL MESSAGGIO DI STATUS ESISTENTE
async function findExistingStatusMessage() {
    try {
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) {
            console.log('❌ Server non trovato');
            return;
        }

        const channel = guild.channels.cache.get(config.statusChannelId);
        if (!channel) {
            console.log('❌ Canale status non trovato');
            return;
        }

        const messages = await channel.messages.fetch({ limit: 50 });
        const existingMessage = messages.find(msg => 
            msg.author.id === client.user.id && 
            msg.embeds.length > 0 &&
            msg.embeds[0].title?.includes('STATUS BOT PRINCIPALE')
        );

        if (existingMessage) {
            statusMessage = existingMessage;
            console.log('📨 Messaggio di status esistente trovato');
        }
    } catch (error) {
        console.error('Errore nella ricerca del messaggio:', error);
    }
}

// FUNZIONE PRINCIPALE DI MONITORING
async function startMonitoring() {
    setInterval(async () => {
        try {
            const guild = client.guilds.cache.get(config.guildId);
            if (!guild) return;

            const channel = guild.channels.cache.get(config.statusChannelId);
            if (!channel) return;

            let mainBotMember;
            try {
                mainBotMember = await guild.members.fetch(config.mainBotId);
            } catch (error) {
                mainBotMember = null;
            }

            const wasOnline = mainBotStatus.online;
            const nowOnline = mainBotMember?.presence?.status === 'online';

            mainBotStatus.online = nowOnline;
            mainBotStatus.lastSeen = new Date();
            
            if (nowOnline) {
                if (mainBotStatus.startedAt === 0) {
                    mainBotStatus.startedAt = Date.now();
                    mainBotStatus.lastChange = new Date();
                }
                mainBotStatus.uptime = Date.now() - mainBotStatus.startedAt;
            } else {
                if (mainBotStatus.startedAt !== 0) {
                    mainBotStatus.lastChange = new Date();
                }
                mainBotStatus.startedAt = 0;
            }

            const statusEmbed = createStatusEmbed(mainBotMember, nowOnline, wasOnline !== nowOnline);
            await updateStatusMessage(channel, statusEmbed, wasOnline !== nowOnline);

            lastStatus = nowOnline;

        } catch (error) {
            console.error('❌ Errore nel monitoring:', error);
        }
    }, config.checkInterval);
}

// KEEP-ALIVE PER RENDER.COM - VERSIONE MIGLIORATA
function startKeepAlive() {
    if (!config.renderHealthCheckUrl) {
        console.log('ℹ️  URL health check non configurato, skip keep-alive');
        return;
    }

    const healthCheckUrl = `${config.renderHealthCheckUrl}/health`;
    console.log(`🟢 Keep-alive configurato per: ${healthCheckUrl}`);

    // Aspetta 10 secondi prima del primo ping per dare tempo al server di avviarsi
    setTimeout(() => {
        // Test iniziale
        axios.get(healthCheckUrl, { timeout: 15000 })
            .then(response => {
                console.log(`✅ Health check iniziale riuscito: ${response.status}`);
            })
            .catch(error => {
                console.log(`⚠️  Health check iniziale fallito: ${error.message}`);
            });

        // Interval regolare
        const keepAliveInterval = setInterval(async () => {
            try {
                const response = await axios.get(`${healthCheckUrl}?ping=${Date.now()}&source=keepalive`, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Discord-Monitor-Bot/1.0'
                    }
                });
                
                if (response.status === 200) {
                    console.log(`🟢 Keep-alive ping riuscito (${response.data.status})`);
                } else {
                    console.log(`🟡 Keep-alive risposta: ${response.status}`);
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    console.log('🔴 Keep-alive: Server non raggiungibile');
                } else if (error.response) {
                    // Server rispose ma con errore
                    console.log(`🟡 Keep-alive: ${error.response.status} ${error.response.statusText}`);
                } else if (error.code === 'ETIMEDOUT') {
                    console.log('🟡 Keep-alive: Timeout');
                } else {
                    console.log('🟡 Keep-alive errore:', error.message);
                }
            }
        }, config.renderPingInterval);

        console.log(`🟢 Keep-alive attivo ogni ${config.renderPingInterval/1000} secondi`);

    }, 10000); // Ritardo iniziale di 10 secondi
}

function createStatusEmbed(mainBotMember, isOnline, statusChanged) {
    const embed = new EmbedBuilder()
        .setTitle('🤖 **STATUS BOT PRINCIPALE - LIVE**')
        .setColor(isOnline ? '#00ff00' : '#ff0000')
        .setFooter({ text: `Aggiornato automaticamente ogni ${config.checkInterval/1000} secondi` })
        .setTimestamp();

    if (statusChanged) {
        if (isOnline) {
            embed.setDescription(`🟢 **SISTEMA RICONNESSO** - Il bot principale è tornato online\n*Tutti i sistemi sono ora operativi*`);
        } else {
            embed.setDescription(`🔴 **SISTEMA OFFLINE** - Il bot principale non risponde\n**<@${config.adminUserId}> Intervento richiesto!**`);
        }
    } else {
        if (isOnline && mainBotMember) {
            embed.setDescription(`🟢 **SISTEMA OPERATIVO** - Tutte le funzionalità disponibili`);
        } else {
            embed.setDescription(`🔴 **SISTEMA OFFLINE** - Il bot principale non risponde`);
        }
    }

    if (isOnline && mainBotMember) {
        embed.addFields(
            { name: '📊 Stato Attuale', value: '```🟢 ONLINE```', inline: true },
            { name: '⏰ Uptime Corrente', value: `\`\`\`${formatUptime(mainBotStatus.uptime)}\`\`\``, inline: true },
            { name: '🖥️ Ping', value: `\`\`\`${client.ws.ping}ms\`\`\``, inline: true },
            { name: '📈 Statistiche Server', value: `\`\`\`${mainBotMember.guild.memberCount} membri\`\`\``, inline: true },
            { name: '🕒 Ultimo Cambiamento', value: mainBotStatus.lastChange ? `<t:${Math.floor(mainBotStatus.lastChange.getTime()/1000)}:R>` : 'Nessun cambiamento', inline: true },
            { name: '👋 Ultimo Check', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true }
        );
    } else {
        embed.addFields(
            { name: '📊 Stato Attuale', value: '```🔴 OFFLINE```', inline: true },
            { name: '🚨 Tempo Offline', value: `\`\`\`${formatUptime(Date.now() - (mainBotStatus.lastChange?.getTime() || Date.now()))}\`\`\``, inline: true },
            { name: '🖥️ Monitor Status', value: '```🟢 ATTIVO```', inline: true },
            { name: '⏰ Ultima Volta Online', value: mainBotStatus.lastSeen ? `<t:${Math.floor(mainBotStatus.lastSeen.getTime()/1000)}:R>` : 'Mai online', inline: true },
            { name: '🕒 Ultimo Cambiamento', value: mainBotStatus.lastChange ? `<t:${Math.floor(mainBotStatus.lastChange.getTime()/1000)}:R>` : 'Nessun cambiamento', inline: true },
            { name: '👋 Ultimo Check', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true }
        );
    }

    return embed;
}

async function updateStatusMessage(channel, embed, statusChanged) {
    try {
        if (!statusMessage) {
            statusMessage = await channel.send({ embeds: [embed] });
            console.log('📨 Nuovo messaggio di status creato');
        } else {
            await statusMessage.edit({ embeds: [embed] });
            
            if (statusChanged && !mainBotStatus.online && config.adminUserId) {
                const mentionMsg = await channel.send(`<@${config.adminUserId}>`);
                setTimeout(async () => {
                    try {
                        await mentionMsg.delete();
                    } catch (error) {
                        console.log('Impossibile eliminare la mention');
                    }
                }, 2000);
            }
        }
    } catch (error) {
        console.error('Errore nell\'aggiornare il messaggio:', error);
        if (error.code === 10008) {
            statusMessage = null;
        }
    }
}

function formatUptime(ms) {
    if (ms === 0) return '0m';
    
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((ms % (60 * 1000)) / 1000);
    
    if (days > 0) return `${days}g ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// WEB SERVER PER LA DASHBOARD CON HEALTH CHECK
function startWebServer() {
    app.use(express.json());

    // HEALTH CHECK ENDPOINT (per Render.com)
    app.get('/health', (req, res) => {
        try {
            const botStatus = client.isReady() ? 'connected' : 'disconnected';
            const uptime = Date.now() - mainBotStatus.monitorStartTime;
            const memoryUsage = process.memoryUsage();
            
            const healthData = {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: formatUptime(uptime),
                bot: {
                    status: botStatus,
                    readyAt: client.readyAt ? client.readyAt.toISOString() : null,
                    guilds: client.guilds.cache.size,
                    ping: client.ws.ping
                },
                monitor: {
                    mainBotOnline: mainBotStatus.online,
                    lastCheck: mainBotStatus.lastSeen,
                    lastChange: mainBotStatus.lastChange
                },
                system: {
                    memory: {
                        used: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                        total: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`
                    },
                    uptime: process.uptime(),
                    version: process.version
                },
                request: {
                    source: req.query.source || 'direct',
                    ping: req.query.ping || null
                }
            };
    
            // Se il bot Discord non è connesso, ritorna 503
            if (!client.isReady()) {
                healthData.status = 'degraded';
                healthData.message = 'Bot Discord non connesso';
                return res.status(503).json(healthData);
            }
    
            res.status(200).json(healthData);
        } catch (error) {
            res.status(500).json({
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    // ENDPOINT STATUS API
    app.get('/api/status', (req, res) => {
        res.json({
            online: mainBotStatus.online,
            lastSeen: mainBotStatus.lastSeen,
            uptime: mainBotStatus.uptime,
            lastChange: mainBotStatus.lastChange,
            monitorUptime: Date.now() - mainBotStatus.startedAt,
            timestamp: new Date().toISOString(),
            discordStatus: client.isReady() ? 'connected' : 'disconnected'
        });
    });

    // DASHBOARD
    app.get('/dashboard', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Bot Status Dashboard</title>
                <meta http-equiv="refresh" content="10">
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #1e1e1e; color: white; }
                    .online { color: #00ff00; }
                    .offline { color: #ff0000; }
                    .card { background: #2d2d2d; border: 1px solid #444; padding: 20px; margin: 10px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
                    .status-badge { padding: 5px 10px; border-radius: 4px; font-weight: bold; }
                    .online-badge { background: #00ff00; color: black; }
                    .offline-badge { background: #ff0000; color: white; }
                    .health-check { background: #2d2d2d; padding: 10px; border-radius: 5px; margin: 10px 0; }
                </style>
            </head>
            <body>
                <h1>🤖 Dashboard Status Bot</h1>
                
                <div class="health-check">
                    <strong>Health Check:</strong> 
                    <a href="/health" target="_blank">/health</a> | 
                    <a href="/api/status" target="_blank">/api/status</a>
                </div>
                
                <div class="card">
                    <h2>
                        <span class="status-badge ${mainBotStatus.online ? 'online-badge' : 'offline-badge'}">
                            ${mainBotStatus.online ? '🟢 ONLINE' : '🔴 OFFLINE'}
                        </span>
                    </h2>
                    <p><strong>Ultimo check:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>Uptime Bot:</strong> ${formatUptime(mainBotStatus.uptime)}</p>
                    <p><strong>Monitor attivo da:</strong> ${formatUptime(Date.now() - mainBotStatus.startedAt)}</p>
                    <p><strong>Ultimo cambiamento:</strong> ${mainBotStatus.lastChange ? mainBotStatus.lastChange.toLocaleString() : 'Nessuno'}</p>
                    <p><strong>Status Monitor:</strong> <span style="color: #00ff00;">🟢 ATTIVO</span></p>
                </div>
            </body>
            </html>
        `);
    });

    // ROOT REDIRECT TO DASHBOARD
    app.get('/', (req, res) => {
        res.redirect('/dashboard');
    });

    app.listen(config.port, () => {
        console.log(`🌐 Server web avviato sulla porta ${config.port}`);
        console.log(`🏥 Health check disponibile su http://localhost:${config.port}/health`);
        console.log(`📊 Dashboard disponibile su http://localhost:${config.port}/dashboard`);
    });
}

client.login(process.env.DISCORD_TOKEN);
