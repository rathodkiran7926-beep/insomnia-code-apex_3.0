import { functionLabelIndex } from "./functionNames.js";
const legacy = /\banonymous:\d+\b/g;
export function componentNamePresentation(database) {
  return function present(body) {
    const snapshots = new Map();
    function labels(snapshotId) {
      if (!snapshotId || typeof snapshotId !== "string") return null;
      if (snapshots.has(snapshotId)) return snapshots.get(snapshotId);
      const row = database
        .prepare("SELECT graph_json FROM snapshots WHERE id=?")
        .get(snapshotId);
      if (!row) {
        snapshots.set(snapshotId, null);
        return null;
      }
      const graph = JSON.parse(row.graph_json),
        references = new Map(graph.references.map((r) => [r.id, r]));
      const byId = new Map(),
        byReference = new Map(),
        files = new Map();
      for (const component of graph.components) {
        if (!/^anonymous:\d+$/.test(component.name)) continue;
        const ref = references.get(component.referenceId);
        if (!ref) continue;
        if (!files.has(ref.file)) {
          const stored = database
            .prepare(
              "SELECT content FROM source_files WHERE snapshot_id=? AND path=?",
            )
            .get(snapshotId, ref.file);
          files.set(
            ref.file,
            stored ? functionLabelIndex(ref.file, stored.content) : [],
          );
        }
        const entries = files.get(ref.file);
        const exact = Number.isInteger(ref.startOffset)
          ? entries.find(
              (e) =>
                e.start === ref.startOffset &&
                (!Number.isInteger(ref.endOffset) || e.end === ref.endOffset),
            )
          : null;
        const candidates = exact
          ? [exact]
          : entries.filter(
              (e) =>
                e.startLine === ref.startLine &&
                e.endLine === ref.endLine &&
                (!ref.excerpt || e.text.startsWith(ref.excerpt)),
            );
        let name =
          candidates.length === 1
            ? candidates[0].name
            : "Unnamed function (" + ref.file + ":" + ref.startLine + ")";
        const registration = graph.relationships.find(
          (e) => e.type === "handles_route" && e.target === component.id,
        );
        const route =
          registration &&
          graph.components.find(
            (c) => c.id === registration.source && c.role === "route",
          );
        if (route)
          name =
            route.name +
            " " +
            (component.role === "middleware" ? "middleware" : "handler");
        const label = { original: component.name, name };
        byId.set(component.id, label);
        byReference.set(component.referenceId, label);
      }
      const result = { byId, byReference };
      snapshots.set(snapshotId, result);
      return result;
    }
    function walk(value, inherited) {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value))
        return value.map((item) => walk(item, inherited));
      const snapshotId =
        value.snapshotId || value.identity?.snapshotId || inherited;
      const output = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          walk(item, snapshotId),
        ]),
      );
      const fields = ["name", "title", "label"];
      if (
        !fields.some(
          (key) =>
            typeof value[key] === "string" &&
            /\banonymous:\d+\b/.test(value[key]),
        )
      )
        return output;
      const map = labels(snapshotId);
      if (!map) return output;
      const rootId =
        typeof value.id === "string"
          ? /^repo-[a-f0-9]{24}-(c\d+)$/.exec(value.id)?.[1]
          : null;
      const label =
        map.byReference.get(value.referenceId || value.sourceRefId) ||
        map.byId.get(value.componentId || value.key || rootId || value.id) ||
        (Array.isArray(value.path)
          ? map.byId.get(value.path.at(-1))
          : undefined);
      if (!label) return output;
      for (const key of fields)
        if (typeof value[key] === "string")
          output[key] = value[key].replace(legacy, (token) =>
            token === label.original ? label.name : token,
          );
      if (Array.isArray(value.tags))
        output.tags = value.tags.map((tag) =>
          tag === label.original ? label.name : tag,
        );
      return output;
    }
    return walk(body);
  };
}
export function componentNamesMiddleware(database) {
  const present = componentNamePresentation(database);
  return (req, res, next) => {
    // IDE saved exports carry exact context/digest contracts. Preserve canonical archived payloads.
    const preserve = /^\/ide\/(handoffs|checkpoints)(\/|$)/.test(
      req.path || "",
    );
    const json = res.json;
    res.json = function (body) {
      return json.call(this, preserve ? body : present(body));
    };
    next();
  };
}
