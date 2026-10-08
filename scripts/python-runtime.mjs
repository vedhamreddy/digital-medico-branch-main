import { spawnSync } from "node:child_process";
export function pythonRuntime() {
  const choices =
    process.platform === "win32"
      ? [
          ["py", ["-3"]],
          ["python", []],
        ]
      : [
          ["python3", []],
          ["python", []],
        ];
  for (const [command, args] of choices) {
    const probe = spawnSync(
      command,
      [
        ...args,
        "-c",
        "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)",
      ],
      { stdio: "ignore" },
    );
    if (!probe.error && probe.status === 0) return { command, args };
  }
  throw new Error(
    "Python 3.12 or newer is required. Install it from python.org; on Windows, select Add Python to PATH.",
  );
}
