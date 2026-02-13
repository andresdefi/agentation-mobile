import { describe, expect, it } from "vitest";
import {
	type AccessibilityNode,
	boundingBoxArea,
	mapIosRole,
	parseAccessibilityOutput,
	pointInBounds,
} from "./ios-bridge";

describe("parseAccessibilityOutput", () => {
	it("parses a single button element", () => {
		const output = `Element: <AXButton>
  Label: "Back"
  Traits: Button
  Frame: {{12, 20}, {32, 28}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes).toHaveLength(1);
		expect(nodes[0].role).toBe("AXButton");
		expect(nodes[0].label).toBe("Back");
		expect(nodes[0].traits).toEqual(["Button"]);
		expect(nodes[0].frame).toEqual({ x: 12, y: 20, width: 32, height: 28 });
	});

	it("parses multiple elements", () => {
		const output = `Element: <AXButton>
  Label: "Back"
  Frame: {{0, 0}, {100, 44}}
Element: <AXStaticText>
  Label: "Hello World"
  Frame: {{20, 60}, {200, 30}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes).toHaveLength(2);
		expect(nodes[0].role).toBe("AXButton");
		expect(nodes[1].role).toBe("AXStaticText");
		expect(nodes[1].label).toBe("Hello World");
	});

	it("parses nested hierarchy with indentation", () => {
		const output = `Element: <AXNavigationBar>
  Frame: {{0, 0}, {390, 44}}
  Element: <AXButton>
    Label: "Back"
    Frame: {{8, 8}, {32, 28}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes).toHaveLength(2);
		expect(nodes[0].depth).toBe(0);
		expect(nodes[1].depth).toBe(1);
	});

	it("handles multiple traits separated by commas", () => {
		const output = `Element: <AXTabButton>
  Label: "Home"
  Traits: Tab, Selected, Button
  Frame: {{0, 800}, {98, 49}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes[0].traits).toEqual(["Tab", "Selected", "Button"]);
	});

	it("parses frame with float coordinates", () => {
		const output = `Element: <AXImage>
  Frame: {{12.5, 20.75}, {100.25, 50.5}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes[0].frame).toEqual({
			x: 12.5,
			y: 20.75,
			width: 100.25,
			height: 50.5,
		});
	});

	it("handles missing label", () => {
		const output = `Element: <AXGroup>
  Frame: {{0, 0}, {390, 844}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes[0].label).toBe("");
		expect(nodes[0].role).toBe("AXGroup");
	});

	it("handles element with value", () => {
		const output = `Element: <AXSlider>
  Label: "Volume"
  Value: "50%"
  Frame: {{20, 100}, {350, 30}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes[0].value).toBe("50%");
	});

	it("handles quoted and unquoted label values", () => {
		const output = `Element: <AXButton>
  Label: Submit
  Frame: {{0, 0}, {80, 40}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes[0].label).toBe("Submit");
	});

	it("skips empty lines", () => {
		const output = `Element: <AXButton>
  Label: "OK"
  Frame: {{0, 0}, {60, 40}}

Element: <AXButton>
  Label: "Cancel"
  Frame: {{70, 0}, {80, 40}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes).toHaveLength(2);
	});

	it("returns empty array for empty input", () => {
		expect(parseAccessibilityOutput("")).toEqual([]);
		expect(parseAccessibilityOutput("\n\n")).toEqual([]);
	});

	it("handles SBElement prefix", () => {
		const output = `SBElement: <AXApplication>
  Frame: {{0, 0}, {390, 844}}`;

		const nodes = parseAccessibilityOutput(output);
		expect(nodes).toHaveLength(1);
		expect(nodes[0].role).toBe("AXApplication");
	});
});

describe("mapIosRole", () => {
	it("maps known roles correctly", () => {
		expect(mapIosRole("AXButton")).toBe("button");
		expect(mapIosRole("AXStaticText")).toBe("text");
		expect(mapIosRole("AXTextField")).toBe("textfield");
		expect(mapIosRole("AXImage")).toBe("image");
		expect(mapIosRole("AXSwitch")).toBe("switch");
		expect(mapIosRole("AXTabButton")).toBe("tab");
		expect(mapIosRole("AXNavigationBar")).toBe("navigation");
		expect(mapIosRole("AXCell")).toBe("cell");
	});

	it("handles unknown roles by stripping AX prefix", () => {
		expect(mapIosRole("AXCustomView")).toBe("customview");
		expect(mapIosRole("AXSomeWidget")).toBe("somewidget");
	});

	it("passes through non-AX roles unchanged", () => {
		expect(mapIosRole("Unknown")).toBe("unknown");
		expect(mapIosRole("custom")).toBe("custom");
	});
});

describe("pointInBounds", () => {
	const box = { x: 10, y: 20, width: 100, height: 50 };

	it("returns true when point is inside", () => {
		expect(pointInBounds(50, 40, box)).toBe(true);
	});

	it("returns true when point is on boundary", () => {
		expect(pointInBounds(10, 20, box)).toBe(true);
		expect(pointInBounds(110, 70, box)).toBe(true);
	});

	it("returns false when point is outside", () => {
		expect(pointInBounds(5, 40, box)).toBe(false);
		expect(pointInBounds(50, 10, box)).toBe(false);
		expect(pointInBounds(120, 40, box)).toBe(false);
		expect(pointInBounds(50, 80, box)).toBe(false);
	});
});

describe("boundingBoxArea", () => {
	it("computes area correctly", () => {
		expect(boundingBoxArea({ width: 100, height: 50 })).toBe(5000);
	});

	it("returns zero for zero-dimension box", () => {
		expect(boundingBoxArea({ width: 0, height: 100 })).toBe(0);
		expect(boundingBoxArea({ width: 100, height: 0 })).toBe(0);
	});
});
