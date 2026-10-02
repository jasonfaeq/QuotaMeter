import { expect, test } from "bun:test";
import { fetchClaudeOAuthUsage } from "../lib/claude-usage.js";
import { safePublicError } from "../lib/snapshot.js";

test("Claude backs off on Retry-After zero and retries only after cooldown", async () => {
	let clock = 1000;
	let calls = 0;
	const options = { now: () => clock, fetchFn: async () => {
		calls++;
		return calls === 1 ? new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } })
			: Response.json({ five_hour: { utilization: 25 } });
	} };
	const first = await fetchClaudeOAuthUsage("fixture-rate-limit-zero", options);
	expect(first.status).toBe(429);
	expect(safePublicError(first.error)).toBe("Rate limited; retry in 300 seconds");
	clock += 60000;
	expect((await fetchClaudeOAuthUsage("fixture-rate-limit-zero", options)).error).toContain("240 seconds");
	expect(calls).toBe(1);
	clock += 240000;
	expect((await fetchClaudeOAuthUsage("fixture-rate-limit-zero", options)).success).toBe(true);
	expect(calls).toBe(2);
});

test("Claude honors a longer Retry-After without blocking another credential", async () => {
	const now = () => 1000;
	const result = await fetchClaudeOAuthUsage("fixture-long-cooldown", { now,
		fetchFn: async () => new Response(null, { status: 429, headers: { "Retry-After": "900" } }) });
	expect(result.retryAt).toBe(901000);
	expect((await fetchClaudeOAuthUsage("fixture-other-account", { now,
		fetchFn: async () => Response.json({}) })).success).toBe(true);
});
