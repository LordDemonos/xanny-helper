"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyGitHubUpload = verifyGitHubUpload;
exports.retryWithBackoff = retryWithBackoff;
const crypto_1 = require("crypto");
const logger_1 = require("./logger");
async function verifyGitHubUpload(octokit, owner, repo, path, localContent, currentCache, branch = 'master') {
    try {
        // If we have a recent successful verification in cache, use it
        if (currentCache?.status === 'success' &&
            currentCache.checksum === (0, crypto_1.createHash)('sha256').update(localContent).digest('hex') &&
            Date.now() - currentCache.lastVerified < 5 * 60 * 1000) { // 5 minutes
            logger_1.logger.info(`Using cached verification for ${path}`);
            return {
                success: true,
                checksum: currentCache.checksum
            };
        }
        // Fetch the file from GitHub
        const response = await octokit.repos.getContent({
            owner,
            repo,
            path,
            ref: branch
        });
        const data = response.data;
        if (data.type !== 'file' || data.encoding !== 'base64') {
            throw new Error('Invalid response from GitHub API');
        }
        // Decode and verify content
        const remoteContent = Buffer.from(data.content, 'base64').toString();
        const localChecksum = (0, crypto_1.createHash)('sha256').update(localContent).digest('hex');
        const remoteChecksum = (0, crypto_1.createHash)('sha256').update(remoteContent).digest('hex');
        logger_1.logger.info(`Verifying ${path}:`);
        logger_1.logger.info(`Local checksum: ${localChecksum}`);
        logger_1.logger.info(`Remote checksum: ${remoteChecksum}`);
        const success = localChecksum === remoteChecksum;
        if (!success) {
            logger_1.logger.warn(`Checksum mismatch for ${path}`);
            logger_1.logger.warn(`Local: ${localChecksum}`);
            logger_1.logger.warn(`Remote: ${remoteChecksum}`);
        }
        return {
            success,
            checksum: localChecksum,
            error: success ? undefined : 'Checksum mismatch'
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger_1.logger.error(`Verification failed for ${path}: ${errorMessage}`);
        return {
            success: false,
            checksum: (0, crypto_1.createHash)('sha256').update(localContent).digest('hex'),
            error: errorMessage
        };
    }
}
async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 1000) {
    let retries = 0;
    let delay = initialDelay;
    while (true) {
        try {
            return await operation();
        }
        catch (error) {
            retries++;
            if (retries >= maxRetries) {
                throw error;
            }
            logger_1.logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${retries}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
    }
}
//# sourceMappingURL=verification.js.map