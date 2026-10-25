(() => {
  "use strict";
  const { files, graph } = window.EVIDENCE_DEMO;
  const $ = (id) => document.getElementById(id);
  const nodes = new Map(graph.components.map((node) => [node.id, node]));
  const references = new Map(graph.references.map((ref) => [ref.id, ref]));
  const positions = {
    "app.ts": [60, 55],
    "handlers.ts": [310, 55],
    "users.ts": [560, 55],
    app: [20, 235],
    "POST /signup": [215, 235],
    signupHandler: [410, 235],
    createUser: [605, 235],
  };
  const steps = [
    [
      "Snapshot",
      "Pin the source version",
      "Begin with the files and commit of one repository version. The source is the evidence; no application code is executed.",
    ],
    [
      "Components",
      "Discover the building blocks",
      "The TypeScript compiler parses declarations and Express registrations. Files, the application, a route, and functions become nodes.",
    ],
    [
      "Imports",
      "Resolve file connections",
      "The compiler resolves local imports to their source modules. An import connects files; it does not prove that a function was called.",
    ],
    [
      "Routes",
      "Connect the HTTP entry point",
      "The analyzer recognises app.post() and resolves its handler argument. Route registration creates two distinct relationships.",
    ],
    [
      "Calls",
      "Resolve a function call",
      "Inside signupHandler, createUser(...) resolves to the declaration in users.ts. A static call edge connects these two functions.",
    ],
    [
      "Evidence",
      "Keep the proof with the graph",
      "Each arrow has a source ID, target ID, type, and source reference. Select a connection to inspect the code that supports it.",
    ],
  ];
  const relationshipText = {
    imports:
      "A local import resolves to this module. This supports a file dependency, not an observed execution or a function call.",
    registers_route:
      "The app.post registration declares the POST /signup route on this Express application.",
    handles_route:
      "The handler argument in app.post resolves to the signupHandler declaration. This connects the route to its handler.",
    calls:
      "The createUser identifier in the call expression resolves to the function declaration in users.ts. Actual input values and runtime results remain unknown.",
  };
  const labels = {
    imports: "imports",
    registers_route: "registers route",
    handles_route: "uses handler",
    calls: "calls",
  };
  let stage = 0;
  let selected = null;
  let reference = null;
  let playing = false;
  let timer = null;

  function text(tag, content, className) {
    const el = document.createElement(tag);
    el.textContent = content;
    if (className) el.className = className;
    return el;
  }
  function visibleEdge(edge) {
    return (
      stage >= (edge.type === "imports" ? 2 : edge.type === "calls" ? 4 : 3)
    );
  }
  function stop() {
    playing = false;
    clearTimeout(timer);
    timer = null;
    $("play").textContent =
      stage === steps.length - 1 ? "Replay build" : "Play build";
    $("play").setAttribute("aria-pressed", "false");
  }
  function select(item, kind, pause = true) {
    if (pause) stop();
    selected = item;
    reference = references.get(item?.referenceId) || null;
    $("selection-kind").textContent =
      kind === "edge"
        ? "RELATIONSHIP EVIDENCE"
        : kind === "node"
          ? "COMPONENT EVIDENCE"
          : "PINNED TEACHING SOURCE";
    $("selection-name").textContent =
      kind === "edge"
        ? `${nodes.get(item.source).name} ${labels[item.type]} ${nodes.get(item.target).name}`
        : item?.name || "Three files, one version";
    $("selection-reason").textContent =
      kind === "edge"
        ? relationshipText[item.type]
        : kind === "node"
          ? `The analyzer identifies ${item.name} as a ${item.role}. Its source reference points to the declaration or registration below. Select a connection to see how it links to another component.`
          : "The teaching files are captured together. Next, the parser discovers the components without running these files.";
    $("evidence-chain").replaceChildren();
    if (item) {
      $("evidence-chain").append(
        text(
          "code",
          kind === "edge"
            ? `${item.id}: ${item.source} → ${item.target} · ${item.type}`
            : `${item.id} · ${item.role}`,
        ),
      );
      $("evidence-chain").append(
        document.createElement("br"),
        text(
          "code",
          `${item.referenceId} → ${reference.file}:${reference.startLine}–${reference.endLine}`,
        ),
      );
    } else
      $("evidence-chain").append(
        text("code", "Illustrative repository · teaching commit dddddddddddd"),
      );
    $("source-file").value = reference?.file || "app.ts";
    renderSource();
    renderGraph();
  }
  function syntax(code) {
    const fragment = document.createDocumentFragment();
    const pattern =
      /('[^']*'|"[^"]*"|\b(?:import|from|export|function|const|return|false|true)\b|\b[A-Za-z_$][\w$]*(?=\())/g;
    let previous = 0;
    for (const match of code.matchAll(pattern)) {
      fragment.append(
        document.createTextNode(code.slice(previous, match.index)),
      );
      const token = match[0];
      fragment.append(
        text(
          "span",
          token,
          /^['"]/.test(token)
            ? "token-string"
            : /^(import|from|export|function|const|return|false|true)$/.test(
                  token,
                )
              ? "token-keyword"
              : "token-function",
        ),
      );
      previous = match.index + token.length;
    }
    fragment.append(document.createTextNode(code.slice(previous)));
    return fragment;
  }
  function renderSource() {
    const file = $("source-file").value;
    const active = reference?.file === file ? reference : null;
    $("line-reference").textContent = active
      ? `Lines ${active.startLine}–${active.endLine}`
      : "Example source";
    $("source").replaceChildren();
    files[file]
      .trimEnd()
      .split("\n")
      .forEach((line, i) => {
        const row = document.createElement("div");
        row.className =
          "code-line" +
          (active && i + 1 >= active.startLine && i + 1 <= active.endLine
            ? " highlight"
            : "");
        const code = document.createElement("code");
        code.append(syntax(line || " "));
        row.append(text("span", String(i + 1), "line-number"), code);
        $("source").append(row);
      });
  }
  function svg(tag, attributes) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes))
      el.setAttribute(key, String(value));
    return el;
  }
  function renderGraph() {
    $("nodes").replaceChildren();
    $("edges")
      .querySelectorAll(".relationship")
      .forEach((el) => el.remove());
    $("relationship-list").replaceChildren();
    $("snapshot-intro").hidden = stage !== 0;
    const edges = stage ? graph.relationships.filter(visibleEdge) : [];
    $("graph-count").textContent =
      `${stage ? nodes.size : 0} nodes · ${edges.length} connections`;
    $("connection-hint").hidden = edges.length > 0;
    if (!stage) return;
    for (const node of nodes.values()) {
      const [left, top] = positions[node.name];
      const button = document.createElement("button");
      button.className = `graph-node ${node.role}`;
      button.style.left = left + "px";
      button.style.top = top + "px";
      button.setAttribute("aria-label", `Inspect ${node.name}, ${node.role}`);
      button.setAttribute("aria-pressed", String(selected?.id === node.id));
      const icon = text(
        "span",
        node.role === "module"
          ? "▤"
          : node.role === "route"
            ? "↗"
            : node.role === "application"
              ? "◇"
              : "{ }",
        "node-icon",
      );
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.append(
        text("strong", node.name),
        text("small", `${node.role} · ${node.id}`),
      );
      button.append(icon, label);
      button.addEventListener("click", () => select(node, "node"));
      $("nodes").append(button);
    }
    for (const edge of edges) {
      const [sx, sy] = positions[nodes.get(edge.source).name];
      const [tx, ty] = positions[nodes.get(edge.target).name];
      const x1 = sx + 158,
        x2 = tx,
        y = sy + 36;
      const group = svg("g", { class: "relationship" });
      const path = svg("path", {
        d: `M ${x1} ${y} L ${x2 - 3} ${ty + 36}`,
        class: `edge-line ${selected?.id === edge.id ? "edge-selected" : ""}`,
      });
      const caption = svg("text", {
        x: (x1 + x2) / 2,
        y: sy - 12,
        "text-anchor": "middle",
        class: "edge-label",
      });
      caption.textContent = labels[edge.type];
      const title = svg("title", {});
      title.textContent = `${nodes.get(edge.source).name} → ${nodes.get(edge.target).name}: ${edge.type}`;
      group.append(title, path, caption);
      $("edges").append(group);
      const button = text(
        "button",
        `${nodes.get(edge.source).name} → ${nodes.get(edge.target).name} · ${labels[edge.type]}`,
      );
      button.setAttribute("aria-pressed", String(selected?.id === edge.id));
      button.addEventListener("click", () => select(edge, "edge"));
      $("relationship-list").append(button);
    }
  }
  function go(value, pause = true) {
    if (pause) stop();
    stage = Math.max(0, Math.min(steps.length - 1, value));
    $("step-number").textContent = `STEP ${stage + 1} OF ${steps.length}`;
    $("step-title").textContent = steps[stage][1];
    $("step-description").textContent = steps[stage][2];
    $("back").disabled = stage === 0;
    $("next").disabled = stage === steps.length - 1;
    $("steps")
      .querySelectorAll("button")
      .forEach((button, i) => {
        if (stage === i) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    const edge = graph.relationships.find((e) =>
      stage === 2
        ? e.type === "imports" && nodes.get(e.source).name === "app.ts"
        : stage === 3
          ? e.type === "registers_route"
          : stage === 4
            ? e.type === "calls"
            : stage === 5
              ? e.type === "handles_route"
              : false,
    );
    select(
      edge ||
        (stage === 1
          ? graph.components.find((c) => c.name === "signupHandler")
          : null),
      edge ? "edge" : stage === 1 ? "node" : "snapshot",
      false,
    );
    if (!playing) stop();
  }
  function advance() {
    timer = setTimeout(() => {
      if (!playing) return;
      go(stage + 1, false);
      if (stage === steps.length - 1) stop();
      else advance();
    }, 2600);
  }
  steps.forEach(([name], i) => {
    const button = document.createElement("button");
    button.append(text("span", String(i + 1)), document.createTextNode(name));
    button.addEventListener("click", () => go(i));
    $("steps").append(button);
  });
  for (const file of Object.keys(files)) {
    const option = text("option", file);
    option.value = file;
    $("source-file").append(option);
  }
  $("source-file").addEventListener("change", renderSource);
  $("back").addEventListener("click", () => go(stage - 1));
  $("next").addEventListener("click", () => go(stage + 1));
  $("restart").addEventListener("click", () => go(0));
  $("play").addEventListener("click", () => {
    if (playing) return stop();
    if (stage === steps.length - 1) go(0);
    playing = true;
    $("play").textContent = "Pause";
    $("play").setAttribute("aria-pressed", "true");
    advance();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  $("snapshot-id").textContent = graph.snapshotId;
  $("unresolved-count").textContent = `(${graph.report.unresolved.length})`;
  const unresolved = document.createElement("ul");
  for (const item of graph.report.unresolved) {
    const li = document.createElement("li");
    const ref = references.get(item.referenceId);
    const button = text(
      "button",
      `${item.text} · ${ref.file}:${ref.startLine}`,
    );
    button.addEventListener("click", () => {
      stop();
      reference = ref;
      selected = null;
      $("selection-kind").textContent = "UNRESOLVED EVIDENCE";
      $("selection-name").textContent = item.text;
      $("selection-reason").textContent =
        item.reason + ". No relationship is asserted for this item.";
      $("evidence-chain").replaceChildren(
        text("code", `${ref.id} → ${ref.file}:${ref.startLine}–${ref.endLine}`),
      );
      $("source-file").value = ref.file;
      renderSource();
      renderGraph();
    });
    li.append(button, text("p", item.reason));
    unresolved.append(li);
  }
  $("unresolved").append(unresolved);
  go(0);
})();
