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

    expect(message).toContain("*Plan for:* Ship better CLI");
    expect(message).toContain("1. *Fix bugs* [low]");
    expect(message).toContain("2. *Add tests* [medium]");
  });
});

describe("planKeyboard", () => {
  test("builds one toggle button per step plus controls", () => {
    const keyboard = planKeyboard(session()).reply_markup.inline_keyboard;

    expect(keyboard).toHaveLength(4);
    expect(callbackData(keyboard[0]![0]!)).toBe("plan_toggle:step-1");
    expect(callbackData(keyboard[1]![0]!)).toBe("plan_toggle:step-2");
    expect(callbackData(keyboard[3]![0]!)).toBe("plan_proceed");
  });
});
