/**
 * Native Windows folder picker via PowerShell shell-out.
 *
 * Invokes a bundled PowerShell script (pick-folder.ps1) that uses the modern
 * IFileDialog COM interface with FOS_PICKFOLDERS — same dialog Word, Visual
 * Studio, Notepad++, etc. use for "Open Folder". Much cleaner than the legacy
 * System.Windows.Forms.FolderBrowserDialog tree-view.
 */

import { join } from "node:path";

export interface PickerOptions {
  description?: string;
  initialPath?: string;
  /** Abort the dialog after this many milliseconds (defaults to 5 minutes). */
  timeoutMs?: number;
}

export interface PickerResult {
  picked?: string;
  cancelled?: boolean;
  error?: string;
}

const SCRIPT_PATH = join(import.meta.dir, "pick-folder.ps1");

export async function showWindowsFolderPicker(opts: PickerOptions = {}): Promise<PickerResult> {
  const description = opts.description ?? "Select your APICatalog folder";
  const initial = opts.initialPath ?? "";
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(
      [
        "powershell.exe",
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
      { stdout: "pipe", stderr: "pipe" },
    );
  } catch (err) {
    return { error: `could not spawn PowerShell: ${(err as Error).message}` };
  }

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // already exited
    }
  }, timeoutMs);

  try {
    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    const stderr = proc.stderr as ReadableStream<Uint8Array>;
    const [stdoutText, stderrText] = await Promise.all([
      new Response(stdout).text(),
      new Response(stderr).text(),
    ]);
    const exit = await proc.exited;
    clearTimeout(timer);

    if (exit !== 0) {
      const msg = stderrText.trim() || `PowerShell exited with ${exit}`;
      return { error: msg };
    }

    const picked = stdoutText.trim();
    return picked ? { picked } : { cancelled: true };
  } catch (err) {
    clearTimeout(timer);
    return { error: (err as Error).message };
  }
}
