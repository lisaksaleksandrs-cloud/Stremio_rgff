const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

class TorrentSearcher {
    constructor() {
        this.trackers = {
            rutor: {
                enabled: true,
                url: 'http://rutor.info',
                encoding: 'utf-8'
            },
            rutracker: {
                enabled: true,
                url: 'https://rutracker.org',
                encoding: 'windows-1251'
            },
            kinozal: {
                enabled: true,
                url: 'https://kinozal.tv',
                encoding: 'windows-1251'
            }
        };
        
        this.timeout = 10000; // 10 секунд таймаут
    }

    /**
     * Поиск торрентов по всем трекерам
     * @param {Object} params - Параметры поиска
     * @returns {Promise<Array>} Массив найденных торрентов
     */
    async search(params) {
        const { type, title, year, season, episode } = params;
        
        // Формирование поискового запроса
        let searchQuery = title;
        if (year) searchQuery += ` ${year}`;
        if (type === 'series' && season) {
            searchQuery += ` S${season.toString().padStart(2, '0')}`;
            if (episode) {
                searchQuery += `E${episode.toString().padStart(2, '0')}`;
            }
        }
        
        console.log(`Поиск: ${searchQuery}`);
        
        const results = [];
        
        // Параллельный поиск по всем трекерам
        const searches = [];
        
        if (this.trackers.rutor.enabled) {
            searches.push(this.searchRutor(searchQuery));
        }
        
        if (this.trackers.rutracker.enabled) {
            searches.push(this.searchRutracker(searchQuery));
        }
        
        if (this.trackers.kinozal.enabled) {
            searches.push(this.searchKinozal(searchQuery));
        }
        
        const allResults = await Promise.allSettled(searches);
        
        allResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                results.push(...result.value);
            }
        });
        
        // Сортировка по сидам
        return results.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
    }

    /**
     * Поиск на Rutor.info
     */
    async searchRutor(query) {
        try {
            const url = `${this.trackers.rutor.url}/search/0/0/000/0/${encodeURIComponent(query)}`;
            
            const response = await axios.get(url, {
                timeout: this.timeout,
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const html = iconv.decode(response.data, this.trackers.rutor.encoding);
            const $ = cheerio.load(html);
            
            const results = [];
            
            $('#index tr').each((i, row) => {
                if (i === 0) return; // Пропустить заголовок
                
                const $row = $(row);
                const $titleCell = $row.find('td').eq(1);
                const $link = $titleCell.find('a').last();
                
                if (!$link.length) return;
                
                const title = $link.text().trim();
                const href = $link.attr('href');
                
                if (!href || !href.includes('magnet:')) return;
                
                const magnetMatch = href.match(/magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/);
                if (!magnetMatch) return;
                
                const infoHash = magnetMatch[1].toUpperCase();
                
                // Размер
                const sizeText = $row.find('td').eq(3).text().trim();
                
                // Сиды/пиры
                const seeders = parseInt($row.find('.green').text()) || 0;
                
                // Качество из названия
                const quality = this.extractQuality(title);
                
                results.push({
                    title,
                    infoHash,
                    size: sizeText,
                    seeders,
                    quality,
                    source: 'Rutor',
                    magnet: href
                });
            });
            
            console.log(`Rutor: найдено ${results.length} результатов`);
            return results;
            
        } catch (error) {
            console.error('Ошибка поиска на Rutor:', error.message);
            return [];
        }
    }

    /**
     * Поиск на RuTracker.org
     */
    async searchRutracker(query) {
        try {
            // RuTracker требует авторизации, поэтому используем публичный API или парсинг без авторизации
            // Для полноценной работы нужны куки авторизации
            
            const url = `${this.trackers.rutracker.url}/forum/tracker.php?nm=${encodeURIComponent(query)}`;
            
            const response = await axios.get(url, {
                timeout: this.timeout,
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const html = iconv.decode(response.data, this.trackers.rutracker.encoding);
            const $ = cheerio.load(html);
            
            const results = [];
            
            // Парсинг результатов (требует доработки под актуальную структуру)
            $('tr.tCenter').each((i, row) => {
                const $row = $(row);
                const $titleCell = $row.find('.t-title a');
                
                if (!$titleCell.length) return;
                
                const title = $titleCell.text().trim();
                const topicId = $titleCell.attr('href')?.match(/t=(\d+)/)?.[1];
                
                if (!topicId) return;
                
                // Для получения магнет-ссылки нужна авторизация
                // Здесь упрощенная версия
                
                const sizeText = $row.find('td').eq(5).text().trim();
                const seeders = parseInt($row.find('.seedmed').text()) || 0;
                const quality = this.extractQuality(title);
                
                // Заглушка для info hash (требуется авторизация для получения)
                const infoHash = this.generateDummyHash(topicId);
                
                results.push({
                    title,
                    infoHash,
                    size: sizeText,
                    seeders,
                    quality,
                    source: 'RuTracker',
                    topicId
                });
            });
            
            console.log(`RuTracker: найдено ${results.length} результатов`);
            return results;
            
        } catch (error) {
            console.error('Ошибка поиска на RuTracker:', error.message);
            return [];
        }
    }

    /**
     * Поиск на Kinozal.tv
     */
    async searchKinozal(query) {
        try {
            const url = `${this.trackers.kinozal.url}/browse.php?s=${encodeURIComponent(query)}`;
            
            const response = await axios.get(url, {
                timeout: this.timeout,
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const html = iconv.decode(response.data, this.trackers.kinozal.encoding);
            const $ = cheerio.load(html);
            
            const results = [];
            
            $('.t_peer').each((i, row) => {
                const $row = $(row);
                const $title = $row.find('.t_title a');
                
                if (!$title.length) return;
                
                const title = $title.text().trim();
                const topicId = $title.attr('href')?.match(/id=(\d+)/)?.[1];
                
                if (!topicId) return;
                
                const sizeText = $row.find('.s').text().trim();
                const seeders = parseInt($row.find('.sl_s').text()) || 0;
                const quality = this.extractQuality(title);
                
                // Для Kinozal также требуется авторизация для магнет-ссылок
                const infoHash = this.generateDummyHash(topicId);
                
                results.push({
                    title,
                    infoHash,
                    size: sizeText,
                    seeders,
                    quality,
                    source: 'Kinozal',
                    topicId
                });
            });
            
            console.log(`Kinozal: найдено ${results.length} результатов`);
            return results;
            
        } catch (error) {
            console.error('Ошибка поиска на Kinozal:', error.message);
            return [];
        }
    }

    /**
     * Извлечение качества из названия
     */
    extractQuality(title) {
        const titleLower = title.toLowerCase();
        
        if (titleLower.includes('2160p') || titleLower.includes('4k')) return '4K';
        if (titleLower.includes('1080p')) return '1080p';
        if (titleLower.includes('720p')) return '720p';
        if (titleLower.includes('480p')) return '480p';
        
        if (titleLower.includes('bdrip') || titleLower.includes('bluray')) return 'BluRay';
        if (titleLower.includes('webrip') || titleLower.includes('web-dl')) return 'WEB-DL';
        if (titleLower.includes('hdtv')) return 'HDTV';
        
        return 'Unknown';
    }

    /**
     * Генерация dummy hash для трекеров без авторизации
     * В продакшене нужно заменить на реальные магнет-ссылки
     */
    generateDummyHash(id) {
        // Простое хеширование ID в 40-символьный hex
        const hash = require('crypto')
            .createHash('sha1')
            .update(`tracker_${id}`)
            .digest('hex')
            .toUpperCase();
        return hash;
    }
}

module.exports = TorrentSearcher;
