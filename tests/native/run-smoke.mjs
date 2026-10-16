import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = await mkdtemp(join(tmpdir(), "financeapp-native-synthetic-"));
const config = JSON.stringify({
  build: {
    devUrl: "http://127.0.0.1:1422",
    beforeDevCommand: "npm run dev -- --port 1422 --strictPort",
  },
});
const packaged = process.argv.includes("--packaged");
const env = {
  ...process.env,
  FINANCEAPP_SMOKE_DIR: folder,
  VITE_NATIVE_SMOKE: "1",
  VITE_SYNTHETIC_PREVIEW: "0",
};

function run(command, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
      detached: true,
    });
    const timer = setTimeout(() => {
      process.kill(-child.pid, "SIGTERM");
      reject(
        new Error("Native smoke timed out. A display session may be required."),
      );
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Native process exited ${code}.`));
    });
  });
}

try {
  if (packaged) {
    await run(
      "npm",
      [
        "run",
        "tauri",
        "--",
        "build",
        "--debug",
        "--bundles",
        "app",
        "--config",
        JSON.stringify({
          build: { beforeBuildCommand: "npm run build -- --mode native-smoke" },
        }),
      ],
      180_000,
    );
  }
  for (const phase of [
    "write/read through IPC",
    "restart persistence through IPC",
  ]) {
    const outcome = join(folder, "result.txt");
    await rm(outcome, { force: true });
    if (packaged) {
      await run(
        join(
          process.cwd(),
          "src-tauri/target/debug/bundle/macos/Finance App.app/Contents/MacOS/finance-app",
        ),
        [],
        30_000,
      );
    } else {
      await run(
        "npm",
        ["run", "tauri", "--", "dev", "--no-watch", "--config", config],
        120_000,
      );
    }
    if ((await readFile(outcome, "utf8")) !== "pass")
      throw new Error(`Native smoke failed: ${phase}`);
    console.log(
      `PASS: ${packaged ? "packaged debug app" : "native dev"}: ${phase}`,
    );
  }
} finally {
  await rm(folder, { recursive: true, force: true });
}
