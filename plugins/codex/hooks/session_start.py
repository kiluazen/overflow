#!/usr/bin/env python3
"""SessionStart hook: switch a nearly-exhausted session into orchestration mode."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

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


def _data_dir() -> Path:
    return Path(os.environ.get("PLUGIN_DATA", Path(__file__).parents[1] / ".data"))


def _append_event(event: dict[str, Any]) -> None:
    data_dir = _data_dir()
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        with (data_dir / "session-start.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, separators=(",", ":")) + "\n")
    except OSError:
        # Losing the log must never cost the user a session.
        pass


def _node_missing() -> bool:
    """True when the delegate tool will not be able to start.

    The MCP server needs node, and Codex hands MCP servers a trimmed
    environment. When node cannot be found the server never starts and the tool
    is simply absent -- which the session can only report as "I cannot delegate".
    Say so here, where the user can still act on it.
    """
    launcher = Path(
        os.environ.get("PLUGIN_ROOT", Path(__file__).parents[1])
    ) / "mcp" / "launch.sh"
    if not launcher.exists():
        return False
    try:
        result = subprocess.run(
            ["/bin/sh", str(launcher), "--check-node"],
            input="",
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 127


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

    event: dict[str, Any] = {
        "hook_event": hook_input.get("hook_event_name"),
        "source": hook_input.get("source"),
        "session_id": hook_input.get("session_id"),
        "triggerAtRemainingPercent": trigger_at,
    }

    try:
        probe = _load_probe()
        usage = probe.summarize(probe.read_rate_limits())
        event["usage"] = usage
    except Exception as exc:
        # No allowance reading means no basis to change the session's behaviour.
        # Stay silent rather than guess.
        event["error"] = str(exc)
        _append_event(event)
        return 0

    _append_event(event)

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

    if _node_missing():
        print(
            json.dumps(
                {
                    "systemMessage": (
                        f"{headline} Overflow cannot start: node was not found. "
                        "Install Node 22+, or set OVERFLOW_NODE to its path, or "
                        "delegation will be unavailable this session."
                    )
                },
                separators=(",", ":"),
            )
        )
        return 0

    # The plugin ships with the trusted-friends pool configuration. Give the
    # nearly-empty session the complete behavior change without making it hunt
    # through files or spend allowance rediscovering the tool contract.
    context = (
        f"Overflow: {situation}\n\n"
        "For the rest of this session preserve the remaining allowance for intent, "
        "coordination, review, and integration. For substantive execution, use the "
        "installed work skill. Check `overflow_pool`, then call `overflow_delegate` "
        "once. Default to one whole-task order; split only when the pool already has "
        "enough idle `/earn` sessions for every order. The call may wait until a friend "
        "opens a visible `/earn` task. Do not "
        "perform delegated work while waiting, and never say an order was delegated "
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
