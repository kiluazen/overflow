#!/usr/bin/env python3
"""Read the signed-in ChatGPT Codex rate limit through a short-lived App Server."""

from __future__ import annotations

import json
import os
import selectors
import subprocess
import sys
import time
from typing import Any


def _send(proc: subprocess.Popen[str], message: dict[str, Any]) -> None:
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
    proc.stdin.flush()


def read_rate_limits(timeout_seconds: float = 10.0) -> dict[str, Any]:
    proc = subprocess.Popen(
        ["codex", "app-server", "--stdio"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=os.environ.copy(),
    )
    assert proc.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ)

    try:
        _send(
            proc,
            {
                "method": "initialize",
                "id": 0,
                "params": {
                    "clientInfo": {
                        "name": "overflow_probe",
                        "title": "Overflow usage probe",
                        "version": "0.1.0",
                    }
                },
            },
        )
        _send(proc, {"method": "initialized", "params": {}})
        _send(proc, {"method": "account/rateLimits/read", "id": 1})

        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            events = selector.select(max(0.0, deadline - time.monotonic()))
            if not events:
                break
            line = proc.stdout.readline()
            if not line:
                break
            message = json.loads(line)
            if message.get("id") != 1:
                continue
            if "error" in message:
                raise RuntimeError(json.dumps(message["error"], separators=(",", ":")))
            return message.get("result") or {}
        raise TimeoutError("Codex App Server did not return rate limits before timeout")
    finally:
        selector.close()
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)


def _worst_window(bucket: dict[str, Any]) -> dict[str, Any] | None:
    """The window closest to its limit — the one that actually constrains you."""
    windows = [
        window
        for window in (bucket.get("primary"), bucket.get("secondary"))
        if isinstance(window, dict)
        and isinstance(window.get("usedPercent"), (int, float))
    ]
    if not windows:
        return None
    return max(windows, key=lambda item: float(item["usedPercent"]))


def _describe(bucket: dict[str, Any]) -> dict[str, Any] | None:
    window = _worst_window(bucket)
    if window is None:
        return None
    used = float(window["usedPercent"])
    return {
        "limitId": bucket.get("limitId"),
        "limitName": bucket.get("limitName"),
        "usedPercent": used,
        "remainingPercent": max(0.0, 100.0 - used),
        "windowDurationMins": window.get("windowDurationMins"),
        "resetsAt": window.get("resetsAt"),
        "rateLimitReachedType": bucket.get("rateLimitReachedType"),
        "planType": bucket.get("planType"),
    }


def summarize(result: dict[str, Any]) -> dict[str, Any]:
    """Describe the main allowance, and say what is left to fall back on.

    Codex meters more than one bucket. The `codex` bucket covers the capable
    models; smaller models such as Codex Spark are metered separately and
    survive the main bucket running dry. So "out of allowance" does not mean
    Codex stops -- it means you have been dropped onto whatever is left. That
    is the moment Overflow exists for, and the message has to say so honestly
    rather than claiming you have nothing.
    """
    by_id = result.get("rateLimitsByLimitId")
    by_id = by_id if isinstance(by_id, dict) else {}

    main_bucket = by_id.get("codex")
    if not isinstance(main_bucket, dict):
        fallback = result.get("rateLimits")
        main_bucket = fallback if isinstance(fallback, dict) else {}

    main = _describe(main_bucket)
    if main is None:
        raise RuntimeError("No Codex usage window with usedPercent was returned")

    others = []
    for limit_id, bucket in by_id.items():
        if limit_id == "codex" or not isinstance(bucket, dict):
            continue
        described = _describe(bucket)
        if described is not None:
            others.append(described)
    others.sort(key=lambda item: item["usedPercent"])

    main["fallbacks"] = others
    main["fallbackAvailable"] = any(
        item["remainingPercent"] > 5.0 for item in others
    )
    return main


if __name__ == "__main__":
    try:
        print(json.dumps(summarize(read_rate_limits()), separators=(",", ":")))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, separators=(",", ":")))
        sys.exit(1)
