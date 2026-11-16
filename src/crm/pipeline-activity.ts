import { crmPipelineActivity, CrmPipelineActivityAction } from '../schema';
import type { CrmTx } from './crm-assignment.service';

export type PipelineActivityEntry = {
  pipelineId: number;
  action: CrmPipelineActivityAction;
  /** Null for system actions; `actorName` is snapshotted alongside. */
  actor: { id: string; username: string } | null;
  runId?: string | null;
  meta: Record<string, unknown>;
};

const toRow = (entry: PipelineActivityEntry) => ({
  pipelineId: entry.pipelineId,
  action: entry.action,
  actorId: entry.actor?.id ?? null,
  actorName: entry.actor?.username ?? null,
  runId: entry.runId ?? null,
  meta: entry.meta,
});

/**
 * WI-1b pipeline history. Always call inside the transaction that makes the
 * change, so a failed log write rolls the change back. Pure `tx` functions,
 * so modules outside CRM (Settings → delete user) can log too.
 */
export async function logPipelineActivity(tx: CrmTx, entry: PipelineActivityEntry) {
  await tx.insert(crmPipelineActivity).values(toRow(entry));
}

/** Several entries in one insert. */
export async function logPipelineActivities(tx: CrmTx, entries: PipelineActivityEntry[]) {
  if (entries.length === 0) return;
  await tx.insert(crmPipelineActivity).values(entries.map(toRow));
}
