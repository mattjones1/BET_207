import { describe, expect, it } from "vitest";
import { americanToDecimal, breakEven, decimalToAmerican, expectedValue, formatAmerican, impliedProbability, noVigTwoWay, unitsFor } from "./odds";

describe("odds conversions", () => {
  it("American → decimal", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 4);
    expect(americanToDecimal(150)).toBe(2.5);
    expect(americanToDecimal(100)).toBe(2);
    expect(americanToDecimal(-100)).toBe(2);
  });
  it("decimal → American", () => {
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1.9091)).toBe(-110);
    expect(decimalToAmerican(1)).toBeNull();
  });
  it("rejects invalid and missing prices", () => {
    expect(americanToDecimal(50)).toBeNull();
    expect(americanToDecimal(null)).toBeNull();
    expect(impliedProbability(undefined)).toBeNull();
    expect(formatAmerican(null)).toBe("—");
  });
  it("−110 breaks even at 52.38%", () => {
    expect(breakEven(-110)).toBeCloseTo(0.5238, 4);
  });
  it("removes the vig from a two-way market", () => {
    const f = noVigTwoWay(-110, -110)!;
    expect(f.a).toBeCloseTo(0.5, 6);
    expect(f.overround).toBeCloseTo(0.0476, 4);
    expect(noVigTwoWay(-110, null)).toBeNull();
  });
});

describe("expected value", () => {
  it("is zero at break-even and positive above it", () => {
    expect(expectedValue(110 / 210, -110)).toBeCloseTo(0, 6);
    expect(expectedValue(0.55, -110)!).toBeCloseTo(0.05, 3);
  });
  it("a push returns the stake", () => {
    // 50% win, 10% push, 40% loss at +100: 0.5 − 0.4 = 0.1
    expect(expectedValue(0.5, 100, 0.1)).toBeCloseTo(0.1, 9);
  });
  it("refuses impossible inputs and missing prices", () => {
    expect(expectedValue(0.6, -110, 0.5)).toBeNull();
    expect(expectedValue(0.55, null)).toBeNull();
    expect(expectedValue(null, -110)).toBeNull();
  });
  it("units per graded bet", () => {
    expect(unitsFor("W", -110)).toBeCloseTo(0.9091, 4);
    expect(unitsFor("L", -110)).toBe(-1);
    expect(unitsFor("P", -110)).toBe(0);
    expect(unitsFor("W", null)).toBeNull();
  });
});
