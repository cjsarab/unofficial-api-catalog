/**
 * Native Windows folder picker via PowerShell shell-out.
 *
 * Invokes a bundled PowerShell script (pick-folder.ps1) that uses the modern
 * IFileDialog COM interface with FOS_PICKFOLDERS — same dialog Word, Visual
 * Studio, Notepad++, etc. use for "Open Folder". Much cleaner than the legacy
 * System.Windows.Forms.FolderBrowserDialog tree-view.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Default abort timeout for the folder-picker dialog (5 minutes). */
const DEFAULT_PICKER_TIMEOUT_MS = 5 * 60 * 1000;

export interface PickerOptions {
  description?: string;
  initialPath?: string;
  /** Abort the dialog after this many milliseconds. Defaults to 5 minutes. */
  timeoutMs?: number;
}

export interface PickerResult {
  picked?: string;
  cancelled?: boolean;
  error?: string;
}

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "pick-folder.ps1");

export async function showWindowsFolderPicker(opts: PickerOptions = {}): Promise<PickerResult> {
  const description = opts.description ?? "Select your APICatalog folder";
  const initial = opts.initialPath ?? "";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PICKER_TIMEOUT_MS;

  return new Promise<PickerResult>((resolveResult) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-Sta",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          SCRIPT_PATH,
          "-Title",
          description,
          "-InitialPath",
          initial,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      resolveResult({ error: `could not spawn PowerShell: ${(err as Error).message}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolveResult({ error: err.message });
    });

    proc.on("close", (exit) => {
      clearTimeout(timer);
      if (exit !== 0) {
        const msg = stderr.trim() || `PowerShell exited with ${exit}`;
        resolveResult({ error: msg });
        return;
      }
      const picked = stdout.trim();
      resolveResult(picked ? { picked } : { cancelled: true });
    });
  });
}
