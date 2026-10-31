import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import coloredModelStatus, { sumUsage } from "../extensions/colored-model-status";

function renderThinkingBadge(color: string, mode: "truecolor" | "256color", level = "off") {
	let render: (width: number) => string[] = () => [];
	const theme = {
		fg: (_color: string, text: string) => text,
		getColorMode: () => mode,
		getThinkingBorderColor: (_level: string) => (text: string) => `${color}${text}\x1b[39m`,
	};
	const footerData = {
		onBranchChange: () => () => {},
		getGitBranch: () => undefined,
		getAvailableProviderCount: () => 1,
		getExtensionStatuses: () => new Map(),
	};
	const ctx = {
		ui: {
			setFooter: (
				factory: (
					tui: unknown,
					theme: unknown,
					data: unknown,
				) => { render: (width: number) => string[] },
			) => {
				render = factory({ requestRender() {} }, theme, footerData).render;
			},
		},
		sessionManager: {
			getEntries: () => [],
			getCwd: () => "/tmp",
			getSessionName: () => undefined,
			getSessionId: () => "s",
			getLeafId: () => null,
		},
		model: { id: "test-model", reasoning: true, contextWindow: 1000 },
		getContextUsage: () => undefined,
		modelRegistry: { isUsingOAuth: () => false },
	};
	coloredModelStatus({
		on: (_event: string, start: (_event: unknown, ctx: unknown) => void) => start({}, ctx),
		getThinkingLevel: () => level,
	} as unknown as ExtensionAPI);
	return render(120)[1];
}

test("dark thinking border uses white text, including off", () => {
	expect(renderThinkingBadge("\x1b[38;2;80;80;80m", "truecolor")).toContain(
		"\x1b[48;2;80;80;80m\x1b[38;2;255;255;255m thinking off \x1b[0m",
	);
});

test("light thinking border uses black text", () => {
	expect(renderThinkingBadge("\x1b[38;2;209;131;232m", "truecolor", "xhigh")).toContain(
		"\x1b[48;2;209;131;232m\x1b[38;2;0;0;0m xhigh \x1b[0m",
	);
});

test("256-color thinking border keeps its palette index and chooses readable text", () => {
	expect(renderThinkingBadge("\x1b[38;5;238m", "256color")).toContain(
		"\x1b[48;5;238m\x1b[38;5;15m thinking off \x1b[0m",
	);
	expect(renderThinkingBadge("\x1b[38;5;183m", "256color", "high")).toContain(
		"\x1b[48;5;183m\x1b[38;5;0m high \x1b[0m",
	);
});

test("terminal-default theme color keeps reverse-video fallback", () => {
	expect(renderThinkingBadge("\x1b[39m", "truecolor")).toContain(
		"\x1b[7m\x1b[39m thinking off \x1b[39m\x1b[0m",
	);
});

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) {
	return { input, output, cacheRead, cacheWrite, cost: { total: cost } };
}

test("sumUsage mirrors pi's footer accounting", () => {
	const totals = sumUsage([
		{ type: "message", message: { role: "user" } },
		{ type: "message", message: { role: "assistant", usage: usage(10, 5, 30, 0, 0.5) } },
		{ type: "message", message: { role: "toolResult", usage: usage(1, 1, 0, 0, 0.1) } },
		{ type: "message", message: { role: "toolResult" } },
		{ type: "usage", usage: usage(2, 2, 0, 0, 0.2) },
		{ type: "compaction", usage: usage(3, 3, 0, 0, 0.3) },
		{ type: "branch_summary" },
		{ type: "custom", usage: usage(100, 100) },
	]);
	expect(totals.input).toBe(16);
	expect(totals.output).toBe(11);
	expect(totals.cacheRead).toBe(30);
	expect(totals.cost).toBeCloseTo(1.1);
	expect(totals.latestCacheHitRate).toBe(75);
});

test("footer recomputes session stats only when the leaf or model changes", () => {
	let render: (width: number) => string[] = () => [];
	let leafId = "a";
	let entryScans = 0;
	let contextScans = 0;
	const theme = {
		fg: (_color: string, text: string) => text,
		getColorMode: () => "truecolor",
		getThinkingBorderColor: () => (text: string) => text,
	};
	const footerData = {
		onBranchChange: () => () => {},
		getGitBranch: () => undefined,
		getAvailableProviderCount: () => 1,
		getExtensionStatuses: () => new Map(),
	};
	const ctx = {
		ui: {
			setFooter: (
				factory: (
					tui: unknown,
					theme: unknown,
					data: unknown,
				) => { render: (width: number) => string[] },
			) => {
				render = factory({ requestRender() {} }, theme, footerData).render;
			},
		},
		sessionManager: {
			getEntries: () => {
				entryScans++;
				return [{ type: "message", message: { role: "assistant", usage: usage(1200, 3) } }];
			},
			getCwd: () => "/tmp",
			getSessionName: () => undefined,
			getSessionId: () => "s",
			getLeafId: () => leafId,
		},
		model: { id: "m", reasoning: false, contextWindow: 1000 } as {
			id: string;
			reasoning: boolean;
			contextWindow: number;
		},
		getContextUsage: () => {
			contextScans++;
			return { tokens: 100, contextWindow: 1000, percent: 10 };
		},
		modelRegistry: { isUsingOAuth: () => false },
	};
	coloredModelStatus({
		on: (_event: string, start: (_event: unknown, ctx: unknown) => void) => start({}, ctx),
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI);

	for (let i = 0; i < 5; i++) expect(render(120)[1]).toContain("↑1.2k");
	expect([entryScans, contextScans]).toEqual([1, 1]);

	leafId = "b";
	render(120);
	expect([entryScans, contextScans]).toEqual([2, 2]);

	ctx.model = { id: "other", reasoning: false, contextWindow: 2000 };
	render(120);
	render(120);
	expect([entryScans, contextScans]).toEqual([3, 3]);
});
