import chalk from "chalk";
import { TERM_WIDTH } from "./terminal-md";

/**
 * Reasoning dropdown component.
 *
 * Displays accumulated model reasoning/thinking in a collapsible panel.
 * Toggled with the ArrowRight key: press to expand, press again to collapse.
 *
 * Usage:
 *   const dropdown = createReasoningDropdown();
 *   dropdown.append("thinking token...\n");
 *   console.log(dropdown.render());  // renders current state
 */
export interface ReasoningDropdownState {
  collapsed: boolean;
  content: string;
}

export interface ReasoningDropdownOptions {
  /** Whether the panel starts collapsed */
  initialCollapsed?: boolean;
  /** Exact token count, when supplied by the provider */
  tokenCount?: number;
}

export function createReasoningDropdown(options: ReasoningDropdownOptions = {}): {
  render: () => string;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
  append: (text: string) => void;
  hasContent: () => boolean;
  getTokens: () => number;
} {
  let state: ReasoningDropdownState = {
    collapsed: options.initialCollapsed ?? true,
    content: "",
  };
  let tokenCount = options.tokenCount ?? 0;

  const render = (): string => {
    const width = TERM_WIDTH - 4;
    const border = chalk.dim("│");
    const title = chalk.cyan.bold("🤖 Internal reasoning");

    if (!state.content && tokenCount === 0) {
      // No reasoning yet
      return `${title}\n`;
    }

    // Collapsed state - show the panel header plus a compact summary
    if (state.collapsed) {
      const summary = state.content.length > 0
        ? `• ${state.content.length} chars, ~${tokenCount || Math.ceil(state.content.length / 4)} tokens`
        : "• No reasoning emitted";
      return `${title}\n${border} ${chalk.dim(summary)}\n`;
    }

    // Expanded state - render header + full content
    const contentLines = state.content
      .split("\n")
      .filter(line => line.length > 0)
      .map(line => {
        // Truncate long lines for display
        return line.length > width ? line.slice(0, width - 3) + "..." : line;
      })
      .join("\n");

    return `${title}\n${border} ${contentLines}\n`;
  };

  return {
    render,
    toggle: () => {
      state.collapsed = !state.collapsed;
    },
    expand: () => {
      state.collapsed = false;
    },
    collapse: () => {
      state.collapsed = true;
    },
    append: (text) => {
      state.content += text;
      if (options.tokenCount === undefined) {
        tokenCount = Math.ceil(state.content.length / 4);
      }
    },
    hasContent: () => state.content.length > 0,
    getTokens: () => tokenCount,
  };
}
