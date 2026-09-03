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

    if not _paired():
        print(
            json.dumps(
                {
                    "systemMessage": (
                        f"Overflow: {remaining:g}% of your Codex allowance left, but Overflow "
                        "is not paired yet. Run `overflow pair <relay-url> <invite-code>` to "
                        "delegate to your pool."
                    )
                },
                separators=(",", ":"),
            )
        )
        return 0

    context = (
        f"Overflow: this Codex account has {remaining:g}% of its allowance left. "
        "From now on in this session you are a coordinator, not an executor. "
        "Read and follow the `overflow` skill before doing substantive work. "
        "The short version: decide what needs doing, write each piece as a self-contained "
        "order, and send them all in ONE call to the `overflow_delegate` tool, which runs "
        "them on friends' idle Codex installations and returns their artifacts. "
        "That call costs no allowance while it waits, so waiting is always cheaper than "
        "doing the work here. Never search for the tool or try to reach the relay through "
        "the shell; call `overflow_delegate` directly. Spend what is left on deciding what "
        "to delegate and judging what comes back."
    )

    print(
        json.dumps(
            {
                "systemMessage": (
                    f"Overflow: {remaining:g}% left — delegating this session's work to "
                    "your pool."
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
