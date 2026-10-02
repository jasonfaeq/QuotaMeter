import { emitKeypressEvents } from "node:readline";
import { cellWidth } from "./width.js";

const ENTER = "\x1b[?1049h\x1b[?25l";
const LEAVE = "\x1b[?25h\x1b[?1049l";

/** Translate readline key events into app actions. */
export function keyAction(text, key = {}) {
	if (key.ctrl && key.name === "c") return "quit";
	const byName = { up: "up", down: "down", pageup: "pageUp", pagedown: "pageDown" };
	if (byName[key.name]) return byName[key.name];
	return ({ q: "quit", r: "refresh", e: "email", "?": "help", j: "down", k: "up",
		u: "upnext", "+": "slower", "=": "slower", "-": "faster", "1": "all", "2": "codex",
		"3": "claude", "4": "antigravity" })[text] ?? null;
}

/**
 * Own terminal state for one watch session. Restore before reporting completion.
 * Inject streams/process for tests. Both stdin and stdout must be terminals.
 */
export function createTerminal({
	input = process.stdin, output = process.stdout, proc = process,
	keypress = emitKeypressEvents, onAction = () => {}, onResize = () => {},
	onExit = () => {},
} = {}) {
	let active = false;
	let previousRaw = false;
	let previousPaused = true;
	// Last painted frame, so redraws rewrite only rows that changed.
	let painted = null;
	const onKey = (text, key) => {
		const action = keyAction(text, key);
		if (action) onAction(action);
	};
	const onSignal = signal => {
		stop();
		onExit(signal);
	};
	const onInt = () => onSignal("SIGINT");
	const onTerm = () => onSignal("SIGTERM");
	function stop() {
		if (!active) return;
		active = false;
		painted = null;
		input.removeListener("keypress", onKey);
		output.removeListener("resize", onResize);
		proc.removeListener("exit", stop);
		proc.removeListener("SIGINT", onInt);
		proc.removeListener("SIGTERM", onTerm);
		proc.removeListener("uncaughtExceptionMonitor", stop);
		try { input.setRawMode(previousRaw); }
		finally {
			if (previousPaused) input.pause();
			output.write(LEAVE);
		}
	}
	return {
		get active() { return active; },
		get size() { return { cols: output.columns ?? 80, rows: output.rows ?? 24 }; },
		start() {
			if (active) return true;
			if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return false;
			previousRaw = Boolean(input.isRaw);
			// A fresh TTY has readableFlowing=null but isPaused()===false. Restore
			// that inactive state too, otherwise our resume() keeps Node alive.
			previousPaused = input.readableFlowing !== true;
			active = true;
			proc.on("exit", stop);
			proc.on("SIGINT", onInt);
			proc.on("SIGTERM", onTerm);
			// Monitoring preserves Node's default fatal-error behavior after restoration.
			proc.on("uncaughtExceptionMonitor", stop);
			try {
				keypress(input);
				input.setRawMode(true);
				input.on("keypress", onKey);
				output.on("resize", onResize);
				input.resume();
				output.write(ENTER);
				return true;
			} catch (error) { stop(); throw error; }
		},
		write(lines) {
			if (!active) return;
			const cols = output.columns ?? 80;
			const rows = output.rows ?? 24;
			// Clearing every frame flickers on terminals without synchronized
			// output, so repaint in place and touch only rows that changed. A
			// full clear happens only for the first frame and after a resize.
			const full = !painted || painted.cols !== cols || painted.rows !== rows;
			const before = full ? [] : painted.lines;
			let out = full ? "\x1b[H\x1b[2J" : "";
			for (let row = 0; row < Math.max(lines.length, before.length); row++) {
				const line = lines[row] ?? "";
				if (!full && line === before[row]) continue;
				if (full && !line) continue;
				out += `\x1b[${row + 1};1H${line}`;
				// Never erase after a full-width line: in the wrap-pending state
				// the erase would remove its final cell.
				if (!full && cellWidth(line) < cols) out += "\x1b[0m\x1b[K";
			}
			painted = { cols, rows, lines: [...lines] };
			// Synchronized output (DEC 2026) presents each frame atomically on
			// supporting terminals; others ignore it.
			if (out) output.write(`\x1b[?2026h${out}\x1b[?2026l`);
		},
		stop,
	};
}
