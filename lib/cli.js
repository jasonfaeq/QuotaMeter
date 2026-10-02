import { readFileSync } from "node:fs";
import { sanitize } from "./tui/width.js";

const PROVIDER_IDS = ["codex", "claude", "antigravity"];
const BOOLEAN_FLAGS = new Map([
	["--json", "json"], ["--compact", "compact"], ["-c", "compact"],
	["--once", "once"], ["--show-email", "showEmail"], ["--no-color", "noColor"],
	["--version", "version"], ["-v", "version"], ["--help", "help"], ["-h", "help"],
	["-w", "watch"],
]);

function cliError(message, exitCode = 1) {
	return Object.assign(new Error(message), { exitCode });
}

/** Where to switch accounts before signing in again, per provider. */
const SIGN_IN_SITES = Object.freeze({ codex: "chatgpt.com", claude: "claude.ai", antigravity: "your Google account chooser" });

/** Stable account identity of a stored login row, when the provider supplied one. */
function rowIdentity(row) {
	const id = row?.accountUuid ?? row?.accountId ?? row?.email;
	return typeof id === "string" && id ? id.toLowerCase() : null;
}

/** Parse the command surface without reading credentials or touching a terminal. */
export function parseArgs(args) {
	const options = { interval: 30 };
	const positional = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--interval" || arg.startsWith("--interval=")) {
			const value = arg === "--interval" ? args[++index] : arg.slice(11);
			const interval = Number(value);
			if (!value || !Number.isFinite(interval) || interval < 15) {
				throw cliError("--interval must be a number of seconds, at least 15.");
			}
			options.interval = interval;
		} else if (BOOLEAN_FLAGS.has(arg)) {
			options[BOOLEAN_FLAGS.get(arg)] = true;
		} else if (arg.startsWith("-")) {
			throw cliError(`Unknown option: ${arg}`);
		} else {
			positional.push(arg);
		}
	}
	const provider = PROVIDER_IDS.includes(positional[0]) ? positional.shift() : null;
	let command = positional.shift() ?? "quota";
	if (options.watch) {
		if (!["quota", "tui", "watch"].includes(command)) positional.unshift(command);
		command = "watch";
	} else if (command === "tui") command = "watch";
	if (!provider && !["quota", "watch", "accounts", "sources"].includes(command)) {
		throw cliError(`Unknown command: ${command}`);
	}
	if (provider && ![
		"quota", "watch", "accounts", "sources", "add", "reauth", "rename", "remove",
	].includes(command)) {
		positional.unshift(command);
		command = "quota";
	}
	const count = positional.length;
	if (!options.help && !options.version) {
		const maximum = command === "rename" ? 2 : ["accounts", "sources"].includes(command) ? 0 : 1;
		const minimum = command === "rename" ? 2 : ["reauth", "remove"].includes(command) ? 1 : 0;
		if (count < minimum || count > maximum) {
			throw cliError(`Invalid arguments for ${provider ? `${provider} ` : ""}${command}. See --help.`);
		}
	}
	return { provider, command, args: positional, options };
}

/** Compact, shared command help for all providers. */
export function helpText(provider = null) {
	const prefix = provider ? `qm ${provider}` : "qm <provider>";
	return [
		"QuotaMeter — multi-account quota monitor",
		"",
		"qm                         Show quota once",
		"qm watch                   Live quota view (aliases: tui, -w)",
		"qm quota [label]           Filter by account label",
		"qm accounts                List managed accounts",
		"qm sources                 List physical credential sources",
		`${prefix} [quota] [label]`,
		`${prefix} add [label]`,
		`${prefix} reauth <label>`,
		`${prefix} rename <old> <new>`,
		`${prefix} remove <label>`,
		"",
		"Providers: codex, claude, antigravity",
		"Options: --json --compact --once --show-email --no-color",
		"         --interval <seconds> (default 30, minimum 15) --version --help",
	].join("\n");
}

/** Read package metadata relative to the installed module. */
export function packageVersion() {
	return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
}

/** Execute the parsed command; dependencies may be injected for offline tests. */
export async function runCli(argv = process.argv.slice(2), deps = {}) {
	const parsed = parseArgs(argv);
	const { provider, command, args, options } = parsed;
	const output = deps.output ?? process.stdout;
	const errorOutput = deps.errorOutput ?? process.stderr;
	const write = value => output.write(`${value}\n`);
	if (options.version) { write(packageVersion()); return; }
	if (options.help) { write(helpText(provider)); return; }
	const registry = deps.providers ?? (await import("./providers/index.js")).providers;
	const selected = provider ? registry.filter(item => item.id === provider) : registry;
	if (provider && selected.length === 0) throw cliError(`Unknown provider: ${provider}`);
	const snapshots = deps.snapshots ?? await import("./snapshot.js");
	if (command === "sources") {
		const sources = (await Promise.all(selected.map(item => item.discoverSources()))).flat();
		const cleanSourceText = value => {
			const text = sanitize(typeof value === "string" ? value : "");
			return options.showEmail ? text : text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
				email => snapshots.maskEmail(email) ?? "[redacted]");
		};
		const records = sources.map(source => {
			let location = source.location;
			if (source.kind === "remote") {
				try {
					const url = new URL(location);
					url.username = ""; url.password = ""; url.search = ""; url.hash = "";
					location = url.toString();
				} catch { location = "remote"; }
			}
			return { provider: cleanSourceText(source.provider), label: cleanSourceText(source.label),
				kind: ["managed", "env", "harness", "remote"].includes(source.kind) ? source.kind : "harness",
				location: cleanSourceText(location),
				identityKey: source.identityKey == null ? null : cleanSourceText(source.identityKey),
				writable: Boolean(source.writable) };
		});
		if (options.json) write(JSON.stringify(records, null, 2));
		else for (const source of records) write(`${source.provider}\t${source.label}\t${source.kind}\t${source.writable ? "writable" : "read-only"}\t${source.location}`);
		return;
	}
	if (["accounts", "add", "reauth", "rename", "remove"].includes(command)) {
		const store = deps.store ?? await import("./credential-store.js");
		if (command === "accounts") {
			const seen = new Set();
			const records = selected.flatMap(item => store.listManagedAccounts(item.id).flatMap(row => {
				const identity = `${item.id}:${row.raw.accountId ?? row.raw.email ?? row.label}`;
				if (seen.has(identity)) return [];
				seen.add(identity);
				return [{ provider: item.id, label: snapshots.redactPublicText(row.label),
					email: options.showEmail && snapshots.maskEmail(row.raw.email)
						? snapshots.sanitizeText(row.raw.email, 254) : snapshots.maskEmail(row.raw.email),
					enrollment: row.enrollment, readOnly: row.readOnly }];
			}));
			if (options.json) write(JSON.stringify(records, null, 2));
			else if (!records.length) write("No managed accounts. Use qm <provider> add.");
			else for (const account of records) write(`${account.provider}\t${account.label}\t${account.readOnly ? "reauth required" : "managed"}`);
			return;
		}
		let label = args[0];
		if (command === "add" && !label) {
			if (!process.stdin.isTTY && !deps.promptInput) throw cliError("Provide an account label: qm <provider> add <label>.");
			const prompt = deps.promptInput ?? (await import("./prompts.js")).promptInput;
			label = await prompt("Account label: ");
		}
		if (!label?.trim() || /[\x00-\x1f\x7f]/.test(label)) throw cliError("Provide a non-empty account label without control characters.");
		if (command === "rename") {
			if (!args[1]?.trim() || /[\x00-\x1f\x7f]/.test(args[1])) throw cliError("Provide a valid new label.");
			store.renameManagedAccount(provider, label, args[1]);
		} else if (command === "remove") {
			if (!store.removeManagedAccount(provider, label).removed) throw cliError(`Account '${label}' not found.`);
		}
		else {
			const existing = store.findManagedAccount(provider, label);
			if (command === "add" && existing) throw cliError(`Account '${label}' already exists. Use reauth.`);
			if (command === "reauth" && !existing) throw cliError(`Account '${label}' not found.`);
			const credential = await selected[0].login({ label });
			const identity = rowIdentity(credential);
			const duplicate = identity && store.listManagedAccounts(provider)
				.find(row => row.label !== label && rowIdentity(row.raw) === identity);
			if (duplicate) {
				const who = snapshots.maskEmail(credential.email);
				throw cliError(`That sign-in is the same ${provider} account as '${duplicate.label}'${who ? ` (${who})` : ""}. `
					+ `Switch accounts in ${SIGN_IN_SITES[provider] ?? "your browser"}, then run ${command} again.`);
			}
			if (command === "add") store.addManagedAccount(provider, { ...credential, label });
			else store.replaceManagedAccount(provider, label, credential);
		}
		const result = { provider, command, label: command === "rename" ? args[1] : label };
		write(options.json ? JSON.stringify(result) : `${provider}: ${command} ${result.label}`);
		return;
	}
	const load = deps.loadSnapshot ?? (await import("./quota.js")).loadSnapshot;
	const color = !options.noColor && process.env.NO_COLOR === undefined && Boolean(output.isTTY);
	if (command === "watch" && !options.once && !options.json && !options.compact) {
		const watch = deps.runWatch ?? (await import("./tui/app.js")).runWatch;
		if (await watch({ providers: selected, loadSnapshot: load, labelFilter: args[0],
			interval: options.interval, showEmail: options.showEmail, color })) return;
		errorOutput.write("Watch needs an interactive terminal; showing quota once.\n");
	}
	const snapshot = await load({ providers: selected, labelFilter: args[0] });
	const display = snapshots.toDisplaySnapshot(snapshot, { showEmail: options.showEmail });
	if (options.json) { write(JSON.stringify(display, null, 2)); return; }
	const render = deps.render ?? await import("./tui/render.js");
	const lines = options.compact ? render.renderCompact(display, { showEmail: options.showEmail, timeZone: render.localTimeZone() })
		: render.renderStatic(display, { cols: output.columns ?? 80, color, showEmail: options.showEmail, timeZone: render.localTimeZone() });
	write(lines.join("\n"));
}
