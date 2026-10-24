export interface EditorSelection {
	start: { line: number; character: number };
	end: { line: number; character: number };
}
/** VS Code's end is exclusive; backend source ranges are inclusive and 1-based. */
export function backendLineRange(selection: EditorSelection): {
	startLine: number;
	endLine: number;
} {
	return {
		startLine: selection.start.line + 1,
		endLine:
			selection.end.line > selection.start.line && selection.end.character === 0
				? selection.end.line
				: selection.end.line + 1,
	};
}
