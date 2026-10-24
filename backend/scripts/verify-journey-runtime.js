// Explicit operator command: executes only the two fixed recipes in Docker.
import { writeFileSync } from "node:fs";
process.env.DATABASE_PATH = ":memory:";
const { runnerStatus, runApprovedScenario } =
  await import("../src/journeyRunner.js");
const { journeyById } = await import("../src/journeyCatalog.js");
const { validateObservedRun } = await import("../src/journeyService.js");
const status = await runnerStatus();
if (!status.available) {
  console.log(JSON.stringify({ executed: false, ...status }));
  process.exitCode = 2;
} else {
  const journey = journeyById("signup"),
    results = [];
  for (const id of ["success", "invalid"]) {
    const scenario = journey.scenarios.find((s) => s.id === id);
    const result = validateObservedRun(
      journey,
      scenario,
      await runApprovedScenario(scenario.runRecipe),
    );
    results.push(result);
  }
  writeFileSync(
    new URL("../data/codejourney-runtime-verification.json", import.meta.url),
    JSON.stringify(
      { executed: true, sourceHash: journey.sourceHash, results },
      null,
      2,
    ),
  );
  console.log(
    "Both approved isolated requests were executed and their recorded branches validated.",
  );
}
