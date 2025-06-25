import { createHash } from 'crypto';
import { Octokit } from '@octokit/rest';
import { logger } from './logger';

interface GitHubFileContent {
  type: string;
  content: string;
  encoding: string;
}

interface VerificationResult {
  success: boolean;
  checksum: string;
  error?: string;
}

interface VerificationCache {
  checksum: string;
  lastVerified: number;
  status: 'success' | 'failed';
  error?: string;
}

export async function verifyGitHubUpload(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  localContent: string,
  currentCache?: VerificationCache,
  branch: string = 'master'
): Promise<VerificationResult> {
  try {
    // If we have a recent successful verification in cache, use it
    if (currentCache?.status === 'success' && 
        currentCache.checksum === createHash('sha256').update(localContent).digest('hex') &&
        Date.now() - currentCache.lastVerified < 5 * 60 * 1000) { // 5 minutes
      logger.info(`Using cached verification for ${path}`);
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

    const data = response.data as GitHubFileContent;
    
    if (data.type !== 'file' || data.encoding !== 'base64') {
      throw new Error('Invalid response from GitHub API');
    }

    // Decode and verify content
    const remoteContent = Buffer.from(data.content, 'base64').toString();
    const localChecksum = createHash('sha256').update(localContent).digest('hex');
    const remoteChecksum = createHash('sha256').update(remoteContent).digest('hex');

    logger.info(`Verifying ${path}:`);
    logger.info(`Local checksum: ${localChecksum}`);
    logger.info(`Remote checksum: ${remoteChecksum}`);

    const success = localChecksum === remoteChecksum;
    
    if (!success) {
      logger.warn(`Checksum mismatch for ${path}`);
      logger.warn(`Local: ${localChecksum}`);
      logger.warn(`Remote: ${remoteChecksum}`);
    }

    return {
      success,
      checksum: localChecksum,
      error: success ? undefined : 'Checksum mismatch'
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Verification failed for ${path}: ${errorMessage}`);
    return {
      success: false,
      checksum: createHash('sha256').update(localContent).digest('hex'),
      error: errorMessage
    };
  }
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let retries = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        throw error;
      }

      logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
} 