import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run a command and collect its output. Throws on non-zero exit by default.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { allowNonZero?: boolean; cwd?: string; quiet?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      const s = c.toString();
      stdout += s;
      if (!opts.quiet) process.stdout.write(s);
    });
    child.stderr.on("data", (c) => {
      const s = c.toString();
      stderr += s;
      if (!opts.quiet) process.stderr.write(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result: RunResult = { stdout, stderr, code: code ?? -1 };
      if (code !== 0 && !opts.allowNonZero) {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
      } else {
        resolve(result);
      }
    });
  });
}
