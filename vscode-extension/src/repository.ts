/** Public GitHub identity only. Raw remotes may contain credentials and never escape this boundary. */
export function normalizeGithubRemote(value: string): string | undefined {
	const text = value.trim();
	let match = /^git@github\.com:([\w.-]+)\/([\w.-]+?)\/?$/i.exec(text);
	if (!match)
		match =
			/^(?:https:\/\/(?:[^/?#@]+@)?|ssh:\/\/(?:git@)?)github\.com\/([\w.-]+)\/([\w.-]+?)\/?$/i.exec(
				text,
			);
	if (!match) return;
	const owner = match[1];
	const name = match[2]?.replace(/\.git$/i, "");
	if (
		!owner ||
		!name ||
		[owner, name].some((part) => part === "." || part === "..")
	)
		return;
	return `https://github.com/${owner.toLowerCase()}/${name.toLowerCase()}`;
}
export const validCommit = (value: unknown): value is string =>
	typeof value === "string" && /^[a-f\d]{40}$/i.test(value);
export const validSnapshotId = (value: unknown): value is string =>
	typeof value === "string" && /^[\w-]{1,150}$/.test(value);
export interface SnapshotMetadata {
	snapshotId: string;
	repositoryIdentity: string;
	indexedCommit: string;
	limitations: string[];
}
const record = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** Validate consumed fields, then discard graph, excerpts and generated content. */
export function validateSnapshot(
	value: unknown,
	expectedId: string,
): SnapshotMetadata {
	if (
		!record(value) ||
		value.snapshotId !== expectedId ||
		!validCommit(value.commit) ||
		typeof value.repository !== "string" ||
		!Array.isArray(value.components) ||
		!Array.isArray(value.references) ||
		!Array.isArray(value.relationships) ||
		!record(value.report) ||
		!Array.isArray(value.report.limitations) ||
		!value.report.limitations.every((item) => typeof item === "string") ||
		!record(value.documentation) ||
		value.documentation.snapshotId !== expectedId
	) {
		throw new Error(
			"Backend returned malformed or inconsistent snapshot metadata.",
		);
	}
	const identity = normalizeGithubRemote(value.repository);
	if (!identity)
		throw new Error(
			"Snapshot repository is not a supported GitHub repository identity.",
		);
	return {
		snapshotId: expectedId,
		repositoryIdentity: identity,
		indexedCommit: value.commit.toLowerCase(),
		limitations: value.report.limitations
			.slice(0, 30)
			.map((item) => String(item).slice(0, 500)),
	};
}
export interface LocalGitContext {
	rootUri?: string;
	identity?: string;
	branch?: string;
	head?: string;
	dirty?: boolean;
}
export function compareRepository(
	local: LocalGitContext,
	snapshot: Pick<SnapshotMetadata, "repositoryIdentity" | "indexedCommit">,
) {
	const identity = !local.identity
		? "unverified"
		: local.identity === snapshot.repositoryIdentity
			? "matched"
			: "mismatch";
	const revision =
		identity !== "matched" || !validCommit(local.head)
			? "unknown"
			: local.head.toLowerCase() === snapshot.indexedCommit.toLowerCase()
				? "matched"
				: "different";
	return { identity, revision, localChanges: local.dirty === true } as const;
}
export interface RepositoryBinding extends Omit<
	SnapshotMetadata,
	"limitations"
> {
	version: 1;
	workspaceUri: string;
	backendUrl: string;
	connectedAt: string;
}
interface BindingStorage {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): Thenable<void> | Promise<void>;
}
type SavedBinding =
	| { status: "saved"; binding: RepositoryBinding }
	| { status: "none" | "invalid" | "other-backend" };
export class BindingStore {
	constructor(private readonly storage: BindingStorage) {}
	key(workspaceUri: string): string {
		return `mentor.binding.v1:${workspaceUri}`;
	}
	read(workspaceUri: string, backendUrl: string): SavedBinding {
		const data = this.storage.get<unknown>(this.key(workspaceUri));
		if (data === undefined) return { status: "none" };
		if (
			!record(data) ||
			data.version !== 1 ||
			data.workspaceUri !== workspaceUri ||
			!validSnapshotId(data.snapshotId) ||
			!validCommit(data.indexedCommit) ||
			typeof data.backendUrl !== "string" ||
			typeof data.repositoryIdentity !== "string" ||
			normalizeGithubRemote(data.repositoryIdentity) !==
				data.repositoryIdentity ||
			typeof data.connectedAt !== "string" ||
			!Number.isFinite(Date.parse(data.connectedAt))
		)
			return { status: "invalid" };
		if (data.backendUrl !== backendUrl) return { status: "other-backend" };
		return { status: "saved", binding: data as unknown as RepositoryBinding };
	}
	async save(binding: RepositoryBinding): Promise<void> {
		await this.storage.update(this.key(binding.workspaceUri), binding);
	}
	async remove(workspaceUri: string): Promise<void> {
		await this.storage.update(this.key(workspaceUri), undefined);
	}
}
