import fs from "fs";
import path from "path";

/**
 * Resolve a writable directory for editor imports.
 * Prefer /tmp in serverless, fall back to project tmp/editor-imports.
 */
export const getEditorImportsDir = () => {
  const preferred = "/tmp/editor-imports";
  const fallback = path.join(process.cwd(), "tmp", "editor-imports");
  const dir = preferred || fallback;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export default getEditorImportsDir;
