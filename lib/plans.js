/**
 * Human-readable plan / tier labels for Codex and Claude web + CLI display.
 * Leaf module — zero internal deps.
 */

/** @type {Record<string, string>} */
const CODEX_PLAN_LABELS = {
	free: "Free",
	plus: "Plus",
	pro: "Pro",
	prolite: "Pro 20x",
	team: "Team",
	enterprise: "Enterprise",
	business: "Business",
};

/** @type {Record<string, string>} */
const CLAUDE_PLAN_LABELS = {
	pro: "Pro",
	claude_pro: "Pro",
	max: "Max",
	claude_max: "Max",
	default_claude_max: "Max",
	default_claude_pro: "Pro",
	default_claude_max_5x: "Max 5x",
	default_claude_max_20x: "Max 20x",
	claude_max_5x: "Max 5x",
	claude_max_20x: "Max 20x",
	max_5x: "Max 5x",
	max_20x: "Max 20x",
};

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nonEmptyString(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/**
 * Title-case a snake/kebab plan slug while preserving Nx multipliers.
 * @param {string} value
 * @returns {string}
 */
export function humanizePlanSlug(value) {
	const raw = nonEmptyString(value);
	if (!raw) return "";
	return raw
		.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, (ch) => ch.toUpperCase())
		.replace(/\b(\d+)X\b/g, "$1x")
		.trim();
}

/**
 * @param {unknown} planType
 * @param {{ planOverride?: unknown }} [options]
 * @returns {string | null}
 */
export function formatCodexPlanLabel(planType, options = {}) {
	const override = nonEmptyString(options.planOverride);
	if (override) return override;
	const raw = nonEmptyString(planType);
	if (!raw) return null;
	const key = raw.toLowerCase();
	return CODEX_PLAN_LABELS[key] ?? humanizePlanSlug(raw);
}

/**
 * Prefer rate-limit tier SKU (includes 5x/20x) over coarse subscriptionType.
 * @param {unknown} subscriptionType
 * @param {unknown} rateLimitTier
 * @param {{ planOverride?: unknown }} [options]
 * @returns {string | null}
 */
export function formatClaudePlanLabel(subscriptionType, rateLimitTier, options = {}) {
	const override = nonEmptyString(options.planOverride);
	if (override) return override;

	const candidates = [rateLimitTier, subscriptionType]
		.map((value) => nonEmptyString(value))
		.filter(Boolean);
	for (const raw of candidates) {
		const key = raw.toLowerCase();
		if (CLAUDE_PLAN_LABELS[key]) return CLAUDE_PLAN_LABELS[key];

		const strippedDefault = key.replace(/^default_/, "");
		if (CLAUDE_PLAN_LABELS[strippedDefault]) return CLAUDE_PLAN_LABELS[strippedDefault];

		const maxNx = key.match(/(?:claude[_-]?)?max[_-]?(\d+)x$/i);
		if (maxNx) return `Max ${maxNx[1]}x`;

		const pro = key.match(/(?:claude[_-]?)?pro$/i);
		if (pro) return "Pro";
	}

	const fallback = candidates[0];
	return fallback ? humanizePlanSlug(fallback) : null;
}

/**
 * Allowed manual Claude plan overrides for set-plan.
 */
export const CLAUDE_PLAN_CHOICES = ["Pro", "Max 5x", "Max 20x"];
