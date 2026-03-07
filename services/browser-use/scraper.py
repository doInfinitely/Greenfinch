"""
Core scraping logic using browser-use library.

Manages a pool of browser instances and provides extraction functions
for generic pages, LinkedIn profiles, and company team pages.

Every agent run records a full trajectory (actions, screenshots, LLM
outputs) to disk for later distillation.
"""

import asyncio
import json
import logging
import os
import re
from typing import Any

from browser_use import Agent
from langchain_openai import ChatOpenAI

from trajectory import TrajectoryRecorder, record_from_history

logger = logging.getLogger(__name__)

# ── Browser Pool ─────────────────────────────────────────────────────────


class BrowserPool:
    """Manages concurrent browser-use Agent sessions with a semaphore."""

    def __init__(self, max_concurrent: int = 3, headless: bool = True):
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.headless = headless
        self._llm = ChatOpenAI(
            model="gpt-4o-mini",
            api_key=os.getenv("OPENAI_API_KEY"),
        )

    async def close(self):
        """Cleanup — no persistent browsers to close."""
        pass

    async def run_agent(
        self,
        task: str,
        timeout_ms: int = 30_000,
        endpoint: str = "/api/scrape",
    ) -> tuple[str, str | None]:
        """Run a browser-use Agent with trajectory recording.

        Returns (final_result, trajectory_id).
        """
        recorder = TrajectoryRecorder(task=task, endpoint=endpoint)

        async with self.semaphore:
            agent = Agent(
                task=task,
                llm=self._llm,
                use_vision=True,
            )

            error = None
            final_result = ""
            try:
                history = await asyncio.wait_for(
                    agent.run(),
                    timeout=timeout_ms / 1000,
                )
                final_result = history.final_result() if history else ""

                # Record all steps from the history
                record_from_history(recorder, history)

            except asyncio.TimeoutError:
                error = "Timeout exceeded"
                # Try to capture partial history
                if hasattr(agent, "state") and hasattr(agent.state, "history"):
                    record_from_history(recorder, agent.state.history)
                raise
            except Exception as exc:
                error = str(exc)[:300]
                if hasattr(agent, "state") and hasattr(agent.state, "history"):
                    record_from_history(recorder, agent.state.history)
                raise
            finally:
                recorder.finalize(final_result=final_result or None, error=error)

            return final_result, recorder.trajectory_id


# ── Generic Scrape ───────────────────────────────────────────────────────


async def scrape_page(
    pool: BrowserPool,
    url: str,
    extraction_prompt: str,
    timeout_ms: int = 30_000,
    wait_for_selector: str | None = None,
) -> tuple[Any, str | None]:
    """Scrape a page and extract structured data using LLM.

    Returns (extracted_data, trajectory_id).
    """
    selector_instruction = ""
    if wait_for_selector:
        selector_instruction = f' Wait for the CSS selector "{wait_for_selector}" to appear before extracting.'

    task = (
        f"Navigate to {url}.{selector_instruction} "
        f"Then extract the following information and return it as JSON:\n\n"
        f"{extraction_prompt}"
    )

    raw, trajectory_id = await pool.run_agent(task, timeout_ms=timeout_ms, endpoint="/api/scrape")
    return _try_parse_json(raw), trajectory_id


# ── LinkedIn Profile ─────────────────────────────────────────────────────


LINKEDIN_PROFILE_TASK = """Navigate to {url}.

Extract the following structured data from this LinkedIn profile page and return as JSON:

{{
  "name": "Full name",
  "headline": "Profile headline",
  "location": "Location shown on profile",
  "current_title": "Current job title",
  "current_company": "Current employer name",
  "profile_picture_url": "URL of profile picture or null",
  "about": "About section text or null",
  "experiences": [
    {{
      "title": "Job title",
      "company": "Company name",
      "location": "Location or null",
      "start_date": "Start date string or null",
      "end_date": "End date string or null (use null if 'Present')",
      "is_current": true/false,
      "description": "Role description or null"
    }}
  ],
  "education": [
    {{
      "school": "School name",
      "degree": "Degree or null",
      "field": "Field of study or null",
      "start_year": year_number_or_null,
      "end_year": year_number_or_null
    }}
  ]
}}

If a section is not visible or the profile is restricted, use null for missing fields
and empty arrays for missing lists. Return ONLY the JSON object, no extra text."""


async def extract_linkedin_profile(
    pool: BrowserPool,
    url: str,
    timeout_ms: int = 45_000,
) -> tuple[dict, str | None]:
    """Extract structured data from a LinkedIn profile page.

    Returns (profile_data, trajectory_id).
    """
    task = LINKEDIN_PROFILE_TASK.format(url=url)
    raw, trajectory_id = await pool.run_agent(
        task, timeout_ms=timeout_ms, endpoint="/api/linkedin/profile"
    )
    data = _try_parse_json(raw)

    if not isinstance(data, dict):
        return _empty_profile(), trajectory_id

    # Normalize keys to snake_case and fill defaults
    profile = _empty_profile()
    for key in profile:
        if key in data:
            profile[key] = data[key]
        # Also accept camelCase variants
        camel = _to_camel(key)
        if camel in data:
            profile[key] = data[camel]

    return profile, trajectory_id


def _empty_profile() -> dict:
    return {
        "name": None,
        "headline": None,
        "location": None,
        "current_title": None,
        "current_company": None,
        "profile_picture_url": None,
        "about": None,
        "experiences": [],
        "education": [],
    }


# ── Company Team Page ────────────────────────────────────────────────────


TEAM_PAGE_TASK = """Navigate to https://{domain}.

Look for a "Team", "About Us", "Our Team", "Leadership", "People", or similar page.
If you can find such a page, navigate to it.

Extract a list of people shown on the page. For each person, return:

{{
  "people": [
    {{
      "name": "Full name",
      "title": "Job title or null",
      "email": "Email address or null",
      "phone": "Phone number or null",
      "linkedin_url": "LinkedIn profile URL or null"
    }}
  ]
}}

If no team page exists or no people are found, return {{"people": []}}.
Return ONLY the JSON object, no extra text."""


async def extract_team_page(
    pool: BrowserPool,
    domain: str,
    timeout_ms: int = 45_000,
) -> tuple[list[dict], str | None]:
    """Extract team members from a company's website.

    Returns (people_list, trajectory_id).
    """
    task = TEAM_PAGE_TASK.format(domain=domain)
    raw, trajectory_id = await pool.run_agent(
        task, timeout_ms=timeout_ms, endpoint="/api/company/team"
    )
    data = _try_parse_json(raw)

    if isinstance(data, dict) and "people" in data:
        return data["people"], trajectory_id
    if isinstance(data, list):
        return data, trajectory_id
    return [], trajectory_id


# ── Helpers ──────────────────────────────────────────────────────────────


def _try_parse_json(text: str) -> Any:
    """Attempt to parse JSON from LLM output, stripping markdown fences."""
    if not text:
        return text

    cleaned = text.strip()
    # Strip markdown code fences
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return text


def _to_camel(snake: str) -> str:
    """Convert snake_case to camelCase."""
    parts = snake.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])
