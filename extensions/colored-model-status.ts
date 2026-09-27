/**
 * colored-model-status — color-code the active model in pi's footer.
 *
 * Replaces the plain `claude-opus-4-8 • medium` text in the bottom-right of
 * pi's footer with a background-colored badge, so you can tell at a glance
 * which model family is active. The footer is fully re-created via
 * `setFooter`, faithfully reproducing the default footer (cwd, git branch,
 * token stats, context %, extension statuses) while painting only the
 * model + thinking segment.
 *
 * `theme.bg()` only accepts theme tokens, so model-specific colors use raw
 * SGR truecolor escapes. Thinking badges reuse pi's themed editor border color
 * and choose a contrasting foreground.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Rgb = readonly [number, number, number];

interface Badge {
	/** Substring keywords matched against the lower-cased model id. */
	match: readonly string[];
	bg: Rgb;
	/** Foreground color. Defaults to black/white chosen from background luminance. */
	fg?: Rgb;
}

// Model families are matched top-to-bottom; first hit wins.
const MODEL_BADGES: readonly Badge[] = [
	{ match: ["opus", "terra"], bg: [147, 51, 234] }, // deep purple
	{ match: ["sonnet", "luna"], bg: [14, 165, 233] }, // bright cyan-blue
	{ match: ["fable", "sol"], bg: [234, 88, 12] }, // vivid orange
	{ match: ["haiku"], bg: [22, 163, 74] }, // green
	{ match: ["gpt", "o1", "o3", "o4"], bg: [16, 163, 127] }, // OpenAI teal
	{ match: ["gemini"], bg: [66, 133, 244] }, // Google blue
	{ match: ["grok"], bg: [30, 41, 59] }, // slate
];

const FALLBACK: Badge = { match: [], bg: [82, 82, 91] }; // gray

function pickBadge(value: string, badges: readonly Badge[]): Badge {
	const lower = value.toLowerCase();
	return badges.find((badge) => badge.match.some((keyword) => lower.includes(keyword))) ?? FALLBACK;
}

/** Pick a contrasting foreground (black/white) from the background luminance. */
function autoFg([r, g, b]: Rgb): Rgb {
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance > 0.6 ? [0, 0, 0] : [255, 255, 255];
}

/** Paint text as a background-colored badge (padded with spaces for a clear block). */
function paintBadge(text: string, badge: Badge): string {
	const [br, bg, bb] = badge.bg;
	const [fr, fg, fb] = badge.fg ?? autoFg(badge.bg);
	const bgSeq = `\x1b[48;2;${br};${bg};${bb}m`;
	const fgSeq = `\x1b[38;2;${fr};${fg};${fb}m`;
	return `${bgSeq}${fgSeq} ${text} \x1b[0m`;
}

// Approximate ANSI 0–15 palette values; terminal overrides may differ.
const ANSI16: readonly Rgb[] = [
	[0, 0, 0],
	[128, 0, 0],
	[0, 128, 0],
	[128, 128, 0],
	[0, 0, 128],
	[128, 0, 128],
	[0, 128, 128],
	[192, 192, 192],
	[128, 128, 128],
	[255, 0, 0],
	[0, 255, 0],
	[255, 255, 0],
	[0, 0, 255],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];

/** Decode the color pi actually uses for the editor border, including 256-color mode. */
function thinkingColor(ansi: string): { background: string; rgb: Rgb } | undefined {
	const sgr = ansi.startsWith("\x1b[") ? ansi.slice(2) : "";
	const truecolor = /^38;2;(\d+);(\d+);(\d+)m/.exec(sgr);
	if (truecolor) {
		return {
			background: `\x1b[48;2;${truecolor[1]};${truecolor[2]};${truecolor[3]}m`,
			rgb: [Number(truecolor[1]), Number(truecolor[2]), Number(truecolor[3])],
		};
	}
	const palette = /^38;5;(\d+)m/.exec(sgr);
	if (!palette) return undefined;
	const index = Number(palette[1]);
	let rgb: Rgb;
	if (index < 16) rgb = ANSI16[index] ?? [0, 0, 0];
	else if (index < 232) {
		const cube = (n: number) => (n === 0 ? 0 : 55 + n * 40);
		const i = index - 16;
		rgb = [cube(Math.floor(i / 36)), cube(Math.floor(i / 6) % 6), cube(i % 6)];
	} else if (index < 256) {
		const gray = 8 + (index - 232) * 10;
		rgb = [gray, gray, gray];
	} else return undefined;
	return { background: `\x1b[48;5;${index}m`, rgb };
}

/** WCAG contrast: choose the more legible of black and white. */
function contrastFg([r, g, b]: Rgb): 0 | 255 {
	const linear = (channel: number) => {
		const s = channel / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
	return luminance > 0.179 ? 0 : 255;
}

function paintThinkingBadge(
	text: string,
	level: Parameters<Theme["getThinkingBorderColor"]>[0],
	theme: Theme,
): string {
	const styled = theme.getThinkingBorderColor(level)(` ${text} `);
	const color = thinkingColor(styled);
	if (!color) return `\x1b[7m${styled}\x1b[0m`; // Terminal-default/unknown color: retain native reverse video.
	const fg = contrastFg(color.rgb);
	const fgSeq =
		theme.getColorMode() === "truecolor"
			? `\x1b[38;2;${fg};${fg};${fg}m`
			: `\x1b[38;5;${fg === 0 ? 0 : 15}m`;
	return `${color.background}${fgSeq} ${text} \x1b[0m`;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const rc = resolve(cwd);
	const rh = resolve(home);
	const rel = relative(rh, rc);
	const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

function sanitizeStatus(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const sm = ctx.sessionManager;
					const model = ctx.model;

					// --- Aggregate token stats across all entries ---
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;
					let latestCacheHitRate: number | undefined;
					for (const e of sm.getEntries()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const u = e.message.usage;
							input += u.input;
							output += u.output;
							cacheRead += u.cacheRead;
							cacheWrite += u.cacheWrite;
							cost += u.cost.total;
							const prompt = u.input + u.cacheRead + u.cacheWrite;
							latestCacheHitRate = prompt > 0 ? (u.cacheRead / prompt) * 100 : undefined;
						}
					}

					// --- Context usage ---
					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
					const pctValue = usage?.percent ?? 0;
					const pct = usage?.percent != null ? pctValue.toFixed(1) : "?";

					// --- pwd line (+ git branch + session name) ---
					let pwd = formatCwd(sm.getCwd(), process.env.HOME || process.env.USERPROFILE);
					const branch = footerData.getGitBranch();
					if (branch) pwd = `${pwd} (${branch})`;
					const sessionName = sm.getSessionName();
					if (sessionName) pwd = `${pwd} • ${sessionName}`;

					// --- stats (left side) ---
					const parts: string[] = [];
					if (input) parts.push(`↑${formatTokens(input)}`);
					if (output) parts.push(`↓${formatTokens(output)}`);
					if (cacheRead) parts.push(`R${formatTokens(cacheRead)}`);
					if (cacheWrite) parts.push(`W${formatTokens(cacheWrite)}`);
					if ((cacheRead > 0 || cacheWrite > 0) && latestCacheHitRate !== undefined) {
						parts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
					}
					const usingSub = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
					if (cost || usingSub) parts.push(`$${cost.toFixed(3)}${usingSub ? " (sub)" : ""}`);

					const autoInd = ""; // auto-compact indicator (kept blank; see note in README)
					const pctDisplay =
						pct === "?"
							? `?/${formatTokens(contextWindow)}${autoInd}`
							: `${pct}%/${formatTokens(contextWindow)}${autoInd}`;
					let pctStr: string;
					if (pctValue > 90) pctStr = theme.fg("error", pctDisplay);
					else if (pctValue > 70) pctStr = theme.fg("warning", pctDisplay);
					else pctStr = pctDisplay;
					parts.push(pctStr);

					let statsLeft = parts.join(" ");
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}

					// --- Right side: independently colored model and thinking badges ---
					const modelName = model?.id || "no-model";
					let modelText = modelName;
					if (footerData.getAvailableProviderCount() > 1 && model) {
						modelText = `(${model.provider}) ${modelText}`;
					}
					const thinkingLevel = model?.reasoning ? pi.getThinkingLevel() || "off" : undefined;
					const thinkingText = thinkingLevel === "off" ? "thinking off" : thinkingLevel;
					const modelBadge = pickBadge(modelName, MODEL_BADGES);
					const thinkingWidth = thinkingText ? visibleWidth(thinkingText) + 2 : 0;
					const thinking =
						thinkingLevel && thinkingText
							? paintThinkingBadge(thinkingText, thinkingLevel, theme)
							: "";
					const rightWidth = visibleWidth(modelText) + 2 + thinkingWidth;

					const minPadding = 2;
					const dimStatsLeft = theme.fg("dim", statsLeft);
					let statsLine: string;
					if (statsLeftWidth + minPadding + rightWidth <= width) {
						const pad = " ".repeat(width - statsLeftWidth - rightWidth);
						statsLine =
							dimStatsLeft + theme.fg("dim", pad) + paintBadge(modelText, modelBadge) + thinking;
					} else {
						// Preserve the thinking badge when possible and truncate only the model badge.
						const modelAvail = width - statsLeftWidth - minPadding - thinkingWidth - 2;
						if (modelAvail > 0) {
							const truncatedModel = truncateToWidth(modelText, modelAvail, "");
							const paintedWidth = visibleWidth(truncatedModel) + 2 + thinkingWidth;
							const pad = " ".repeat(Math.max(0, width - statsLeftWidth - paintedWidth));
							statsLine =
								dimStatsLeft +
								theme.fg("dim", pad) +
								paintBadge(truncatedModel, modelBadge) +
								thinking;
						} else {
							statsLine = dimStatsLeft;
						}
					}

					const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
					const lines = [pwdLine, statsLine];

					// --- Extension status line (token-counter / working-status, etc.) ---
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const sorted = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => sanitizeStatus(t));
						lines.push(truncateToWidth(sorted.join(" "), width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	});
}
