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


def codex_bucket(result: dict[str, Any]) -> dict[str, Any]:
    by_id = result.get("rateLimitsByLimitId") or {}
    if isinstance(by_id, dict) and isinstance(by_id.get("codex"), dict):
        return by_id["codex"]
    fallback = result.get("rateLimits")
    return fallback if isinstance(fallback, dict) else {}


def summarize(result: dict[str, Any]) -> dict[str, Any]:
    bucket = codex_bucket(result)
    windows = [
        window
        for window in (bucket.get("primary"), bucket.get("secondary"))
        if isinstance(window, dict) and isinstance(window.get("usedPercent"), (int, float))
    ]
    if not windows:
        raise RuntimeError("No Codex usage window with usedPercent was returned")
    limiting_window = max(windows, key=lambda item: float(item["usedPercent"]))
    used_percent = float(limiting_window["usedPercent"])
    return {
        "limitId": bucket.get("limitId", "codex"),
        "usedPercent": used_percent,
        "remainingPercent": max(0.0, 100.0 - used_percent),
        "windowDurationMins": limiting_window.get("windowDurationMins"),
        "resetsAt": limiting_window.get("resetsAt"),
        "rateLimitReachedType": bucket.get("rateLimitReachedType"),
        "planType": bucket.get("planType"),
    }


if __name__ == "__main__":
    try:
        print(json.dumps(summarize(read_rate_limits()), separators=(",", ":")))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, separators=(",", ":")))
        sys.exit(1)
