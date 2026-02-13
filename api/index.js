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
        
        if (!config || !config.rdApiKey) {
            return {
                streams: [{
                    name: '⚠️ Требуется API ключ Real-Debrid',
                    description: 'Настройте аддон и добавьте API ключ',
                    notFound: true
                }]
            };
        }
        
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
    console.log('Request path:', path);
    
    try {
        // Извлечение конфигурации из URL
        // Поддерживаем форматы:
        // /YOUR_API_KEY/manifest.json
        // /YOUR_API_KEY/stream/movie/tt123.json
        // /eyJyZEFwaUtleSI6Li4ufQ==/manifest.json (base64 config)
        let userConfig = {};
        const urlParts = path.split('/').filter(p => p);
        
        // Проверяем первую часть URL - это может быть конфигурация
        if (urlParts.length > 0 && urlParts[0] !== 'manifest.json' && !urlParts[0].startsWith('stream')) {
            const possibleConfig = urlParts[0];
            
            // Попытка декодировать как base64 конфиг
            try {
                const decoded = Buffer.from(possibleConfig, 'base64').toString();
                userConfig = JSON.parse(decoded);
                console.log('Decoded base64 config');
            } catch (e) {
                // Не base64 - это прямой API ключ
                if (possibleConfig.length > 20) { // API ключи обычно длинные
                    userConfig = { rdApiKey: possibleConfig };
                    console.log('Direct API key detected');
                }
            }
        }
        
        // Обработка manifest
        if (path.includes('manifest.json')) {
            res.setHeader('Content-Type', 'application/json');
            
            // Если есть конфигурация в URL, используем её для создания configured manifest
            if (userConfig.rdApiKey) {
                const configuredManifest = {
                    ...addonInterface.manifest,
                    behaviorHints: {
                        ...addonInterface.manifest.behaviorHints,
                        configurable: false,
                        configurationRequired: false
                    }
                };
                res.status(200).json(configuredManifest);
            } else {
                res.status(200).json(addonInterface.manifest);
            }
            return;
        }
        
        // Обработка stream запросов
        if (path.includes('/stream/')) {
            // Паттерны:
            // /stream/movie/tt123.json
            // /YOUR_API_KEY/stream/movie/tt123.json
            // /eyJyZEFwaUtleSI6Li4ufQ==/stream/movie/tt123.json
            
            const streamMatch = path.match(/\/stream\/([^\/]+)\/([^\/]+)\.json/);
            
            if (!streamMatch) {
                res.status(400).json({ error: 'Invalid stream URL' });
                return;
            }
            
            const type = streamMatch[1];
            const id = streamMatch[2];
            
            console.log(`Stream request: ${type} - ${id}`);
            console.log('Config:', userConfig);
            
            const result = await addonInterface.stream.handler({ 
                type, 
                id, 
                config: userConfig 
            });
            
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
                        max-width: 900px;
                        margin: 50px auto;
                        padding: 20px;
                        background: #0f0f0f;
                        color: #e0e0e0;
                        line-height: 1.6;
                    }
                    h1 { color: #7b5bf5; }
                    h2 { color: #9575cd; margin-top: 30px; }
                    .card {
                        background: #1a1a1a;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                        border: 1px solid #333;
                    }
                    code {
                        background: #2a2a2a;
                        padding: 4px 8px;
                        border-radius: 4px;
                        color: #7b5bf5;
                        font-size: 0.9em;
                        word-break: break-all;
                    }
                    .url-box {
                        background: #2a2a2a;
                        padding: 15px;
                        border-radius: 6px;
                        margin: 15px 0;
                        border-left: 4px solid #7b5bf5;
                        font-family: monospace;
                        word-break: break-all;
                    }
                    .install-btn {
                        display: inline-block;
                        background: #7b5bf5;
                        color: white;
                        padding: 12px 24px;
                        text-decoration: none;
                        border-radius: 6px;
                        font-weight: bold;
                        margin: 10px 5px;
                    }
                    .install-btn:hover {
                        background: #6a4de0;
                    }
                    .copy-btn {
                        background: #4caf50;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-left: 10px;
                        font-size: 0.9em;
                    }
                    .copy-btn:hover {
                        background: #45a049;
                    }
                    ul { line-height: 1.8; }
                    ol { line-height: 1.8; }
                    .warning {
                        background: #2a1a00;
                        border-left: 4px solid #ff9800;
                        padding: 15px;
                        margin: 20px 0;
                    }
                    .success {
                        background: #1a2a1a;
                        border-left: 4px solid #4caf50;
                        padding: 15px;
                        margin: 20px 0;
                    }
                    .method {
                        background: #1e1e2e;
                        padding: 15px;
                        margin: 15px 0;
                        border-radius: 6px;
                        border: 1px solid #333;
                    }
                    .method-title {
                        font-weight: bold;
                        color: #7b5bf5;
                        font-size: 1.1em;
                        margin-bottom: 10px;
                    }
                    input[type="text"] {
                        width: 100%;
                        padding: 12px;
                        background: #2a2a2a;
                        border: 1px solid #444;
                        border-radius: 4px;
                        color: #e0e0e0;
                        font-family: monospace;
                        margin: 10px 0;
                        box-sizing: border-box;
                    }
                </style>
            </head>
            <body>
                <h1>🎬 Real-Debrid Russian Torrents</h1>
                <p>Стриминг торрентов через Real-Debrid с поиском по русским трекерам</p>
                
                <div class="success">
                    <strong>✅ Аддон запущен и работает!</strong><br>
                    Выберите способ установки ниже.
                </div>
                
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
                    <strong>⚠️ Требуется Real-Debrid подписка</strong><br>
                    Получите API ключ на <a href="https://real-debrid.com/apitoken" target="_blank" style="color: #7b5bf5;">real-debrid.com/apitoken</a>
                </div>
                
                <div class="card">
                    <h2>📥 Установка в Stremio</h2>
                    
                    <div class="method">
                        <div class="method-title">🚀 Способ 1: Быстрая установка (с API ключом в URL)</div>
                        <p>Вставьте ваш Real-Debrid API ключ:</p>
                        <input type="text" id="apiKeyInput" placeholder="Вставьте ваш Real-Debrid API ключ здесь">
                        <div id="generatedUrl" style="display:none; margin-top: 15px;">
                            <p><strong>Ваш персональный URL аддона:</strong></p>
                            <div class="url-box" id="finalUrl"></div>
                            <button class="copy-btn" onclick="copyUrl()">📋 Скопировать</button>
                            <a id="installLink" class="install-btn" href="#">Установить в Stremio</a>
                        </div>
                    </div>
                    
                    <div class="method">
                        <div class="method-title">⚙️ Способ 2: Через настройки (если Способ 1 не работает)</div>
                        <ol>
                            <li>Скопируйте этот URL:
                                <div class="url-box">https://${req.headers.host}/manifest.json</div>
                                <button class="copy-btn" onclick="copyToClipboard('https://${req.headers.host}/manifest.json')">📋 Скопировать</button>
                            </li>
                            <li>В Stremio: <strong>Addons</strong> → <strong>Community Addons</strong></li>
                            <li>Вставьте скопированный URL</li>
                            <li>Нажмите "Install"</li>
                            <li>После установки откройте настройки аддона</li>
                            <li>Введите ваш Real-Debrid API ключ в поле "Real-Debrid API ключ"</li>
                        </ol>
                    </div>
                </div>
                
                <div class="card">
                    <h2>🔧 Опциональная настройка Jackett</h2>
                    <p>Для улучшенного поиска настройте переменные окружения в Vercel:</p>
                    <ul>
                        <li><code>JACKETT_URL</code> - URL вашего Jackett сервера</li>
                        <li><code>JACKETT_API_KEY</code> - API ключ Jackett</li>
                    </ul>
                    <p><strong>Текущий статус:</strong> ${process.env.JACKETT_URL ? '✅ Jackett настроен' : '❌ Jackett не настроен (работает с прямым парсингом)'}</p>
                </div>
                
                <div class="card">
                    <h2>ℹ️ Информация</h2>
                    <p>
                        <strong>Версия:</strong> ${manifest.version}<br>
                        <strong>Статус:</strong> <span style="color: #4caf50;">● Онлайн</span><br>
                        <strong>Jackett:</strong> ${process.env.JACKETT_URL ? '✅ Настроен' : '❌ Не настроен (опционально)'}
                    </p>
                </div>
                
                <p style="text-align: center; color: #666; margin-top: 50px;">
                    Made with ❤️ for Russian Stremio users
                </p>
                
                <script>
                    const apiKeyInput = document.getElementById('apiKeyInput');
                    const generatedUrl = document.getElementById('generatedUrl');
                    const finalUrl = document.getElementById('finalUrl');
                    const installLink = document.getElementById('installLink');
                    
                    apiKeyInput.addEventListener('input', function() {
                        const apiKey = this.value.trim();
                        if (apiKey.length > 10) {
                            const url = 'https://${req.headers.host}/' + apiKey + '/manifest.json';
                            finalUrl.textContent = url;
                            installLink.href = url;
                            generatedUrl.style.display = 'block';
                        } else {
                            generatedUrl.style.display = 'none';
                        }
                    });
                    
                    function copyUrl() {
                        const url = finalUrl.textContent;
                        copyToClipboard(url);
                    }
                    
                    function copyToClipboard(text) {
                        if (navigator.clipboard) {
                            navigator.clipboard.writeText(text).then(() => {
                                alert('✅ URL скопирован в буфер обмена!');
                            });
                        } else {
                            // Fallback для старых браузеров
                            const textArea = document.createElement('textarea');
                            textArea.value = text;
                            textArea.style.position = 'fixed';
                            textArea.style.left = '-999999px';
                            document.body.appendChild(textArea);
                            textArea.select();
                            try {
                                document.execCommand('copy');
                                alert('✅ URL скопирован в буфер обмена!');
                            } catch (err) {
                                alert('❌ Не удалось скопировать. Скопируйте вручную.');
                            }
                            document.body.removeChild(textArea);
                        }
                    }
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
};
