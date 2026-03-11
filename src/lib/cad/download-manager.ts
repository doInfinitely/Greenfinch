import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import type { CountyCode } from './types';
import { COUNTY_CONFIGS } from './types';

export interface DownloadResult {
  extractDir: string;
  files: string[];
}

export async function downloadAndExtract(
  countyCode: CountyCode,
  downloadUrl: string,
): Promise<DownloadResult> {
  const config = COUNTY_CONFIGS[countyCode];
  const tempDir = path.join(os.tmpdir(), `cad-${countyCode}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  console.log(`[CAD Download] Downloading ${config.name} data from ${downloadUrl}...`);

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${countyCode} data: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const zipPath = path.join(tempDir, `${countyCode}.zip`);
  fs.writeFileSync(zipPath, buffer);

  console.log(`[CAD Download] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB, extracting...`);

  const zip = new AdmZip(zipPath);
  const extractDir = path.join(tempDir, 'extracted');
  zip.extractAllTo(extractDir, true);

  // Clean up the zip file
  fs.unlinkSync(zipPath);

  // List extracted files
  const files = listFilesRecursive(extractDir);
  console.log(`[CAD Download] Extracted ${files.length} files to ${extractDir}`);

  return { extractDir, files };
}

export async function downloadFile(
  url: string,
  destPath: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(destPath, buffer);
}

function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export function findFile(extractDir: string, fileName: string): string | null {
  const files = listFilesRecursive(extractDir);
  // Try exact match first, then case-insensitive
  const exact = files.find(f => path.basename(f) === fileName);
  if (exact) return exact;

  const lower = fileName.toLowerCase();
  const caseInsensitive = files.find(f => path.basename(f).toLowerCase() === lower);
  return caseInsensitive || null;
}

/**
 * Find a file by glob-like pattern (supports * wildcards).
 * Tries multiple patterns in order, returns first match.
 */
export function findFileByPattern(extractDir: string, ...patterns: string[]): string | null {
  const files = listFilesRecursive(extractDir);
  for (const pattern of patterns) {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
      'i',
    );
    const match = files.find(f => regex.test(path.basename(f)));
    if (match) return match;
  }
  return null;
}

export function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[CAD Download] Cleaned up temp directory: ${dir}`);
  } catch (e) {
    console.warn(`[CAD Download] Failed to clean up temp dir ${dir}:`, e);
  }
}
