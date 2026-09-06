import { describe, expect, test } from "bun:test";
import { planKeyboard, planMessage, type PlanSession } from "./plan-session.ts";

function callbackData(button: object): string | undefined {
  return "callback_data" in button ? String(button.callback_data) : undefined;
}

function session(): PlanSession {
  return {
    plan: {
      goal: "Ship better CLI",
      steps: [
        {
          id: "step-1",
          title: "Fix bugs",
          description: "Patch flow issues.",
          complexity: "low",
        },
        {
          id: "step-2",
          title: "Add tests",
          description: "Cover risky helpers.",
          complexity: "medium",
        },
      ],
    },
    selected: new Set(["step-1"]),
  };
}

describe("planMessage", () => {
  test("shows the goal, selected steps, and complexity tags", () => {
    const message = planMessage(session());

    expect(message).toContain("Ship better CLI");
    expect(message).toContain("Fix bugs");
    expect(message).toContain("Add tests");
  });
});

describe("planKeyboard", () => {
  test("builds one toggle button per step plus controls", () => {
    const keyboard = planKeyboard(session()).reply_markup.inline_keyboard;

    expect(keyboard.length).toBeGreaterThanOrEqual(4);
    expect(callbackData(keyboard[0]![0]!)).toBe("plan_toggle:step-1");
    expect(callbackData(keyboard[1]![0]!)).toBe("plan_toggle:step-2");
    // last row contains proceed
    const lastRow = keyboard[keyboard.length - 1]!;
    expect(callbackData(lastRow[0]!)).toBe("plan_proceed");
  });
});
