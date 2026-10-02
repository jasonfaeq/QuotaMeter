import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import { createTerminal, keyAction } from "../lib/tui/terminal.js";

function fixture(options = {}) {
	const input = new EventEmitter();
	Object.assign(input, { isTTY: true, isRaw: false, paused: true,
		setRawMode(raw) { this.isRaw = raw; }, isPaused() { return this.paused; },
		pause() { this.paused = true; }, resume() { this.paused = false; } });
	const output = new EventEmitter();
	Object.assign(output, { isTTY: true, columns: 80, rows: 24, text: "",
		write(text) { this.text += text; } });
	const proc = new EventEmitter();
	return { input, output, proc,
		terminal: createTerminal({ input, output, proc, keypress() {}, ...options }) };
}

describe("terminal lifecycle", () => {
	test("restores original raw and paused states, once", () => {
		const { terminal, input, output, proc } = fixture();
		expect(terminal.start()).toBe(true);
		expect(input.isRaw).toBe(true);
		expect(input.paused).toBe(false);
		terminal.stop();
		const restored = output.text;
		terminal.stop();
		expect(input.isRaw).toBe(false);
		expect(input.paused).toBe(true);
		expect(output.text).toBe(restored);
		expect(output.text).toContain("\x1b[?25h\x1b[?1049l");
		expect(proc.eventNames()).toEqual([]);
	});
	test.each(["exit", "SIGINT", "SIGTERM", "uncaughtExceptionMonitor"])(
		"restores on %s", event => {
			const { terminal, input, proc } = fixture();
			terminal.start(); proc.emit(event);
			expect(input.isRaw).toBe(false);
			expect(terminal.active).toBe(false);
		},
	);
	test("refuses redirected stdin or stdout without writing control sequences", () => {
		for (const target of ["input", "output"]) {
			const f = fixture(); f[target].isTTY = false;
			expect(f.terminal.start()).toBe(false);
			expect(f.output.text).toBe("");
		}
	});
	test("dispatches keys and resize and removes listeners on stop", () => {
		const actions = []; let resized = 0;
		const { terminal, input, output } = fixture({ onAction: a => actions.push(a),
			onResize: () => resized++ });
		terminal.start(); input.emit("keypress", "r", {}); output.emit("resize");
		expect(actions).toEqual(["refresh"]); expect(resized).toBe(1);
		terminal.stop(); input.emit("keypress", "r", {}); output.emit("resize");
		expect(actions).toEqual(["refresh"]); expect(resized).toBe(1);
	});
	test("key mapping includes explicit all-provider selection", () => {
		expect(keyAction("1")).toBe("all");
		expect(keyAction("4")).toBe("antigravity");
		expect(keyAction("5")).toBe(null);
		expect(keyAction("", { ctrl: true, name: "c" })).toBe("quit");
		expect(keyAction("", { name: "pagedown" })).toBe("pageDown");
	});
	test("pauses initially dormant stdin even when isPaused reports false", () => {
		const { terminal, input } = fixture();
		input.readableFlowing = null;
		input.paused = false;
		terminal.start(); terminal.stop();
		expect(input.paused).toBe(true);
	});
	test("preserves an already-flowing input stream", () => {
		const { terminal, input } = fixture();
		input.readableFlowing = true;
		input.paused = false;
		terminal.start(); terminal.stop();
		expect(input.paused).toBe(false);
	});
	test("clears only for the first frame, then repaints changed rows in place", () => {
		const { terminal, output } = fixture();
		terminal.start();
		terminal.write(["one", "two"]);
		expect(output.text).toContain("\x1b[?2026h\x1b[H\x1b[2J\x1b[1;1Hone\x1b[2;1Htwo\x1b[?2026l");
		output.text = "";
		terminal.write(["one", "TWO"]);
		expect(output.text).toBe("\x1b[?2026h\x1b[2;1HTWO\x1b[0m\x1b[K\x1b[?2026l");
		expect(output.text).not.toContain("\x1b[2J");
		output.text = "";
		terminal.write(["one", "TWO"]);
		expect(output.text).toBe("");
		terminal.stop();
	});
	test("erases the tail of rows that shrink or disappear", () => {
		const { terminal, output } = fixture();
		terminal.start();
		terminal.write(["longer line", "gone"]);
		output.text = "";
		terminal.write(["short"]);
		expect(output.text).toContain("\x1b[1;1Hshort\x1b[0m\x1b[K");
		expect(output.text).toContain("\x1b[2;1H\x1b[0m\x1b[K");
		terminal.stop();
	});
	test("never erases after a full-width final cell", () => {
		const { terminal, output } = fixture();
		terminal.start();
		terminal.write(["x".repeat(80)]);
		terminal.write(["y".repeat(80)]);
		// Only the synchronized-update terminator follows each final cell.
		expect(output.text).toContain(`${"x".repeat(80)}\x1b[?2026l`);
		expect(output.text.endsWith(`\x1b[1;1H${"y".repeat(80)}\x1b[?2026l`)).toBe(true);
		terminal.stop();
	});
	test("fully clears again after a resize or restart", () => {
		const { terminal, output } = fixture();
		terminal.start();
		terminal.write(["a"]);
		output.columns = 100;
		output.text = "";
		terminal.write(["a"]);
		expect(output.text).toContain("\x1b[H\x1b[2J");
		terminal.stop(); terminal.start();
		output.text = "";
		terminal.write(["a"]);
		expect(output.text).toContain("\x1b[H\x1b[2J");
		terminal.stop();
	});
});
