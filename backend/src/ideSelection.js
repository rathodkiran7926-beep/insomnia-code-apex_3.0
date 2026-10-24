import { z } from "zod";

const safePath = (value) =>
	!/^[\/]|[\\:\x00-\x1f\x7f]|%[0-9a-f]{2}/i.test(value) &&
	value
		.split("/")
		.every((segment) => segment && segment !== "." && segment !== "..");
export const selectionRequest = z
	.object({
		snapshotId: z.string().regex(/^[\w-]{1,150}$/),
		file: z.string().min(1).max(1000).refine(safePath),
		startLine: z.number().int().min(1).max(1000000),
		endLine: z.number().int().min(1).max(1000000),
	})
	.strict()
	.refine(
		(body) =>
			body.endLine >= body.startLine && body.endLine - body.startLine <= 10000,
	);

/** Selection matching uses stored evidence only. No parsing, AI or filesystem I/O. */
export function resolveSelection(graph, request) {
	const body = selectionRequest.parse(request);
	if (
		graph.snapshotId !== body.snapshotId ||
		!Array.isArray(graph.components) ||
		!Array.isArray(graph.references)
	) {
		throw Object.assign(new Error("Snapshot has no supported source index"), {
			status: 422,
		});
	}
	const refs = new Map(
		graph.references
			.filter(
				(reference) =>
					reference.snapshotId === graph.snapshotId &&
					reference.file === body.file &&
					typeof reference.id === "string" &&
					Number.isSafeInteger(reference.startLine) &&
					Number.isSafeInteger(reference.endLine) &&
					reference.startLine > 0 &&
					reference.startLine <= body.startLine &&
					reference.endLine >= body.endLine,
			)
			.map((reference) => [reference.id, reference]),
	);
	const containing = graph.components.filter(
		(component) =>
			refs.has(component.referenceId) &&
			typeof component.id === "string" &&
			component.id.length > 0 && component.id.length <= 200 &&
			typeof component.referenceId === "string" && component.referenceId.length <= 200 &&
			typeof component.name === "string" &&
			typeof component.role === "string",
	);
	// An enclosing file is not an additional ambiguity when declaration evidence exists.
	const declarations = containing.filter(
		(component) => component.role !== "module",
	);
	const ranked = (declarations.length ? declarations : containing).sort(
		(a, b) => {
			const left = refs.get(a.referenceId);
			const right = refs.get(b.referenceId);
			return (
				left.endLine - left.startLine - (right.endLine - right.startLine) ||
				left.startLine - right.startLine ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
			);
		},
	);
	const candidates = [
		...new Map(
			ranked.map((component) => [
				component.id,
				{
					componentId: component.id,
					name: component.name.slice(0, 300),
					role: component.role.slice(0, 80),
					referenceId: component.referenceId,
				},
			]),
		).values(),
	].slice(0, 20);
	const scope =
		candidates.length === 0
			? "none"
			: declarations.length
				? "declaration"
				: "module";
	return {
		snapshotId: graph.snapshotId,
		candidates,
		scope,
		notice:
			scope === "module"
				? "No indexed declaration contains the entire selection. Only the enclosing module is available."
				: scope === "none"
					? "No analyzed component contains this source range."
					: "Explains the indexed enclosing component, not an independently analyzed expression.",
	};
}
