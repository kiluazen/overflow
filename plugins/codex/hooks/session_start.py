#!/usr/bin/env python3
"""SessionStart hook: switch a nearly-exhausted session into orchestration mode."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys

# Temporary dogfood threshold. The product threshold is 10%; 80% lets us
# exercise the orchestration loop before an account actually runs low.
DEFAULT_REMAINING_PERCENT = 80.0


def _load_probe():
    plugin_root = Path(os.environ.get("PLUGIN_ROOT", Path(__file__).parents[1]))
    path = plugin_root / "scripts" / "usage_probe.py"
    spec = importlib.util.spec_from_file_location("overflow_usage_probe", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load usage probe from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        hook_input = {}

    # Trigger when this much allowance or less is left. Stated as remaining,
    # never as used, so the number in the config reads the same as the number
    # the user sees in the app.
    trigger_at = float(
        os.environ.get("OVERFLOW_REMAINING_PERCENT", DEFAULT_REMAINING_PERCENT)
    )

    try:
        probe = _load_probe()
        usage = probe.summarize(probe.read_rate_limits())
    except Exception:
        # No allowance reading means no basis to change the session's behaviour.
        # Stay silent rather than guess.
        return 0

    remaining = float(usage["remainingPercent"])
    # Trigger at the configured boundary as well as below it. This makes an
    # 80%-remaining dogfood build testable as soon as the app displays 80%.
    if remaining > trigger_at:
        return 0

    # Codex meters the capable models and the small ones separately, so a dry
    # main bucket leaves the user on a weaker model rather than stopping them.
    # Say which it is: "you have 0% left" is false and reads like a bug when
    # the session visibly keeps working.
    fallbacks = usage.get("fallbacks") or []
    usable = [f for f in fallbacks if f["remainingPercent"] > 5.0]
    main_exhausted = remaining <= 0 or bool(usage.get("rateLimitReachedType"))
    if main_exhausted and usable:
        best = max(usable, key=lambda item: item["remainingPercent"])
        label = best.get("limitName") or best.get("limitId") or "a smaller model"
        situation = (
            f"Your main Codex allowance is {remaining:g}% remaining, so this session "
            f"has been dropped onto {label}. Your friends' allowance has not been."
        )
        headline = f"Overflow: main allowance gone — you are on {label}."
    elif main_exhausted:
        situation = (
            f"Your Codex allowance is {remaining:g}% remaining and there is no "
            "smaller model left to fall back on."
        )
        headline = f"Overflow: {remaining:g}% left."
    else:
        situation = f"Your main Codex allowance is {remaining:g}% remaining."
        headline = f"Overflow test: {remaining:g}% left."

    # Give the
    # nearly-empty session the complete behavior change without making it hunt
    # through files or spend allowance rediscovering the tool contract.
    context = (
        f"Overflow: {situation}\n\n"
        "For the rest of this session preserve the remaining allowance for intent, "
        "coordination, review, and integration. For substantive execution, use the "
        "installed work skill. Overflow is already authenticated through its remote "
        "MCP connection. When Overflow is first used in this task, open "
        "https://overflow.kushalsm.com in the user's Codex browser panel so they "
        "can watch the pool. Package one whole-task order and call "
        "`overflow_delegate` immediately as the next action; do not check the pool, "
        "research, or narrate progress first. Call it exactly once. It returns a "
        "durable batch immediately and reserves 100 credits per order; do not poll, "
        "keep this turn alive, or duplicate "
        "the delegated work. If task heartbeats are available, create exactly one "
        "attached heartbeat named `Overflow <batch UUID>` with the finite schedule "
        "`FREQ=MINUTELY;INTERVAL=20;COUNT=4`; Codex counts the creation-time "
        "occurrence, leaving future wakes at 20, 40, and 60 minutes. Its prompt must call "
        "`overflow_collect` once for that batch, stay quiet when incomplete, and "
        "return the reviewed result here when complete before deleting itself. Tell "
        "the user this task will check at 20, 40, and 60 minutes, then end the turn. "
        "Waiting between checks uses no model turn. On a later user turn, call "
        "`overflow_inbox` once to recover completed work "
        "even if the original batch ID was lost. Never say an order was delegated "
        "unless the tool was actually called."
    )

    print(
        json.dumps(
            {
                "systemMessage": (
                    f"{headline} Use Overflow to keep working: this session will "
                    "coordinate while visible /earn sessions execute."
                ),
                "hookSpecificOutput": {
                    "hookEventName": "SessionStart",
                    "additionalContext": context,
                },
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
