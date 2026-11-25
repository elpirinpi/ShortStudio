import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STALE_PREFIXES = [
  'ytdlp_ss_',
  'direct_ss_',
  'ss_ffmpeg',
  'ss_deno',
  'ss_in_',
  'ss_out_',
  'yt_v_',
  'yt_a_',
  'yt_out_',
];

export async function cleanupOrphanedTempFiles(
  maxAgeMs = 30 * 60 * 1000
): Promise<void> {
  const now = Date.now();
  const tmpRoot = os.tmpdir();

  try {
    const entries = await fs.promises.readdir(tmpRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!STALE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
      const fullPath = path.join(tmpRoot, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
        }
      } catch {
        // ignore individual entry errors
      }
    }

    const jobsRoot = path.join(tmpRoot, 'ss_media_jobs');
    if (fs.existsSync(jobsRoot)) {
      const jobEntries = await fs.promises.readdir(jobsRoot, { withFileTypes: true });
      for (const je of jobEntries) {
        const full = path.join(jobsRoot, je.name);
        try {
          const stat = await fs.promises.stat(full);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.promises.rm(full, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore temp scan errors
  }
}
