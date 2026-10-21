import { accessSync, constants, existsSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx } from './context.ts';
import { storagePolicy } from './storage.ts';
import { recoveryStatus } from './recoveryControl.ts';

const HOUR = 3_600_000;
export function readiness(ctx: Ctx) {
  try {
    if (ctx.services.isStopping?.()) return false;
    ctx.db.get('SELECT 1');
    if (ctx.db.file !== ':memory:') {
      accessSync(ctx.db.file, constants.W_OK);
      accessSync(ctx.config.dataDir, constants.W_OK);
      const disk = statfsSync(ctx.config.dataDir);
      if (disk.bavail * disk.bsize < 128 * 1024 * 1024) return false;
    }
    return true;
  } catch { return false; }
}

export function diagnostics(ctx: Ctx) {
  const status = recoveryStatus(ctx);
  const raw = status.remote && typeof status.remote === 'object' ? status.remote as Record<string, unknown> : {};
  const validDate = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300_000 ? value : null;
  const capturedAt = validDate(raw.lastSuccessfulCaptureAt);
  const uploadedAt = validDate(raw.lastUploadedAt);
  const checkedAt = validDate(raw.lastCheckedAt);
  const verifiedAt = validDate(raw.lastRestoreVerifiedAt);
  const configured = raw.version === 1;
  const overdue = !capturedAt || !uploadedAt || Date.parse(uploadedAt) < Date.parse(capturedAt) || Date.now() - Date.parse(capturedAt) > HOUR;
  const verificationOverdue = !verifiedAt || Date.now() - Date.parse(verifiedAt) > 8 * 24 * HOUR;
  const error = raw.lastError === 'backup_failed' ? 'backup_failed' : null;
  const verificationError = raw.verificationError === 'verification_failed' ? 'verification_failed' : null;
  let storageWarning: string | null = null;
  let storage: { availableBytes: number; totalBytes: number } | null = null;
  try { storageWarning = storagePolicy(ctx.config.dataDir, ctx.config.journalMode).warning; const disk = statfsSync(ctx.config.dataDir); storage = { availableBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize }; } catch { /* unknown is not healthy */ }
  return {
    ready: readiness(ctx),
    build: { version: ctx.config.version, commit: ctx.config.commit ?? null, builtAt: ctx.config.builtAt ?? null, image: ctx.config.imageDigest ?? null, launcherVersion: ctx.config.launcherVersion || null, schemaVersion: ctx.db.schemaVersion },
    runtime: { uid: process.getuid?.() ?? null, gid: process.getgid?.() ?? null, rootOverride: process.env.ALLOW_ROOT === '1' },
    storage,
    storageWarning,
    recovery: { configured, state: !configured ? 'not_configured' : overdue ? 'overdue' : error ? 'error' : 'current', capturedAt, uploadedAt, checkedAt, verifiedAt, verificationOverdue, error, verificationError, snapshotRunning: status.snapshotRunning, targetRecoveryPointMinutes: 60, targetRestoreMinutes: 120 },
    externalKey: !!process.env.SECRET_KEY,
    keyFilePresent: existsSync(join(ctx.config.dataDir, 'secret.key')),
  };
}
