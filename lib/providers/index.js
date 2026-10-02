/**
 * Provider registry. Fixed order matches lib/snapshot.js PROVIDER_ORDER.
 * Depends on: lib/providers/{codex,claude,antigravity}.js
 */

import { codex } from "./codex.js";
import { claude } from "./claude.js";
import { antigravity } from "./antigravity.js";

export const providers = Object.freeze([codex, claude, antigravity]);

/**
 * @param {string} id
 * @returns {object | null}
 */
export function getProvider(id) {
	if (typeof id !== "string") return null;
	const key = id.trim().toLowerCase();
	return providers.find(provider => provider.id === key) ?? null;
}

export { codex, claude, antigravity };
