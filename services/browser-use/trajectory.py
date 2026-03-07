"""Trajectory recorder — saves each agent step + browser context to disk for later distillation."""

import base64
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)

TRAJECTORIES_DIR = Path(os.getenv("TRAJECTORIES_DIR", str(Path(__file__).resolve().parent / "trajectories")))


@dataclass
class BrowserContext:
    url: str
    screenshot_path: str  # relative to trajectory dir
    page_title: str = ""
    dom_snippet: str = ""  # visible text / element summary


@dataclass
class ActionRecord:
    step: int
    timestamp: str
    actor: str  # "agent" or "user"
    action_type: str  # "click", "type", "navigate", "scroll", "extract", "done"
    action_detail: str  # human-readable description
    model_output: str  # raw LLM output / thinking
    browser_context: BrowserContext


@dataclass
class Trajectory:
    trajectory_id: str
    task: str
    endpoint: str  # which API endpoint triggered this (e.g. "/api/scrape")
    started_at: str
    actions: list[ActionRecord] = field(default_factory=list)
    final_result: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    error: str | None = None


class TrajectoryRecorder:
    """Records browser-use agent steps with screenshots for distillation."""

    def __init__(self, task: str, endpoint: str) -> None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        self.trajectory_id = f"{ts}_{int(time.time() * 1000) % 100000}"
        self.trajectory_dir = TRAJECTORIES_DIR / self.trajectory_id
        self.screenshots_dir = self.trajectory_dir / "screenshots"
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self._step = 0
        self._start_time = time.monotonic()

        self.trajectory = Trajectory(
            trajectory_id=self.trajectory_id,
            task=task,
            endpoint=endpoint,
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        logger.info(f"Trajectory {self.trajectory_id}: recording to {self.trajectory_dir}")

    def record_step(
        self,
        action_type: str,
        action_detail: str,
        model_output: str,
        url: str,
        screenshot_b64: str | None,
        page_title: str = "",
        dom_snippet: str = "",
    ) -> None:
        """Record a single agent step with browser context."""
        screenshot_path = ""
        if screenshot_b64:
            filename = f"step_{self._step:03d}.png"
            filepath = self.screenshots_dir / filename
            try:
                filepath.write_bytes(base64.b64decode(screenshot_b64))
                screenshot_path = f"screenshots/{filename}"
            except Exception as e:
                logger.warning(f"Failed to save screenshot: {e}")

        ctx = BrowserContext(
            url=url,
            screenshot_path=screenshot_path,
            page_title=page_title,
            dom_snippet=dom_snippet[:5000],
        )

        record = ActionRecord(
            step=self._step,
            timestamp=datetime.now(timezone.utc).isoformat(),
            actor="agent",
            action_type=action_type,
            action_detail=action_detail[:3000],
            model_output=model_output[:3000] if model_output else "",
            browser_context=ctx,
        )

        self.trajectory.actions.append(record)
        self._step += 1

        # Incremental save — don't lose data on crash
        self._save()

    def finalize(self, final_result: str | None, error: str | None = None) -> str:
        """Mark trajectory as complete. Returns path to trajectory.json."""
        self.trajectory.final_result = final_result
        self.trajectory.finished_at = datetime.now(timezone.utc).isoformat()
        self.trajectory.duration_ms = int((time.monotonic() - self._start_time) * 1000)
        self.trajectory.error = error
        return self._save()

    def _save(self) -> str:
        """Write trajectory JSON to disk."""
        path = self.trajectory_dir / "trajectory.json"
        data = asdict(self.trajectory)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return str(path)


def record_from_history(recorder: TrajectoryRecorder, history) -> None:
    """Extract steps from a browser-use AgentHistoryList and record them.

    The AgentHistoryList contains per-step data:
      - model_output: AgentOutput with thinking, actions, memory
      - result: list[ActionResult] with success/error/extracted_content
      - state: BrowserStateHistory with url, title, screenshot
    """
    if not history or not hasattr(history, "history"):
        return

    for item in history.history:
        # Extract model output (thinking + actions)
        model_output = ""
        action_detail = ""
        action_type = "unknown"

        if item.model_output:
            out = item.model_output
            parts = []
            if hasattr(out, "thinking") and out.thinking:
                parts.append(f"Thinking: {out.thinking}")
            if hasattr(out, "evaluation_previous_goal") and out.evaluation_previous_goal:
                parts.append(f"Eval: {out.evaluation_previous_goal}")
            if hasattr(out, "memory") and out.memory:
                parts.append(f"Memory: {out.memory}")
            model_output = "\n".join(parts)

            # Extract action details
            if hasattr(out, "action") and out.action:
                actions = out.action if isinstance(out.action, list) else [out.action]
                action_strs = []
                for a in actions:
                    action_str = str(a)
                    action_strs.append(action_str)
                    # Classify action type from string representation
                    a_lower = action_str.lower()
                    if "click" in a_lower:
                        action_type = "click"
                    elif "type" in a_lower or "input" in a_lower:
                        action_type = "type"
                    elif "navigate" in a_lower or "go_to" in a_lower:
                        action_type = "navigate"
                    elif "scroll" in a_lower:
                        action_type = "scroll"
                    elif "extract" in a_lower:
                        action_type = "extract"
                    elif "done" in a_lower:
                        action_type = "done"
                action_detail = " | ".join(action_strs)

        # Extract browser state
        url = ""
        page_title = ""
        screenshot_b64 = None
        dom_snippet = ""

        if item.state:
            if hasattr(item.state, "url"):
                url = item.state.url or ""
            if hasattr(item.state, "title"):
                page_title = item.state.title or ""
            if hasattr(item.state, "screenshot"):
                screenshot_b64 = item.state.screenshot

        # Extract result info
        if item.result:
            for r in item.result:
                if hasattr(r, "extracted_content") and r.extracted_content:
                    action_detail += f" → extracted: {str(r.extracted_content)[:500]}"
                if hasattr(r, "error") and r.error:
                    action_detail += f" → error: {r.error}"
                if hasattr(r, "is_done") and r.is_done:
                    action_type = "done"

        recorder.record_step(
            action_type=action_type,
            action_detail=action_detail,
            model_output=model_output,
            url=url,
            screenshot_b64=screenshot_b64,
            page_title=page_title,
            dom_snippet=dom_snippet,
        )
