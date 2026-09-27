import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import coloredModelStatus from "../extensions/colored-model-status";

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
		sessionManager: { getEntries: () => [], getCwd: () => "/tmp", getSessionName: () => undefined },
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
