import { getDb } from '../db/mongo.js';

function deriveTarget(args) {
  if (!Array.isArray(args)) return null;
  return args.find((a) => !a.startsWith('-')) ?? null;
}

// Insert-only: и успешные, и отклонённые валидатором команды — оба типа
// нужны для investigation по abuse-репортам при отсутствии обязательных
// аккаунтов (TECH.md §5.6). Апдейтов/удалений здесь нет и не должно быть —
// стирание старых записей идёт только через TTL-индекс (db/mongo.js).
export async function logCommand(entry) {
  const doc = {
    timestamp: new Date(),
    ipHash: entry.ipHash,
    apiKeyId: entry.apiKeyId ?? null,
    rawCommand: entry.rawCommand ?? null,
    binary: entry.binary ?? null,
    args: entry.args ?? null,
    target: entry.target ?? deriveTarget(entry.args),
    sandboxId: entry.sandboxId ?? null,
    durationMs: entry.durationMs ?? null,
    exitCode: entry.exitCode ?? null,
    outputBytes: entry.outputBytes ?? null,
    outputTruncated: entry.outputTruncated ?? false,
    timedOut: entry.timedOut ?? false,
    rejected: entry.rejected ?? false,
    rejectionReason: entry.rejectionReason ?? null,
  };

  await getDb().collection('audit_logs').insertOne(doc);
}
