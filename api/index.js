const { addonBuilder } = require('stremio-addon-sdk');
const RealDebridClient = require('../lib/realdebrid');
const TorrentSearcher = require('../lib/torrentSearcher');
const JackettSearcher = require('../lib/jackettSearcher');

// Простой in-memory кэш (для serverless используем более простой подход)
const cache = new Map();
const CACHE_TTL = 3600000; // 1 час в миллисекундах

function getCache(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    
    return item.data;
}

function setCache(key, data) {
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}

// Манифест аддона
const manifest = {
    id: 'community.realdebrid.russian',
    version: '1.0.0',
    name: 'Real-Debrid Russian Torrents',
    description: 'Стриминг торрентов через Real-Debrid с поиском по русским трекерам',
    
    resources: ['stream'],
    types: ['movie', 'series'],
    
    catalogs: [],
    
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    },
    
    config: [
        {
            key: 'rdApiKey',
            type: 'text',
            title: 'Real-Debrid API ключ',
            required: true
        }
    ],
    
    idPrefixes: ['tt', 'kitsu']
};

const builder = new addonBuilder(manifest);

// Обработчик потоков
builder.defineStreamHandler(async ({ type, id, config }) => {
    try {
        console.log(`Запрос потока: ${type} - ${id}`);
        
      const rdApiKey = 'F5PIY56JKZUQWSPWUEMJZBIJKYRXYRWRNVFI2Z6AKBRCDF7N7AYQ';
        
        const imdbId = id.split(':')[0];
        let season = null;
        let episode = null;
        
        if (type === 'series' && id.includes(':')) {
            const parts = id.split(':');
            season = parseInt(parts[1]);
            episode = parseInt(parts[2]);
        }
        
        // Проверка кэша
        const cacheKey = `streams:${id}:${config.rdApiKey.substring(0, 8)}`;
        const cached = getCache(cacheKey);
        if (cached) {
            console.log('Возврат из кэша');
            return { streams: cached };
        }
        
        const rdClient = new RealDebridClient(config.rdApiKey);
        
        // Инициализация поисковика
        const jackettSearcher = new JackettSearcher(
            process.env.JACKETT_URL,
            process.env.JACKETT_API_KEY
        );
        
        const directSearcher = new TorrentSearcher();
        
        // Получение метаданных
        const metadata = await getMetadata(imdbId, type, season, episode);
        
        // Поиск торрентов
        let torrents = [];
        
        if (jackettSearcher.enabled) {
            console.log('Поиск через Jackett...');
            torrents = await jackettSearcher.search({
                type,
                imdbId,
                title: metadata.title,
                year: metadata.year,
                season,
                episode
            });
        }
        
        if (torrents.length === 0) {
            console.log('Поиск через прямой парсинг...');
            torrents = await directSearcher.search({
                type,
                imdbId,
                title: metadata.title,
                year: metadata.year,
                season,
                episode
            });
        }
        
        console.log(`Найдено торрентов: ${torrents.length}`);
        
        const streams = [];
        
        for (const torrent of torrents.slice(0, 15)) {
            try {
                const rdInfo = await rdClient.checkAvailability(torrent.infoHash);
                
                if (rdInfo && rdInfo.available) {
                    let fileIndex = null;
                    
                    if (type === 'series' && rdInfo.files) {
                        fileIndex = findVideoFile(rdInfo.files, season, episode);
                    }
                    
                    streams.push({
                        name: `RD 🇷🇺 ${torrent.source}`,
                        title: torrent.title,
                        infoHash: torrent.infoHash,
                        fileIdx: fileIndex,
                        behaviorHints: {
                            bingeGroup: `realdebrid-${torrent.infoHash}`,
                            notWebReady: true
                        },
                        sources: torrent.seeders ? [`👥 ${torrent.seeders}`] : [],
                        description: [
                            torrent.size ? `📦 ${torrent.size}` : null,
                            torrent.quality ? `🎬 ${torrent.quality}` : null,
                            torrent.seeders ? `👥 Сиды: ${torrent.seeders}` : null
                        ].filter(Boolean).join(' | ')
                    });
                }
            } catch (err) {
                console.error('Ошибка обработки торрента:', err.message);
            }
        }
        
        if (streams.length > 0) {
            setCache(cacheKey, streams);
        }
        
        console.log(`Возвращено потоков: ${streams.length}`);
        return { streams };
        
    } catch (error) {
        console.error('Ошибка в обработчике потоков:', error);
        return {
            streams: [{
                name: '❌ Ошибка',
                description: error.message,
                notFound: true
            }]
        };
    }
});

async function getMetadata(imdbId, type, season, episode) {
    const axios = require('axios');
    
    try {
        const response = await axios.get(`http://www.omdbapi.com/`, {
            params: {
                i: imdbId,
                apikey: 'trilogy',
                type: type === 'series' ? 'series' : 'movie'
            },
            timeout: 5000
        });
        
        if (response.data && response.data.Response === 'True') {
            return {
                title: response.data.Title,
                year: response.data.Year
            };
        }
    } catch (err) {
        console.error('Ошибка получения метаданных:', err.message);
    }
    
    return { title: '', year: '' };
}

function findVideoFile(files, season, episode) {
    const videoExts = ['.mkv', '.mp4', '.avi'];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.path.toLowerCase();
        
        if (!videoExts.some(ext => name.endsWith(ext))) continue;
        
        const patterns = [
            new RegExp(`s0?${season}e0?${episode}`, 'i'),
            new RegExp(`${season}x0?${episode}`, 'i'),
            new RegExp(`[^\\d]${season}${episode.toString().padStart(2, '0')}[^\\d]`)
        ];
        
        if (patterns.some(pattern => pattern.test(name))) {
            return i + 1;
        }
    }
    
    for (let i = 0; i < files.length; i++) {
        if (videoExts.some(ext => files[i].path.toLowerCase().endsWith(ext))) {
            return i + 1;
        }
    }
    
    return null;
}

// Экспорт для Vercel
const addonInterface = builder.getInterface();

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    const path = req.url || '/';
    
    try {
        // Обработка manifest
        if (path.includes('manifest.json')) {
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(addonInterface.manifest);
            return;
        }
        
        // Обработка stream запросов
        if (path.includes('/stream/')) {
            const match = path.match(/\/stream\/([^\/]+)\/([^\/]+)\.json/);
            
            if (!match) {
                res.status(400).json({ error: 'Invalid stream URL' });
                return;
            }
            
            const type = match[1];
            const id = match[2];
            
            // Извлечение конфигурации из URL или query параметров
            let config = {};
            const urlParts = path.split('/');
            const configIndex = urlParts.findIndex(p => p.length > 30 && !p.includes('.'));
            
            if (configIndex > 0) {
                try {
                    const configStr = decodeURIComponent(urlParts[configIndex]);
                    config = JSON.parse(Buffer.from(configStr, 'base64').toString());
                } catch (e) {
                    // Если не base64, пробуем как прямой API ключ
                    config = { rdApiKey: urlParts[configIndex] };
                }
            }
            
            const result = await addonInterface.stream.handler({ type, id, config });
            
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(result);
            return;
        }
        
        // Главная страница
        res.setHeader('Content-Type', 'text/html');
        res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Real-Debrid Russian Torrents - Stremio Addon</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                        max-width: 800px;
                        margin: 50px auto;
                        padding: 20px;
                        background: #0f0f0f;
                        color: #e0e0e0;
                    }
                    h1 { color: #7b5bf5; }
                    .card {
                        background: #1a1a1a;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                        border: 1px solid #333;
                    }
                    code {
                        background: #2a2a2a;
                        padding: 2px 6px;
                        border-radius: 4px;
                        color: #7b5bf5;
                    }
                    .install-btn {
                        display: inline-block;
                        background: #7b5bf5;
                        color: white;
                        padding: 12px 24px;
                        text-decoration: none;
                        border-radius: 6px;
                        font-weight: bold;
                        margin: 10px 0;
                    }
                    .install-btn:hover {
                        background: #6a4de0;
                    }
                    ul { line-height: 1.8; }
                    .warning {
                        background: #2a1a00;
                        border-left: 4px solid #ff9800;
                        padding: 15px;
                        margin: 20px 0;
                    }
                </style>
            </head>
            <body>
                <h1>🎬 Real-Debrid Russian Torrents</h1>
                <p>Стриминг торрентов через Real-Debrid с поиском по русским трекерам</p>
                
                <div class="card">
                    <h2>✨ Возможности</h2>
                    <ul>
                        <li>🇷🇺 Поиск по русским торрент-трекерам (Rutor, RuTracker, Kinozal)</li>
                        <li>⚡ Быстрый стриминг через Real-Debrid</li>
                        <li>📺 Поддержка фильмов и сериалов</li>
                        <li>🔍 Опциональная интеграция с Jackett</li>
                        <li>💾 Кэширование для быстрого доступа</li>
                    </ul>
                </div>
                
                <div class="warning">
                    <strong>⚠️ Требуется:</strong> Real-Debrid API ключ для работы аддона.<br>
                    Получите его на <a href="https://real-debrid.com/apitoken" target="_blank" style="color: #7b5bf5;">real-debrid.com/apitoken</a>
                </div>
                
                <div class="card">
                    <h2>📥 Установка</h2>
                    <p><strong>Вариант 1:</strong> С API ключом в URL</p>
                    <code>${req.headers.host}/YOUR_RD_API_KEY/manifest.json</code>
                    <br><br>
                    <p><strong>Вариант 2:</strong> Через настройки (рекомендуется)</p>
                    <ol>
                        <li>Скопируйте URL: <code>https://${req.headers.host}/manifest.json</code></li>
                        <li>В Stremio: Addons → Community Addons</li>
                        <li>Вставьте URL и установите</li>
                        <li>В настройках аддона введите ваш Real-Debrid API ключ</li>
                    </ol>
                    
                    <a href="stremio://localhost:11470/settings" class="install-btn">
                        Открыть настройки Stremio
                    </a>
                </div>
                
                <div class="card">
                    <h2>🔧 Опциональная настройка Jackett</h2>
                    <p>Для улучшенного поиска настройте переменные окружения в Vercel:</p>
                    <ul>
                        <li><code>JACKETT_URL</code> - URL вашего Jackett сервера</li>
                        <li><code>JACKETT_API_KEY</code> - API ключ Jackett</li>
                    </ul>
                </div>
                
                <div class="card">
                    <h2>ℹ️ Информация</h2>
                    <p>
                        <strong>Версия:</strong> ${manifest.version}<br>
                        <strong>Статус:</strong> <span style="color: #4caf50;">Онлайн</span><br>
                        <strong>Jackett:</strong> ${process.env.JACKETT_URL ? '✅ Настроен' : '❌ Не настроен'}
                    </p>
                </div>
                
                <p style="text-align: center; color: #666; margin-top: 50px;">
                    Developed with ❤️ for Russian Stremio users
                </p>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
};
