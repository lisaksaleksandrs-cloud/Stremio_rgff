const axios = require('axios');

class JackettSearcher {
    constructor(jackettUrl = null, apiKey = null) {
        // URL Jackett сервера (например: http://localhost:9117)
        this.jackettUrl = jackettUrl || process.env.JACKETT_URL || null;
        this.apiKey = apiKey || process.env.JACKETT_API_KEY || null;
        
        if (this.jackettUrl && this.apiKey) {
            this.enabled = true;
            console.log('✓ Jackett интеграция включена');
        } else {
            this.enabled = false;
            console.log('✗ Jackett не настроен (опционально)');
        }
    }

    /**
     * Поиск через Jackett API
     * @param {Object} params - Параметры поиска
     * @returns {Promise<Array>} Массив найденных торрентов
     */
    async search(params) {
        if (!this.enabled) {
            return [];
        }

        const { title, year, season, episode, imdbId } = params;
        
        // Формирование поискового запроса
        let searchQuery = title;
        if (year) searchQuery += ` ${year}`;
        if (season) {
            searchQuery += ` S${season.toString().padStart(2, '0')}`;
            if (episode) {
                searchQuery += `E${episode.toString().padStart(2, '0')}`;
            }
        }

        try {
            const url = `${this.jackettUrl}/api/v2.0/indexers/all/results`;
            
            const queryParams = {
                apikey: this.apiKey,
                Query: searchQuery
            };

            // Добавляем IMDb ID если есть
            if (imdbId) {
                queryParams.imdbid = imdbId.replace('tt', '');
            }

            console.log(`Поиск через Jackett: ${searchQuery}`);

            const response = await axios.get(url, {
                params: queryParams,
                timeout: 15000,
                headers: {
                    'User-Agent': 'Stremio-RD-Addon/1.0'
                }
            });

            if (!response.data || !response.data.Results) {
                return [];
            }

            const results = response.data.Results
                .filter(item => item.MagnetUri || item.Link) // Только с магнет-ссылкой
                .map(item => {
                    // Извлечение info hash из магнет-ссылки
                    let infoHash = null;
                    if (item.MagnetUri) {
                        const match = item.MagnetUri.match(/btih:([a-fA-F0-9]{40})/i);
                        if (match) {
                            infoHash = match[1].toUpperCase();
                        }
                    }

                    if (!infoHash) return null;

                    return {
                        title: item.Title,
                        infoHash: infoHash,
                        size: this.formatSize(item.Size),
                        seeders: item.Seeders || 0,
                        peers: item.Peers || 0,
                        quality: this.extractQuality(item.Title),
                        source: item.Tracker || 'Jackett',
                        magnet: item.MagnetUri,
                        publishDate: item.PublishDate
                    };
                })
                .filter(item => item !== null); // Удалить null записи

            console.log(`Jackett: найдено ${results.length} результатов`);
            
            // Фильтрация русских трекеров (опционально)
            const russianTrackers = ['rutracker', 'rutor', 'kinozal', 'nnmclub', 'torrentby'];
            const russianResults = results.filter(item => 
                russianTrackers.some(tracker => 
                    item.source.toLowerCase().includes(tracker)
                )
            );

            console.log(`Jackett (русские): ${russianResults.length} результатов`);

            return results; // Возвращаем все результаты или только russianResults

        } catch (error) {
            console.error('Ошибка поиска через Jackett:', error.message);
            return [];
        }
    }

    /**
     * Получение списка доступных индексеров
     */
    async getIndexers() {
        if (!this.enabled) {
            return [];
        }

        try {
            const url = `${this.jackettUrl}/api/v2.0/indexers`;
            const response = await axios.get(url, {
                params: {
                    apikey: this.apiKey
                },
                timeout: 5000
            });

            return response.data || [];
        } catch (error) {
            console.error('Ошибка получения списка индексеров:', error.message);
            return [];
        }
    }

    /**
     * Тест подключения к Jackett
     */
    async testConnection() {
        if (!this.enabled) {
            return false;
        }

        try {
            const indexers = await this.getIndexers();
            console.log(`✓ Jackett подключен. Доступно индексеров: ${indexers.length}`);
            return true;
        } catch (error) {
            console.error('✗ Ошибка подключения к Jackett:', error.message);
            return false;
        }
    }

    /**
     * Форматирование размера файла
     */
    formatSize(bytes) {
        if (!bytes) return 'Unknown';
        
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = (bytes / Math.pow(1024, i)).toFixed(2);
        
        return `${size} ${sizes[i]}`;
    }

    /**
     * Извлечение качества из названия
     */
    extractQuality(title) {
        const titleLower = title.toLowerCase();
        
        if (titleLower.includes('2160p') || titleLower.includes('4k') || titleLower.includes('uhd')) return '4K';
        if (titleLower.includes('1080p')) return '1080p';
        if (titleLower.includes('720p')) return '720p';
        if (titleLower.includes('480p')) return '480p';
        
        if (titleLower.includes('remux')) return 'REMUX';
        if (titleLower.includes('bdrip') || titleLower.includes('bluray')) return 'BluRay';
        if (titleLower.includes('webrip') || titleLower.includes('web-dl')) return 'WEB-DL';
        if (titleLower.includes('hdtv')) return 'HDTV';
        if (titleLower.includes('cam') || titleLower.includes('ts')) return 'CAM/TS';
        
        return 'Unknown';
    }
}

module.exports = JackettSearcher;
