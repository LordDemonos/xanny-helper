"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileProcessor = void 0;
const logger_1 = require("./logger");
class FileProcessor {
    constructor(octokit, owner, repo, branch) {
        this.octokit = octokit;
        this.owner = owner;
        this.repo = repo;
        this.branch = branch;
        this.queue = [];
        this.processing = false;
        this.batchSize = 5; // Number of files to process in parallel
        this.retryDelay = 1000; // Base delay for retries
        this.maxRetries = 3;
    }
    /**
     * Adds a file operation to the queue
     */
    async addToQueue(operation) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    await this.processFile(operation);
                    resolve();
                }
                catch (error) {
                    reject(error);
                }
            });
            if (!this.processing) {
                this.processQueue().catch(error => {
                    logger_1.logger.error(`Queue processing error: ${error instanceof Error ? error.message : error}`);
                });
            }
        });
    }
    /**
     * Processes the queue of file operations
     */
    async processQueue() {
        this.processing = true;
        while (this.queue.length > 0) {
            const batch = this.queue.splice(0, this.batchSize);
            await Promise.all(batch.map(operation => operation()));
        }
        this.processing = false;
    }
    /**
     * Processes a single file with retry logic
     */
    async processFile(operation) {
        let retries = 0;
        while (retries < this.maxRetries) {
            try {
                // Get current file content and SHA
                let currentContent = '';
                let currentSha = '';
                try {
                    const { data } = await this.octokit.repos.getContent({
                        owner: this.owner,
                        repo: this.repo,
                        path: operation.path,
                        ref: this.branch
                    });
                    if (Array.isArray(data)) {
                        throw new Error('Path is a directory');
                    }
                    if (data.type === 'file' && data.encoding === 'base64') {
                        currentContent = Buffer.from(data.content, 'base64').toString();
                        currentSha = data.sha;
                    }
                }
                catch (error) {
                    if (error.status !== 404) {
                        throw error;
                    }
                }
                // Combine content if append is true
                const newContent = operation.append
                    ? currentContent + '\n' + operation.content
                    : operation.content;
                // Skip update if content hasn't changed
                if (currentContent === newContent) {
                    logger_1.logger.info(`Skipping update for ${operation.path} - content unchanged`);
                    return;
                }
                // Create or update file
                await this.octokit.repos.createOrUpdateFileContents({
                    owner: this.owner,
                    repo: this.repo,
                    path: operation.path,
                    message: `Update ${operation.path}`,
                    content: Buffer.from(newContent).toString('base64'),
                    sha: currentSha,
                    branch: this.branch
                });
                // Only log success for inventory files
                if (operation.path.includes('Fggems-Inventory.txt') ||
                    operation.path.includes('Fsbank-Inventory.txt') ||
                    operation.path.includes('Fgspells-Inventory.txt')) {
                    logger_1.logger.info(`Successfully processed file: ${operation.path}`);
                }
                return;
            }
            catch (error) {
                retries++;
                if (retries === this.maxRetries) {
                    throw error;
                }
                const delay = this.retryDelay * Math.pow(2, retries - 1);
                logger_1.logger.warn(`Retry ${retries}/${this.maxRetries} for ${operation.path} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    /**
     * Process multiple files in batches
     */
    async processBatch(operations) {
        const results = [];
        const batches = this.chunkArray(operations, this.batchSize);
        for (const batch of batches) {
            const batchResults = await Promise.allSettled(batch.map(operation => this.addToQueue(operation)));
            batchResults.forEach((result, index) => {
                results.push({
                    success: result.status === 'fulfilled',
                    path: batch[index].path,
                    error: result.status === 'rejected'
                        ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
                        : undefined
                });
            });
        }
        return results;
    }
    /**
     * Splits an array into chunks of specified size
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
exports.FileProcessor = FileProcessor;
//# sourceMappingURL=fileProcessor.js.map