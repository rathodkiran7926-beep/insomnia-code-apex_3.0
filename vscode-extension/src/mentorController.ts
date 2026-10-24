import { ApiError, type MentorApi } from "./api-client/client";
import type {
	Candidate,
	Component,
	MentorAnswer,
	SnapshotEvidence,
	SourceReference,
} from "./api-client/mentorContracts";
import type { RepositoryBinding, SnapshotMetadata } from "./repository";
import type { EditorContext } from "./vscode-adapters/editorContext";
import { backendLineRange } from "./selection";

export const initialQuestion =
	"Explain what this component does, its role in the repository, and any important behavior supported by the available evidence.";
export interface MentorResult {
	id: string;
	binding: RepositoryBinding;
	sourceContext: EditorContext;
	snapshot: SnapshotMetadata;
	component: Component;
	answer: MentorAnswer;
	question: string;
	scopeNotice: string;
	indexedOnly: boolean;
}
export interface MentorState {
	status: "idle" | "loading" | "ready" | "empty" | "error" | "cancelled";
	message: string;
	result?: MentorResult;
	canPrevious: boolean;
	canLatest: boolean;
}
interface MentorEnvironment {
	trusted(): boolean;
	editor(): EditorContext | undefined;
	binding(workspaceUri: string): RepositoryBinding | undefined;
	choose(
		candidates: Candidate[],
		evidence: SnapshotEvidence,
	): Promise<Candidate | undefined>;
	verified(
		context: EditorContext,
		evidence: SnapshotEvidence,
		ref: SourceReference,
		signal: AbortSignal,
	): Promise<boolean>;
	acknowledge(): Promise<boolean>;
	sourceVersion?(context: EditorContext): string;
}
type Api = Pick<
	MentorApi,
	"backendIdentity" | "evidence" | "resolveSelection" | "question"
>;
const identity = (binding: RepositoryBinding | undefined) =>
	binding &&
	JSON.stringify([
		binding.backendUrl,
		binding.workspaceUri,
		binding.snapshotId,
		binding.repositoryIdentity,
		binding.indexedCommit,
		binding.connectedAt,
	]);
const selection = (context: EditorContext | undefined) =>
	context &&
	JSON.stringify([
		context.documentUri,
		context.documentVersion,
		context.workspaceUri,
		context.repositoryRootUri,
		context.file,
		context.selection,
		context.hasUnsavedChanges,
		context.revision,
		context.localHead,
		context.fileModified,
		identity(context.binding),
	]);
interface Pending {
	controller: AbortController;
	binding: RepositoryBinding;
	selection: string | undefined;
	context: EditorContext;
	sourceVersion: string | undefined;
}

/** User-driven, stateless component Q&A. No prompts, retrieval or source analysis live here. */
export class MentorController {
	private readonly listeners = new Set<() => void>();
	private readonly history: MentorResult[] = [];
	private index = -1;
	private serial = 0;
	private status: MentorState["status"] = "idle";
	private message =
		"Select code or place the cursor in a function, then choose Explain Selection.";
	private pending?: Pending;
	private disposed = false;
	private retryAction?: () => Promise<void>;
	constructor(
		private readonly api: Api,
		private readonly env: MentorEnvironment,
	) {}

	get state(): MentorState {
		return {
			status: this.status,
			message: this.message,
			result: this.history[this.index],
			canPrevious: this.index > 0,
			canLatest: this.index >= 0 && this.index < this.history.length - 1,
		};
	}
	onChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}
	private publish(status: MentorState["status"], message: string): void {
		if (this.disposed) return;
		this.status = status;
		this.message = message;
		for (const listener of this.listeners) listener();
	}
	private guard(
		binding: RepositoryBinding | undefined,
	): asserts binding is RepositoryBinding {
		if (!this.env.trusted())
			throw new Error("Trust the workspace before asking the Mentor.");
		if (
			!binding ||
			identity(this.env.binding(binding.workspaceUri)) !== identity(binding) ||
			this.api.backendIdentity !== binding.backendUrl
		)
			throw new Error(
				"Connect or refresh a matching repository snapshot before asking the Mentor.",
			);
	}
	private ensure(pending: Pending): void {
		if (
			this.disposed ||
			this.pending !== pending ||
			pending.controller.signal.aborted ||
			selection(this.env.editor()) !== pending.selection ||
			this.env.sourceVersion?.(pending.context) !== pending.sourceVersion
		)
			throw new ApiError(
				"cancelled",
				"Editor or Git context changed; run the action again for the current selection.",
			);
		this.guard(pending.binding);
	}
	contextChanged(): void {
		if (this.pending) {
			try {
				this.ensure(this.pending);
			} catch {
				this.cancel(
					"Context changed. The previous answer remains pinned to its indexed snapshot.",
				);
			}
		}
		const stale =
			"This previous answer is pinned to a changed or unavailable repository binding. Reconnect it or explain the new selection.";
		const result = this.state.result;
		if (result && !this.pending) {
			try {
				this.guard(result.binding);
				if (this.message === stale)
					this.publish(
						"ready",
						"The pinned component answer is available again.",
					);
			} catch {
				if (this.message !== stale) this.publish("error", stale);
			}
		}
	}
	private async run(
		binding: RepositoryBinding,
		context: EditorContext,
		action: (pending: Pending) => Promise<void>,
	): Promise<void> {
		this.pending?.controller.abort();
		const pending = {
			controller: new AbortController(),
			binding,
			selection: selection(this.env.editor()),
			context,
			sourceVersion: this.env.sourceVersion?.(context),
		};
		this.pending = pending;
		this.publish("loading", "Reading indexed evidence…");
		try {
			await action(pending);
		} catch (error) {
			if (this.pending !== pending || this.disposed) return;
			if (
				pending.controller.signal.aborted ||
				(error instanceof ApiError && error.kind === "cancelled")
			)
				this.publish(
					"cancelled",
					"Request cancelled. Previous results remain available.",
				);
			else
				this.publish(
					"error",
					error instanceof ApiError && error.status === 429
						? "The Mentor is busy (429). Retry when ready."
						: error instanceof Error
							? error.message
							: "Mentor request failed.",
				);
		} finally {
			if (this.pending === pending) this.pending = undefined;
		}
	}
	private checkEvidence(
		evidence: SnapshotEvidence,
		binding: RepositoryBinding,
	): void {
		if (
			evidence.snapshotId !== binding.snapshotId ||
			evidence.repositoryIdentity !== binding.repositoryIdentity ||
			evidence.indexedCommit !== binding.indexedCommit
		)
			throw new Error(
				"Snapshot identity changed. Reconnect the repository explicitly.",
			);
	}

	async explain(context = this.env.editor()): Promise<void> {
		if (this.disposed) return;
		try {
			this.guard(context?.binding);
			if (!context)
				throw new Error(
					"Open a supported source file inside a connected workspace.",
				);
			const binding = context.binding;
			this.retryAction = () => this.explain(this.env.editor() ?? context);
			await this.run(binding, context, async (pending) => {
				const evidence = await this.api.evidence(
					binding.snapshotId,
					pending.controller.signal,
				);
				this.ensure(pending);
				this.checkEvidence(evidence, binding);
				const range = backendLineRange(context.selection);
				const resolved = await this.api.resolveSelection(
					evidence,
					context.file,
					range.startLine,
					range.endLine,
					pending.controller.signal,
				);
				this.ensure(pending);
				if (!resolved.candidates.length) {
					this.publish("empty", resolved.notice);
					return;
				}
				const candidate =
					resolved.candidates.length === 1
						? resolved.candidates[0]
						: await this.env.choose(resolved.candidates, evidence);
				this.ensure(pending);
				if (!candidate) {
					this.publish("cancelled", "Component selection cancelled.");
					return;
				}
				const component = evidence.components.find(
					(item) =>
						item.id === candidate.componentId &&
						item.referenceId === candidate.referenceId,
				);
				if (!component)
					throw new Error(
						"The selected component no longer belongs to this snapshot.",
					);
				await this.answer(
					pending,
					evidence,
					component,
					context,
					initialQuestion,
					resolved.notice,
				);
			});
		} catch (error) {
			this.publish(
				"error",
				error instanceof Error
					? error.message
					: "Cannot explain this selection.",
			);
		}
	}

	private async answer(
		pending: Pending,
		evidence: SnapshotEvidence,
		component: Component,
		context: EditorContext,
		question: string,
		scopeNotice: string,
	): Promise<void> {
		const ref = evidence.references.find(
			(item) => item.id === component.referenceId,
		);
		if (!ref) throw new Error("Indexed component source is unavailable.");
		const verified = await this.env.verified(
			context,
			evidence,
			ref,
			pending.controller.signal,
		);
		this.ensure(pending);
		if (!verified && !(await this.env.acknowledge())) {
			this.publish(
				"cancelled",
				"Indexed-source explanation cancelled. No buffer was uploaded.",
			);
			return;
		}
		this.ensure(pending);
		this.publish(
			"loading",
			"Asking the shared Mentor about the indexed component…",
		);
		const answer = await this.api.question(
			evidence,
			component.id,
			question,
			pending.controller.signal,
		);
		this.ensure(pending);
		const { snapshotId, repositoryIdentity, indexedCommit, limitations } =
			evidence;
		this.history.push({
			id: `answer-${++this.serial}`,
			binding: pending.binding,
			sourceContext: context,
			snapshot: { snapshotId, repositoryIdentity, indexedCommit, limitations },
			component,
			answer,
			question,
			scopeNotice,
			indexedOnly: !verified,
		});
		if (this.history.length > 5) this.history.shift();
		this.index = this.history.length - 1;
		this.publish(
			"ready",
			"Answer grounded in the indexed snapshot. Each follow-up is a new question about the same component.",
		);
	}

	async ask(question: string, expectedAnswerId = this.state.result?.id): Promise<void> {
		const result = this.state.result;
		if (this.disposed) return;
		try {
			if (!result)
				throw new Error("Explain a component before asking a follow-up.");
			if (result.id !== expectedAnswerId)
				throw new Error("The selected answer changed while the question was entered. Ask again for the current component.");
			this.guard(result.binding);
			if (!question.trim() || question.length > 1500)
				throw new Error("Enter a question of 1–1500 characters.");
			this.retryAction = () => this.ask(question);
			await this.run(result.binding, result.sourceContext, async (pending) => {
				const evidence = await this.api.evidence(
					result.binding.snapshotId,
					pending.controller.signal,
				);
				this.ensure(pending);
				this.checkEvidence(evidence, result.binding);
				const component = evidence.components.find(
					(item) =>
						item.id === result.component.id &&
						item.referenceId === result.component.referenceId,
				);
				if (!component)
					throw new Error("The indexed component is no longer available.");
				await this.answer(
					pending,
					evidence,
					component,
					result.sourceContext,
					question.trim(),
					result.scopeNotice,
				);
			});
		} catch (error) {
			this.publish(
				"error",
				error instanceof Error ? error.message : "Follow-up failed.",
			);
		}
	}
	getResult(id: string): MentorResult | undefined {
		return this.history.find((item) => item.id === id);
	}
	selectedContext() {
		const result = this.state.result;
		if (!result) return;
		try {
			this.guard(result.binding);
			return {
				binding: result.binding,
				snapshot: result.snapshot,
				component: result.component,
			};
		} catch {
			return;
		}
	}
	reportError(message: string): void {
		this.publish("error", message);
	}
	previous(): void {
		if (this.index > 0) {
			this.cancel();
			this.retryAction = undefined;
			this.index--;
			this.publish("ready", "Previous component-scoped answer.");
		}
	}
	latest(): void {
		if (this.history.length) {
			this.cancel();
			this.retryAction = undefined;
			this.index = this.history.length - 1;
			this.publish("ready", "Latest component-scoped answer.");
		}
	}
	async retry(): Promise<void> {
		if (!this.disposed) await this.retryAction?.();
	}
	cancel(
		message = "Request cancelled. Previous results remain available.",
	): void {
		this.pending?.controller.abort();
		this.pending = undefined;
		if (!this.disposed) this.publish("cancelled", message);
	}
	dispose(): void {
		this.disposed = true;
		this.pending?.controller.abort();
		this.pending = undefined;
		this.history.length = 0;
		this.listeners.clear();
	}
}
