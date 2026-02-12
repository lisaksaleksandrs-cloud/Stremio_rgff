/**
 * Утилиты для работы с торрентами
 */

const crypto = require('crypto');

class TorrentUtils {
    /**
     * Извлечение info hash из магнет-ссылки
     * @param {string} magnet - Магнет-ссылка
     * @returns {string|null} Info hash в верхнем регистре
     */
    static extractInfoHash(magnet) {
        if (!magnet) return null;
        
        const match = magnet.match(/btih:([a-fA-F0-9]{40})/i);
        return match ? match[1].toUpperCase() : null;
    }

    /**
     * Создание магнет-ссылки из info hash
     * @param {string} infoHash - Info hash
     * @param {string} name - Название торрента (опционально)
     * @param {Array<string>} trackers - Список трекеров (опционально)
     * @returns {string} Магнет-ссылка
     */
    static createMagnetLink(infoHash, name = null, trackers = []) {
        let magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
        
        if (name) {
            magnet += `&dn=${encodeURIComponent(name)}`;
        }
        
        // Добавление популярных трекеров
        const defaultTrackers = [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://tracker.openbittorrent.com:80/announce',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.torrent.eu.org:451/announce',
            'udp://tracker.moeking.me:6969/announce'
        ];
        
        const allTrackers = [...defaultTrackers, ...trackers];
        allTrackers.forEach(tracker => {
            magnet += `&tr=${encodeURIComponent(tracker)}`;
        });
        
        return magnet;
    }

    /**
     * Нормализация размера файла
     * @param {string|number} size - Размер в различных форматах
     * @returns {string} Нормализованный размер
     */
    static normalizeSize(size) {
        if (typeof size === 'number') {
            return this.formatBytes(size);
        }
        
        if (typeof size === 'string') {
            // Если уже в правильном формате, вернуть как есть
            if (/^\d+\.?\d*\s*(B|KB|MB|GB|TB)$/i.test(size.trim())) {
                return size.trim();
            }
            
            // Попытка преобразовать
            const bytes = this.parseSize(size);
            if (bytes !== null) {
                return this.formatBytes(bytes);
            }
        }
        
        return 'Unknown';
    }

    /**
     * Преобразование строки размера в байты
     * @param {string} sizeStr - Строка с размером
     * @returns {number|null} Размер в байтах
     */
    static parseSize(sizeStr) {
        if (!sizeStr) return null;
        
        const match = sizeStr.match(/(\d+\.?\d*)\s*(B|KB|MB|GB|TB)/i);
        if (!match) return null;
        
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        
        const multipliers = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024,
            'TB': 1024 * 1024 * 1024 * 1024
        };
        
        return Math.floor(value * multipliers[unit]);
    }

    /**
     * Форматирование байтов в читаемый формат
     * @param {number} bytes - Размер в байтах
     * @returns {string} Отформатированная строка
     */
    static formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        if (!bytes) return 'Unknown';
        
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = (bytes / Math.pow(1024, i)).toFixed(2);
        
        return `${size} ${sizes[i]}`;
    }

    /**
     * Определение качества из названия торрента
     * @param {string} title - Название торрента
     * @returns {Object} Объект с информацией о качестве
     */
    static parseQuality(title) {
        const titleLower = title.toLowerCase();
        
        const quality = {
            resolution: null,
            source: null,
            codec: null,
            audio: null,
            hdr: false
        };

        // Разрешение
        if (titleLower.includes('2160p') || titleLower.includes('4k') || titleLower.includes('uhd')) {
            quality.resolution = '4K';
        } else if (titleLower.includes('1080p')) {
            quality.resolution = '1080p';
        } else if (titleLower.includes('720p')) {
            quality.resolution = '720p';
        } else if (titleLower.includes('480p')) {
            quality.resolution = '480p';
        }

        // Источник
        if (titleLower.includes('remux')) {
            quality.source = 'REMUX';
        } else if (titleLower.includes('bluray') || titleLower.includes('bdrip') || titleLower.includes('brrip')) {
            quality.source = 'BluRay';
        } else if (titleLower.includes('web-dl') || titleLower.includes('webdl')) {
            quality.source = 'WEB-DL';
        } else if (titleLower.includes('webrip')) {
            quality.source = 'WEBRip';
        } else if (titleLower.includes('hdtv')) {
            quality.source = 'HDTV';
        } else if (titleLower.includes('dvdrip')) {
            quality.source = 'DVDRip';
        } else if (titleLower.includes('cam') || titleLower.includes('camrip')) {
            quality.source = 'CAM';
        } else if (titleLower.includes('ts') || titleLower.includes('telesync')) {
            quality.source = 'TS';
        }

        // Кодек
        if (titleLower.includes('hevc') || titleLower.includes('h265') || titleLower.includes('x265')) {
            quality.codec = 'HEVC';
        } else if (titleLower.includes('h264') || titleLower.includes('x264') || titleLower.includes('avc')) {
            quality.codec = 'H.264';
        } else if (titleLower.includes('av1')) {
            quality.codec = 'AV1';
        }

        // Аудио
        if (titleLower.includes('atmos')) {
            quality.audio = 'Dolby Atmos';
        } else if (titleLower.includes('truehd')) {
            quality.audio = 'TrueHD';
        } else if (titleLower.includes('dts-hd') || titleLower.includes('dts-ma')) {
            quality.audio = 'DTS-HD';
        } else if (titleLower.includes('dts')) {
            quality.audio = 'DTS';
        } else if (titleLower.includes('dd5.1') || titleLower.includes('ac3')) {
            quality.audio = 'DD 5.1';
        } else if (titleLower.includes('aac')) {
            quality.audio = 'AAC';
        }

        // HDR
        if (titleLower.includes('hdr') || titleLower.includes('hdr10') || titleLower.includes('dolby vision') || titleLower.includes('dv')) {
            quality.hdr = true;
        }

        return quality;
    }

    /**
     * Создание краткого описания качества
     * @param {string} title - Название торрента
     * @returns {string} Краткое описание
     */
    static getQualityString(title) {
        const q = this.parseQuality(title);
        const parts = [];

        if (q.resolution) parts.push(q.resolution);
        if (q.source) parts.push(q.source);
        if (q.codec) parts.push(q.codec);
        if (q.hdr) parts.push('HDR');

        return parts.join(' | ') || 'Unknown';
    }

    /**
     * Поиск эпизода в списке файлов
     * @param {Array} files - Список файлов
     * @param {number} season - Номер сезона
     * @param {number} episode - Номер эпизода
     * @returns {number|null} Индекс файла (1-based) или null
     */
    static findEpisodeFile(files, season, episode) {
        const videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv'];
        
        // Паттерны для поиска
        const patterns = [
            new RegExp(`s0*${season}e0*${episode}(?!\\d)`, 'i'),           // S01E01, s1e1
            new RegExp(`\\b${season}x0*${episode}(?!\\d)`, 'i'),           // 1x01
            new RegExp(`season\\s*0*${season}.*episode\\s*0*${episode}`, 'i'), // Season 1 Episode 1
            new RegExp(`сезон\\s*0*${season}.*серия\\s*0*${episode}`, 'i')     // Сезон 1 Серия 1
        ];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const name = (file.path || file.name || '').toLowerCase();
            
            // Проверка расширения
            const isVideo = videoExts.some(ext => name.endsWith(ext));
            if (!isVideo) continue;
            
            // Проверка паттернов
            const matches = patterns.some(pattern => pattern.test(name));
            if (matches) {
                return i + 1; // Real-Debrid использует 1-based индекс
            }
        }
        
        // Если не нашли, вернуть первый видео файл
        for (let i = 0; i < files.length; i++) {
            const name = (files[i].path || files[i].name || '').toLowerCase();
            if (videoExts.some(ext => name.endsWith(ext))) {
                return i + 1;
            }
        }
        
        return null;
    }

    /**
     * Проверка, является ли релиз качественным
     * @param {string} title - Название релиза
     * @returns {boolean} True если качественный
     */
    static isGoodQuality(title) {
        const titleLower = title.toLowerCase();
        
        // Хорошие признаки
        const goodKeywords = ['1080p', '720p', '4k', '2160p', 'bluray', 'web-dl', 'webrip', 'remux'];
        const hasGood = goodKeywords.some(keyword => titleLower.includes(keyword));
        
        // Плохие признаки
        const badKeywords = ['cam', 'ts', 'telesync', 'hdcam', 'sample', 'trailer'];
        const hasBad = badKeywords.some(keyword => titleLower.includes(keyword));
        
        return hasGood && !hasBad;
    }

    /**
     * Фильтрация дубликатов по info hash
     * @param {Array} torrents - Массив торрентов
     * @returns {Array} Уникальные торренты
     */
    static removeDuplicates(torrents) {
        const seen = new Set();
        return torrents.filter(torrent => {
            if (!torrent.infoHash) return true;
            
            const hash = torrent.infoHash.toUpperCase();
            if (seen.has(hash)) {
                return false;
            }
            
            seen.add(hash);
            return true;
        });
    }

    /**
     * Сортировка торрентов по приоритету
     * @param {Array} torrents - Массив торрентов
     * @returns {Array} Отсортированные торренты
     */
    static sortByPriority(torrents) {
        const qualityPriority = {
            '4K': 100,
            'REMUX': 95,
            '2160p': 90,
            '1080p': 80,
            'BluRay': 70,
            '720p': 60,
            'WEB-DL': 65,
            'WEBRip': 60,
            'HDTV': 50,
            '480p': 40
        };

        return torrents.sort((a, b) => {
            // Сначала по количеству сидов
            const seedDiff = (b.seeders || 0) - (a.seeders || 0);
            if (Math.abs(seedDiff) > 10) return seedDiff;
            
            // Затем по качеству
            const aPriority = qualityPriority[a.quality] || 0;
            const bPriority = qualityPriority[b.quality] || 0;
            
            return bPriority - aPriority;
        });
    }
}

module.exports = TorrentUtils;
