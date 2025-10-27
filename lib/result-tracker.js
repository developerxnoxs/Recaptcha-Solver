const createLogger = require('../utils/logger');
const logger = createLogger({ level: 'info' });

class ResultTracker {
    constructor() {
        this.results = [];
        this.startTime = Date.now();
        this.maxResults = 500;
        this.firstProcessingTime = null;
    }

    addResult(result) {
        if (!this.firstProcessingTime) {
            this.firstProcessingTime = Date.now();
        }

        this.results.push({
            success: result.token ? true : false,
            timestamp: Date.now()
        });

        if (this.results.length > this.maxResults) {
            this.results.shift();
        }

        this.printStats();
    }

    getStats() {
        if (this.results.length === 0) return null;

        const successCount = this.results.filter(r => r.success).length;
        const successRate = (successCount / this.results.length) * 100;

        let avgTimePerToken = 0;
        if (successCount > 0) {
            const totalElapsedSeconds = (Date.now() - this.startTime) / 1000;
            avgTimePerToken = totalElapsedSeconds / successCount;
        }

        return {
            successRate: successRate.toFixed(2),
            avgTimePerToken: avgTimePerToken.toFixed(2),
            totalAttempts: this.results.length,
            successfulTokens: successCount
        };
    }

    printStats() {
        const stats = this.getStats();
        if (!stats) return;
        logger.info(`📊 Stats: Success Rate: ${stats.successRate}% | Avg Time/Token: ${stats.avgTimePerToken}s | Total Attempts: ${stats.totalAttempts} | Successful Tokens: ${stats.successfulTokens}`);
    }
}

module.exports = ResultTracker;
