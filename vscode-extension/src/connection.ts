import { ApiError, type HealthResponse } from "./api-client/client";

export type ConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected"
	| "server-error"
	| "invalid-configuration";
export interface ConnectionState {
	status: ConnectionStatus;
	message: string;
}
interface HealthClient {
	health(signal?: AbortSignal): Promise<HealthResponse>;
}

/** Extension UI state only. No polling, repository state or backend business logic. */
export class Connection {
	state: ConnectionState = {
		status: "disconnected",
		message: "Backend connection has not been checked.",
	};
	private controller?: AbortController;
	private disposed = false;
	private readonly listeners = new Set<(state: ConnectionState) => void>();

	constructor(private readonly api: HealthClient) {}

	onChange(listener: (state: ConnectionState) => void): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}

	async check(): Promise<void> {
		if (this.disposed) return;
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		this.update({ status: "connecting", message: "Checking backend health…" });
		try {
			await this.api.health(controller.signal);
			if (!controller.signal.aborted)
				this.update({
					status: "connected",
					message: "Backend health check succeeded.",
				});
		} catch (error) {
			if (controller.signal.aborted || this.disposed) return;
			const kind = error instanceof ApiError ? error.kind : "network";
			this.update({
				status:
					kind === "configuration"
						? "invalid-configuration"
						: kind === "http" || kind === "response"
							? "server-error"
							: "disconnected",
				message:
					error instanceof Error ? error.message : "Backend connection failed.",
			});
		} finally {
			if (this.controller === controller) this.controller = undefined;
		}
	}

	private update(state: ConnectionState): void {
		if (this.disposed) return;
		this.state = state;
		for (const listener of this.listeners) listener(state);
	}

	dispose(): void {
		this.disposed = true;
		this.controller?.abort();
		this.controller = undefined;
		this.listeners.clear();
	}
}
