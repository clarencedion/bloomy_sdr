import { logger } from "firebase-functions";
import { getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { processPendingTasksBatch } from "../services/task-queue-service.js";

/**
 * Background worker executing pending jobs in bounded chunks (REQ-080)
 */
export async function runTaskQueueWorker(): Promise<{ processed: number; succeeded: number; failed: number; retried: number }> {
  const settings = await getGlobalSettings();

  if (settings.automationPaused) {
    logger.info("[task-queue-worker] Automation paused — skipping queue processing.");
    return { processed: 0, succeeded: 0, failed: 0, retried: 0 };
  }

  const batchLimit = Math.min(settings.maxConcurrentTasks ?? 10, 20);
  const result = await processPendingTasksBatch(batchLimit);

  if (result.processed > 0) {
    logger.info(`[task-queue-worker] Processed ${result.processed} tasks: ${result.succeeded} succeeded, ${result.retried} retried, ${result.failed} failed.`);
    await writeLog({
      type: "queue.worker.batch_completed",
      level: "info",
      message: `Task Queue Worker processed ${result.processed} tasks (${result.succeeded} succeeded, ${result.retried} retried, ${result.failed} failed).`,
      metadata: result
    });
  }

  return result;
}
