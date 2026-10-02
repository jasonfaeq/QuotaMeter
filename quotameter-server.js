#!/usr/bin/env node

/**
 * quotameter PWA server entry point.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./lib/env.js";
import {
	DEFAULT_QUOTAMETER_HOST,
	DEFAULT_QUOTAMETER_PORT,
	buildAllowedHosts,
	createQuotaMeterServer,
} from "./lib/server.js";

loadEnvFile();

export * from "./lib/server.js";

/**
 * @param {unknown} value
 * @returns {number}
 */
export function parseQuotaMeterPort(value) {
	if (value === undefined || value === null || value === "") return DEFAULT_QUOTAMETER_PORT;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("QUOTAMETER_PORT must be an integer from 1 to 65535");
	}
	return port;
}

/**
 * Start the quotameter HTTP server from environment configuration.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {Promise<import("node:http").Server>}
 */
export async function main(env = process.env) {
	const host = env.QUOTAMETER_HOST?.trim() || DEFAULT_QUOTAMETER_HOST;
	const port = parseQuotaMeterPort(env.QUOTAMETER_PORT);
	const allowedHosts = buildAllowedHosts(env.QUOTAMETER_ALLOWED_HOSTS, host);
	const server = createQuotaMeterServer({ host, allowedHosts });

	await new Promise((resolvePromise, rejectPromise) => {
		const onError = error => {
			server.off("listening", onListening);
			rejectPromise(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolvePromise();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});

	console.log(`quotameter listening on http://${host}:${port}`);

	let closing = false;
	const close = signal => {
		if (closing) return;
		closing = true;
		server.close(error => {
			if (error) {
				console.error("quotameter failed to stop cleanly");
				process.exitCode = 1;
			} else if (signal) {
				process.exitCode = 0;
			}
		});
	};
	process.once("SIGINT", () => close("SIGINT"));
	process.once("SIGTERM", () => close("SIGTERM"));
	return server;
}

let isMain = false;
try {
	isMain = process.argv[1]
		? realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
		: false;
} catch {
	isMain = false;
}

if (isMain) {
	main().catch(() => {
		console.error("quotameter failed to start");
		process.exitCode = 1;
	});
}
