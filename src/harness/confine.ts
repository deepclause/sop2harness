import path from "node:path";
import { realpath } from "node:fs/promises";

/** True when `child` is lexically equal to or inside `parent`. */
export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolve a write target inside `root` without following symlinks (target may not exist). */
export function resolveWriteInside(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  if (!isInside(root, resolved)) {
    throw new Error(`Path escapes harness root: ${relPath}`);
  }
  return resolved;
}

/** Resolve an existing file inside `root`, following symlinks and re-checking containment. */
export async function resolveExistingInside(root: string, relPath: string): Promise<string> {
  const resolved = path.resolve(root, relPath);
  if (!isInside(root, resolved)) {
    throw new Error(`Path escapes harness root: ${relPath}`);
  }
  const [realRoot, realChild] = await Promise.all([realpath(root), realpath(resolved)]);
  if (!isInside(realRoot, realChild)) {
    throw new Error(`Path escapes harness root through a symlink: ${relPath}`);
  }
  return realChild;
}
