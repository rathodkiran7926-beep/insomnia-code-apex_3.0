import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const RUNNER_IMAGE = "codebase-mentor-journey-runner:1";
const approved = { "signup-success": "success", "signup-invalid": "invalid" };
const cliEnvironment = () =>
  Object.fromEntries(
    [
      "PATH",
      "Path",
      "SystemRoot",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "HOME",
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
export function runnerArguments(recipe, name) {
  if (
    !Object.hasOwn(approved, recipe) ||
    !/^mentor-journey-[a-f0-9-]+$/.test(name)
  )
    throw new Error("Unapproved execution recipe");
  return [
    "run",
    "--rm",
    "--pull=never",
    "--name",
    name,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--memory=192m",
    "--memory-swap=192m",
    "--cpus=0.5",
    "--pids-limit=48",
    "--user=65534:65534",
    "--tmpfs=/tmp:rw,noexec,nosuid,size=8m",
    RUNNER_IMAGE,
    approved[recipe],
  ];
}
export async function runnerStatus() {
  try {
    await exec(
      "docker",
      ["image", "inspect", RUNNER_IMAGE, "--format", "{{.Id}}"],
      {
        timeout: 3000,
        maxBuffer: 4096,
        windowsHide: true,
        env: cliEnvironment(),
      },
    );
    return {
      available: true,
      message:
        "Approved isolated runner image is available. Running a scenario requires your explicit approval.",
    };
  } catch {
    return {
      available: false,
      message:
        "Observed replay requires a running Docker engine and the approved runner image. Explained paths remain available.",
      setupCommand:
        "docker build -t codebase-mentor-journey-runner:1 backend/journey-runner",
    };
  }
}
export async function runApprovedScenario(recipe) {
  const name = `mentor-journey-${randomUUID()}`;
  try {
    const { stdout } = await exec("docker", runnerArguments(recipe, name), {
      timeout: 12000,
      maxBuffer: 48000,
      windowsHide: true,
      env: cliEnvironment(),
    });
    return JSON.parse(stdout.trim());
  } catch {
    throw Object.assign(
      new Error(
        "The isolated scenario did not complete. Start Docker and build the approved image. No observed trace was created; use Explained path.",
      ),
      { status: 503 },
    );
  } finally {
    await exec("docker", ["rm", "-f", name], {
      timeout: 3000,
      maxBuffer: 1024,
      windowsHide: true,
      env: cliEnvironment(),
    }).catch(() => {});
  }
}
