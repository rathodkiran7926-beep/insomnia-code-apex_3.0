import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { sourceJourneySkills } = await import("../src/journeySkills.js");
test("React hooks and JSX are grounded in real imports including aliases", () => {
  const component =
    "export function Account() {const [value]=state('');return <div>{value}</div>; }";
  const result = sourceJourneySkills(
    "src/Account.tsx",
    "import {useState as state} from 'react';\n" + component,
    component,
  );
  assert(result.skills.includes("React"));
  assert(result.skills.includes("TypeScript"));
  assert.equal(result.evidence[0].basis, "source_import");
});
test("framework names in comments, strings, types or helper names are not source usage", () => {
  const component = "export function reactHelper(){ return 'react'; }";
  const source =
    "// import React from 'react';\nimport type {ReactNode} from 'react';\n" +
    component;
  assert(
    !sourceJourneySkills("helper.ts", source, component).skills.includes(
      "React",
    ),
  );
});
test("plain helpers in a React file are not automatically React components", () => {
  const component = "export function add(a,b){ return a+b; }";
  assert(
    !sourceJourneySkills(
      "helper.tsx",
      "import {useState} from 'react';\n" + component,
      component,
    ).skills.includes("React"),
  );
});
test("automatic JSX uses the nearest stored React manifest; JSX alone does not prove React", () => {
  const component = "export function Account(){return <h1>Account</h1>}";
  assert(
    !sourceJourneySkills("Account.tsx", component, component).skills.includes(
      "React",
    ),
  );
  const result = sourceJourneySkills("web/Account.tsx", component, component, {
    file: "web/package.json",
    content: JSON.stringify({ dependencies: { react: "19" } }),
  });
  assert(result.skills.includes("React"));
  assert.equal(result.evidence[0].file, "web/package.json");
  assert(
    !sourceJourneySkills("Account.tsx", component, component, {
      file: "package.json",
      content: JSON.stringify({ dependencies: { react: "19", preact: "10" } }),
    }).skills.includes("React"),
  );
});
test("Express and Node skills come from used imports rather than arbitrary backend paths", () => {
  const component = "export function load(){return readFileSync('file');}";
  assert(
    sourceJourneySkills(
      "backend/service.ts",
      "import {readFileSync} from 'node:fs';\n" + component,
      component,
    ).skills.includes("Node.js"),
  );
  assert(
    !sourceJourneySkills(
      "backend/service.ts",
      component,
      component,
    ).skills.includes("Node.js"),
  );
});
