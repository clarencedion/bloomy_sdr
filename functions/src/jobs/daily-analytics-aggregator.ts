import { logger } from "firebase-functions";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { recordDailyAnalyticsSnapshot } from "../services/analytics-service.js";
import { savePerformanceInsights } from "../services/learning-service.js";

/**
 * Daily job aggregating full funnel metrics, dimension breakdowns, and closed-loop recommendations
 */
export async function runDailyAnalyticsAggregator(): Promise<{
  workspacesProcessed: number;
  businessesProcessed: number;
  snapshotsCreated: number;
}> {
  logger.info("[daily-analytics-aggregator] Starting daily analytics aggregation...");

  const workspacesSnap = await adminDb.collection("workspaces").get();
  const workspaceIds = workspacesSnap.empty ? ["ws_default"] : workspacesSnap.docs.map((d) => d.id);

  let businessesProcessed = 0;
  let snapshotsCreated = 0;

  for (const wsId of workspaceIds) {
    // 1. Snapshot for entire workspace
    try {
      await recordDailyAnalyticsSnapshot({ workspaceId: wsId, db: adminDb });
      await savePerformanceInsights({ workspaceId: wsId, db: adminDb });
      snapshotsCreated++;
    } catch (err) {
      logger.error(`[daily-analytics-aggregator] Failed workspace snapshot for ${wsId}: ${err instanceof Error ? err.message : err}`);
    }

    // 2. Snapshot per discrete business within workspace
    try {
      const businessesSnap = await adminDb.collection(`workspaces/${wsId}/businesses`).get();
      for (const bizDoc of businessesSnap.docs) {
        const bizId = bizDoc.id;
        try {
          await recordDailyAnalyticsSnapshot({ workspaceId: wsId, businessId: bizId, db: adminDb });
          await savePerformanceInsights({ workspaceId: wsId, businessId: bizId, db: adminDb });
          businessesProcessed++;
          snapshotsCreated++;
        } catch (bizErr) {
          logger.warn(`[daily-analytics-aggregator] Failed business snapshot for ${wsId}/${bizId}: ${bizErr instanceof Error ? bizErr.message : bizErr}`);
        }
      }
    } catch (err) {
      logger.warn(`[daily-analytics-aggregator] Could not query businesses for ${wsId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await writeLog({
    type: "analytics.daily_aggregator",
    level: "info",
    message: `Daily analytics aggregation completed. Processed ${workspaceIds.length} workspaces, ${businessesProcessed} businesses, created ${snapshotsCreated} snapshots.`,
    metadata: {
      workspacesProcessed: workspaceIds.length,
      businessesProcessed,
      snapshotsCreated
    }
  });

  logger.info(`[daily-analytics-aggregator] Completed. Snapshots created: ${snapshotsCreated}`);

  return {
    workspacesProcessed: workspaceIds.length,
    businessesProcessed,
    snapshotsCreated
  };
}
