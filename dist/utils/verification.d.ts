import { Octokit } from '@octokit/rest';
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
export declare function verifyGitHubUpload(octokit: Octokit, owner: string, repo: string, path: string, localContent: string, currentCache?: VerificationCache, branch?: string): Promise<VerificationResult>;
export declare function retryWithBackoff<T>(operation: () => Promise<T>, maxRetries?: number, initialDelay?: number): Promise<T>;
export {};
