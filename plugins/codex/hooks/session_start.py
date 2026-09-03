#!/usr/bin/env python3
"""SessionStart hook: switch a nearly-exhausted session into orchestration mode."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
from typing import Any

DEFAULT_REMAINING_PERCENT = 15.0


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


def _paired() -> bool:
    try:
        stored = json.loads((_data_dir() / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stored = {}
    relay = os.environ.get("OVERFLOW_RELAY") or stored.get("relay")
    token = os.environ.get("OVERFLOW_TOKEN") or stored.get("token")
    return bool(relay and token)


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
    if remaining > trigger_at:
        return 0

    # Codex meters the capable models and the small ones separately, so a dry
    # main bucket leaves the user on a weaker model rather than stopping them.
    # Say which it is: "you have 0% left" is false and reads like a bug when
    # the session visibly keeps working.
    fallbacks = usage.get("fallbacks") or []
    usable = [f for f in fallbacks if f["remainingPercent"] > 5.0]
    if usable:
        best = max(usable, key=lambda item: item["remainingPercent"])
        label = best.get("limitName") or best.get("limitId") or "a smaller model"
        situation = (
            f"Your main Codex allowance is {remaining:g}% remaining, so this session "
            f"has been dropped onto {label}. Your friends' allowance has not been."
        )
        headline = f"Overflow: main allowance gone — you are on {label}."
    else:
        situation = (
            f"Your Codex allowance is {remaining:g}% remaining and there is no "
            "smaller model left to fall back on."
        )
        headline = f"Overflow: {remaining:g}% left."

    if not _paired():
        print(
            json.dumps(
                {
                    "systemMessage": (
                        f"{headline} Overflow is not paired yet — run "
                        "`overflow pair <relay-url> <invite-code>` to delegate to your pool."
                    )
                },
                separators=(",", ":"),
            )
        )
        return 0

    # Everything the session needs to act correctly goes in this text. An
    # earlier version said "read the overflow skill" and the agent spent three
    # shell commands hunting for the file on disk before doing anything -- the
    # exact expensive flailing this hook exists to prevent. State the rules;
    # the skill is already loaded and adds detail if it wants it.
    context = (
        f"Overflow: {situation}\n\n"
        "For the rest of this session you are a coordinator, not an executor. "
        "Operate like this, without looking anything up:\n\n"
        "1. Say in one sentence that you are delegating. Do not ask permission.\n"
        "2. Split the request into pieces that do not depend on each other. "
        "If the user asked for several things, or for the same treatment applied to "
        "several subjects, that is one order EACH, not one combined order. Splitting "
        "is what makes this fast: orders run at the same time on different machines.\n"
        "3. Call the `overflow_delegate` tool ONCE, passing every order in its "
        "`orders` array. The tool is already available to you. Never search the "
        "filesystem for it, never read plugin files, and never try to reach a relay "
        "through the shell.\n"
        "4. Each order must stand alone. The worker is a fresh Codex on someone "
        "else's computer: it cannot see this conversation or any of your files, and "
        "it will not ask questions. Paste the actual text it needs into `context`.\n"
        "5. The call parks without spending allowance and reports progress by "
        "itself. Do not narrate the wait or do the work while waiting.\n"
        "6. When the artifacts come back, judge them and assemble the answer. "
        "Send at most one correction as a new order.\n\n"
        "Waiting is always cheaper than doing the work here. Spend what is left on "
        "deciding what to delegate and judging what comes back.\n\n"
        "If the `overflow_delegate` tool is not available to you, say so plainly and "
        "stop. Never say you delegated, or that workers are running, unless you "
        "actually called the tool and it returned."
    )

    print(
        json.dumps(
            {
                "systemMessage": f"{headline} Delegating this session's work to your pool.",
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
