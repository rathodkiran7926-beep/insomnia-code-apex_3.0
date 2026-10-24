import { ApiError } from "./api-client/client";
import {
	BindingStore,
	compareRepository,
	type LocalGitContext,
	type RepositoryBinding,
	type SnapshotMetadata,
} from "./repository";

export interface FolderContext {
	uri: string;
	name: string;
}
interface SnapshotClient {
	readonly backendIdentity: string;
	snapshot(id: string, signal?: AbortSignal): Promise<SnapshotMetadata>;
}
interface Environment {
	folders(): readonly FolderContext[];
	trusted(): boolean;
	git(workspaceUri: string): LocalGitContext;
}
type RepositoryStatus =
	| "none"
	| "connecting"
	| "ready"
	| "saved"
	| "other-backend"
	| "invalid"
	| "untrusted"
	| "missing"
	| "unavailable"
	| "error";
interface Session {
	status: RepositoryStatus;
	binding?: RepositoryBinding;
	message?: string;
}
type Confirmation = (
	snapshot: SnapshotMetadata,
	local: LocalGitContext,
	comparison: ReturnType<typeof compareRepository>,
) => Promise<boolean>;

/** Manages IDE bindings only. Snapshot storage and all analysis remain on the server. */
export class RepositoryController {
	private readonly sessions = new Map<string, Session>();
	private readonly requests = new Map<string, AbortController>();
	private readonly writes = new Map<string, Promise<void>>();
	private readonly disconnecting = new Set<string>();
	private readonly generations = new Map<string, number>();
	private restoreGeneration = 0;
	private readonly listeners = new Set<() => void>();
	private disposed = false;
	constructor(
		private readonly api: SnapshotClient,
		private readonly store: BindingStore,
		private readonly env: Environment,
	) {}

	onChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}
	notifyLocalChange(): void {
		if (!this.disposed) for (const listener of this.listeners) listener();
	}

	private saved(folder: FolderContext): Session {
		if (this.disconnecting.has(folder.uri)) return { status: "none" };
		if (!this.env.trusted())
			return {
				status: "untrusted",
				message:
					"Trust this workspace to connect or restore repository context.",
			};
		try {
			const saved = this.store.read(folder.uri, this.api.backendIdentity);
			return saved.status === "saved"
				? {
						status: "saved",
						binding: saved.binding,
						message: "Saved binding has not been revalidated.",
					}
				: { status: saved.status };
		} catch {
			return {
				status: "error",
				message: "Invalid backend configuration. Open settings to correct it.",
			};
		}
	}

	context(folder: FolderContext) {
		const saved = this.saved(folder);
		const session =
			saved.status === "saved" || saved.status === "none"
				? (this.sessions.get(folder.uri) ?? saved)
				: saved;
		const local = this.env.trusted() ? this.env.git(folder.uri) : {};
		return {
			...session,
			local,
			comparison: session.binding
				? compareRepository(local, session.binding)
				: undefined,
		};
	}

	bindingFor(workspaceUri: string): RepositoryBinding | undefined {
		const folder = this.env.folders().find((item) => item.uri === workspaceUri);
		if (!folder) return;
		const state = this.context(folder);
		// Historical saved metadata may be displayed offline, but is not actionable
		// evidence until revalidated against this backend and local repository.
		return state.status === "ready" && state.comparison?.identity !== "mismatch"
			? state.binding
			: undefined;
	}

	synchronize(): void {
		this.restoreGeneration++;
		for (const uri of this.generations.keys()) this.nextGeneration(uri);
		for (const controller of this.requests.values()) controller.abort();
		this.requests.clear();
		this.sessions.clear();
		for (const folder of this.env.folders())
			this.sessions.set(folder.uri, this.saved(folder));
		this.notifyLocalChange();
	}
	async restore(): Promise<void> {
		if (this.disposed) return;
		const generation = ++this.restoreGeneration;
		await this.awaitWrites();
		if (this.disposed || generation !== this.restoreGeneration) return;
		this.synchronize();
		await Promise.all(this.env.folders().map((folder) => this.refresh(folder)));
	}

	private nextGeneration(uri: string): number {
		const next = (this.generations.get(uri) ?? 0) + 1;
		this.generations.set(uri, next);
		return next;
	}
	private async awaitWrites(uri?: string): Promise<void> {
		// Read persistence only after confirmed saves settle. Disconnects hide their
		// binding immediately and must not block unrelated folders' restoration.
		while (true) {
			const pending = [...this.writes]
				.filter(
					([key]) => (!uri || key === uri) && !this.disconnecting.has(key),
				)
				.map(([, promise]) => promise);
			if (pending.length === 0) return;
			await Promise.allSettled(pending);
		}
	}

	private start(folder: FolderContext): AbortController {
		this.requests.get(folder.uri)?.abort();
		const controller = new AbortController();
		this.requests.set(folder.uri, controller);
		return controller;
	}
	private current(
		folder: FolderContext,
		controller: AbortController,
		backend: string,
	): boolean {
		if (
			this.disposed ||
			controller.signal.aborted ||
			!this.env.trusted() ||
			!this.env.folders().some((item) => item.uri === folder.uri)
		)
			return false;
		try {
			return this.api.backendIdentity === backend;
		} catch {
			return false;
		}
	}
	private publish(folder: FolderContext, session: Session): void {
		if (this.disposed) return;
		this.sessions.set(folder.uri, session);
		this.notifyLocalChange();
	}
	private async write(
		uri: string,
		operation: () => Promise<void>,
	): Promise<void> {
		const previous = this.writes.get(uri) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(operation);
		this.writes.set(uri, next);
		try {
			await next;
		} finally {
			if (this.writes.get(uri) === next) this.writes.delete(uri);
		}
	}

	async connect(
		folder: FolderContext,
		snapshotId: string,
		confirm: Confirmation,
	): Promise<boolean> {
		if (!this.env.trusted())
			throw new Error("Trust this workspace before connecting a repository.");
		if (
			this.disposed ||
			!this.env.folders().some((item) => item.uri === folder.uri)
		)
			return false;
		this.restoreGeneration++;
		this.nextGeneration(folder.uri);
		const backend = this.api.backendIdentity;
		const controller = this.start(folder);
		const { status, binding: oldBinding, message } = this.context(folder);
		const previous: Session = { status, binding: oldBinding, message };
		this.publish(folder, {
			...previous,
			status: "connecting",
			message: "Fetching snapshot metadata…",
		});
		try {
			const snapshot = await this.api.snapshot(snapshotId, controller.signal);
			if (!this.current(folder, controller, backend)) return false;
			const local = this.env.git(folder.uri);
			const comparison = compareRepository(local, snapshot);
			if (comparison.identity === "mismatch")
				throw new Error(
					"This snapshot belongs to a different repository. Choose a snapshot for the selected local repository.",
				);
			if (!(await confirm(snapshot, local, comparison))) {
				if (this.current(folder, controller, backend))
					this.publish(folder, previous);
				return false;
			}
			const now = this.env.git(folder.uri);
			if (
				!this.current(folder, controller, backend) ||
				local.identity !== now.identity ||
				local.head !== now.head ||
				local.rootUri !== now.rootUri ||
				local.branch !== now.branch
			) {
				throw new Error(
					"Workspace, backend or Git context changed during confirmation. Retry the connection.",
				);
			}
			const binding: RepositoryBinding = {
				version: 1,
				workspaceUri: folder.uri,
				backendUrl: backend,
				snapshotId: snapshot.snapshotId,
				repositoryIdentity: snapshot.repositoryIdentity,
				indexedCommit: snapshot.indexedCommit,
				connectedAt: new Date().toISOString(),
			};
			await this.write(folder.uri, async () => {
				if (this.current(folder, controller, backend))
					await this.store.save(binding);
			});
			if (!this.current(folder, controller, backend)) return false;
			this.publish(folder, { status: "ready", binding });
			return true;
		} catch (error) {
			if (!controller.signal.aborted)
				this.publish(folder, {
					...previous,
					message:
						error instanceof Error
							? error.message
							: "Repository connection failed.",
				});
			if (!controller.signal.aborted) throw error;
			return false;
		} finally {
			if (this.requests.get(folder.uri) === controller)
				this.requests.delete(folder.uri);
		}
	}

	async refresh(folder: FolderContext): Promise<void> {
		if (this.disposed) return;
		const generation = this.nextGeneration(folder.uri);
		await this.awaitWrites(folder.uri);
		if (
			this.disposed ||
			generation !== this.generations.get(folder.uri) ||
			!this.env.folders().some((item) => item.uri === folder.uri)
		)
			return;
		const saved = this.saved(folder);
		if (!saved.binding) {
			this.publish(folder, saved);
			return;
		}
		const backend = this.api.backendIdentity;
		const controller = this.start(folder);
		this.publish(folder, {
			...saved,
			status: "connecting",
			message: "Revalidating saved snapshot…",
		});
		try {
			const snapshot = await this.api.snapshot(
				saved.binding.snapshotId,
				controller.signal,
			);
			if (!this.current(folder, controller, backend)) return;
			if (
				snapshot.repositoryIdentity !== saved.binding.repositoryIdentity ||
				snapshot.indexedCommit !== saved.binding.indexedCommit
			) {
				throw new ApiError(
					"response",
					"Saved snapshot identity changed on the backend. Reconnect explicitly.",
				);
			}
			this.publish(folder, { status: "ready", binding: saved.binding });
		} catch (error) {
			if (!this.current(folder, controller, backend)) return;
			const status =
				error instanceof ApiError && error.status === 404
					? "missing"
					: error instanceof ApiError &&
						  ["network", "timeout"].includes(error.kind)
						? "unavailable"
						: "error";
			this.publish(folder, {
				...saved,
				status,
				message:
					error instanceof Error
						? error.message
						: "Snapshot validation failed.",
			});
		} finally {
			if (this.requests.get(folder.uri) === controller)
				this.requests.delete(folder.uri);
		}
	}

	async disconnect(folder: FolderContext): Promise<void> {
		this.restoreGeneration++;
		this.nextGeneration(folder.uri);
		this.requests.get(folder.uri)?.abort();
		this.requests.delete(folder.uri);
		this.disconnecting.add(folder.uri);
		this.publish(folder, { status: "none" });
		try {
			await this.write(folder.uri, () => this.store.remove(folder.uri));
		} finally {
			this.disconnecting.delete(folder.uri);
			this.notifyLocalChange();
		}
	}
	dispose(): void {
		this.disposed = true;
		for (const controller of this.requests.values()) controller.abort();
		this.requests.clear();
		this.sessions.clear();
		this.listeners.clear();
	}
}
