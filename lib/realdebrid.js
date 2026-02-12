const axios = require('axios');

class RealDebridClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.real-debrid.com/rest/1.0';
        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
    }

    /**
     * Проверка доступности торрента в кэше Real-Debrid
     * @param {string} infoHash - Info hash торрента
     * @returns {Promise<Object>} Информация о доступности
     */
    async checkAvailability(infoHash) {
        try {
            const response = await this.client.get('/torrents/instantAvailability/' + infoHash);
            
            if (response.data && response.data[infoHash]) {
                const variants = response.data[infoHash];
                
                // Берем первый доступный вариант
                if (variants.rd && variants.rd.length > 0) {
                    const files = variants.rd[0];
                    
                    return {
                        available: true,
                        files: Object.values(files).map(file => ({
                            id: file.filename,
                            path: file.filename,
                            size: file.filesize
                        }))
                    };
                }
            }
            
            return { available: false };
        } catch (error) {
            console.error('Ошибка проверки доступности:', error.message);
            return { available: false };
        }
    }

    /**
     * Добавление магнет-ссылки в Real-Debrid
     * @param {string} magnet - Магнет-ссылка
     * @returns {Promise<Object>} Информация о добавленном торренте
     */
    async addMagnet(magnet) {
        try {
            const response = await this.client.post('/torrents/addMagnet', 
                `magnet=${encodeURIComponent(magnet)}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            
            return response.data;
        } catch (error) {
            console.error('Ошибка добавления магнета:', error.message);
            throw error;
        }
    }

    /**
     * Выбор файлов из торрента
     * @param {string} torrentId - ID торрента
     * @param {string} fileIds - ID файлов через запятую или 'all'
     * @returns {Promise<void>}
     */
    async selectFiles(torrentId, fileIds = 'all') {
        try {
            await this.client.post(`/torrents/selectFiles/${torrentId}`,
                `files=${fileIds}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
        } catch (error) {
            console.error('Ошибка выбора файлов:', error.message);
            throw error;
        }
    }

    /**
     * Получение информации о торренте
     * @param {string} torrentId - ID торрента
     * @returns {Promise<Object>} Информация о торренте
     */
    async getTorrentInfo(torrentId) {
        try {
            const response = await this.client.get(`/torrents/info/${torrentId}`);
            return response.data;
        } catch (error) {
            console.error('Ошибка получения информации о торренте:', error.message);
            throw error;
        }
    }

    /**
     * Разблокировка ссылки для стриминга
     * @param {string} link - Ссылка на файл
     * @returns {Promise<string>} Прямая ссылка для стриминга
     */
    async unrestrictLink(link) {
        try {
            const response = await this.client.post('/unrestrict/link',
                `link=${encodeURIComponent(link)}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            
            return response.data.download;
        } catch (error) {
            console.error('Ошибка разблокировки ссылки:', error.message);
            throw error;
        }
    }

    /**
     * Получение списка активных торрентов
     * @returns {Promise<Array>} Список торрентов
     */
    async getActiveTorrents() {
        try {
            const response = await this.client.get('/torrents');
            return response.data;
        } catch (error) {
            console.error('Ошибка получения списка торрентов:', error.message);
            return [];
        }
    }

    /**
     * Удаление торрента
     * @param {string} torrentId - ID торрента
     * @returns {Promise<void>}
     */
    async deleteTorrent(torrentId) {
        try {
            await this.client.delete(`/torrents/delete/${torrentId}`);
        } catch (error) {
            console.error('Ошибка удаления торрента:', error.message);
        }
    }

    /**
     * Получение информации об аккаунте
     * @returns {Promise<Object>} Информация об аккаунте
     */
    async getUserInfo() {
        try {
            const response = await this.client.get('/user');
            return response.data;
        } catch (error) {
            console.error('Ошибка получения информации об аккаунте:', error.message);
            throw error;
        }
    }
}

module.exports = RealDebridClient;
