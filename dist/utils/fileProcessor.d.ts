import { Octokit } from '@octokit/rest';
interface FileOperation {
    path: string;
    content: string;
    append?: boolean;
}
interface BatchResult {
    success: boolean;
    path: string;
    error?: string;
}
declare class FileProcessor {
    private octokit;
    private owner;
    private repo;
    private branch;
    private queue;
    private processing;
    private batchSize;
    private retryDelay;
    private maxRetries;
    constructor(octokit: Octokit, owner: string, repo: string, branch: string);
    /**
     * Adds a file operation to the queue
     */
    addToQueue(operation: FileOperation): Promise<void>;
    /**
     * Processes the queue of file operations
     */
    private processQueue;
    /**
     * Processes a single file with retry logic
     */
    private processFile;
    /**
     * Process multiple files in batches
     */
    processBatch(operations: FileOperation[]): Promise<BatchResult[]>;
    /**
     * Splits an array into chunks of specified size
     */
    private chunkArray;
}
export { FileProcessor, FileOperation, BatchResult };
