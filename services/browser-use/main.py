"""
browser-use FastAPI microservice

Provides web scraping and data extraction endpoints using the browser-use
library with LLM-powered extraction. Designed to be called from the
Greenfinch TypeScript client (src/lib/browser-use.ts).

Every request records a full agent trajectory (actions, screenshots, LLM
outputs) to disk under TRAJECTORIES_DIR for later distillation.

Endpoints:
  POST /api/scrape           — Generic page scrape with LLM extraction
  POST /api/linkedin/profile — LinkedIn profile data extraction
  POST /api/company/team     — Company team page scrape
  GET  /health               — Health check
  GET  /api/trajectories     — List recorded trajectories
  GET  /api/trajectories/{id} — Get a specific trajectory
"""

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from scraper import BrowserPool, scrape_page, extract_linkedin_profile, extract_team_page
from trajectory import TRAJECTORIES_DIR

load_dotenv()

MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "3"))
HEADLESS = os.getenv("HEADLESS", "true").lower() == "true"

pool: BrowserPool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    pool = BrowserPool(max_concurrent=MAX_CONCURRENT, headless=HEADLESS)
    yield
    if pool:
        await pool.close()


app = FastAPI(
    title="browser-use scraper",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Request / Response Models ────────────────────────────────────────────


class ScrapeRequest(BaseModel):
    url: str
    extraction_prompt: str
    timeout_ms: int = Field(default=30_000, ge=1000, le=120_000)
    wait_for_selector: str | None = None


class ScrapeResponse(BaseModel):
    success: bool
    data: Any = None
    url: str
    screenshot_url: str | None = None
    error: str | None = None
    duration_ms: int
    trajectory_id: str | None = None


class LinkedInProfileRequest(BaseModel):
    url: str
    timeout_ms: int = Field(default=45_000, ge=1000, le=120_000)


class LinkedInExperience(BaseModel):
    title: str
    company: str
    location: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    is_current: bool = False
    description: str | None = None


class LinkedInEducation(BaseModel):
    school: str
    degree: str | None = None
    field: str | None = None
    start_year: int | None = None
    end_year: int | None = None


class LinkedInProfileData(BaseModel):
    name: str | None = None
    headline: str | None = None
    location: str | None = None
    current_title: str | None = None
    current_company: str | None = None
    profile_picture_url: str | None = None
    about: str | None = None
    experiences: list[LinkedInExperience] = []
    education: list[LinkedInEducation] = []


class LinkedInProfileResponse(BaseModel):
    data: LinkedInProfileData
    trajectory_id: str | None = None


class TeamPageRequest(BaseModel):
    domain: str
    timeout_ms: int = Field(default=45_000, ge=1000, le=120_000)


class PersonFromPage(BaseModel):
    name: str
    title: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None


class TeamPageResponse(BaseModel):
    data: dict  # { "people": list[PersonFromPage] }
    trajectory_id: str | None = None


# ── Endpoints ────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    count = 0
    if TRAJECTORIES_DIR.exists():
        count = sum(1 for d in TRAJECTORIES_DIR.iterdir() if d.is_dir())
    return {
        "status": "ok",
        "concurrent_limit": MAX_CONCURRENT,
        "trajectories_recorded": count,
    }


@app.post("/api/scrape", response_model=ScrapeResponse)
async def api_scrape(req: ScrapeRequest):
    start = time.monotonic()
    trajectory_id = None
    try:
        result, trajectory_id = await scrape_page(
            pool=pool,
            url=req.url,
            extraction_prompt=req.extraction_prompt,
            timeout_ms=req.timeout_ms,
            wait_for_selector=req.wait_for_selector,
        )
        duration = int((time.monotonic() - start) * 1000)
        return ScrapeResponse(
            success=True,
            data=result,
            url=req.url,
            duration_ms=duration,
            trajectory_id=trajectory_id,
        )
    except asyncio.TimeoutError:
        duration = int((time.monotonic() - start) * 1000)
        return ScrapeResponse(
            success=False,
            url=req.url,
            error="Timeout exceeded",
            duration_ms=duration,
            trajectory_id=trajectory_id,
        )
    except Exception as exc:
        duration = int((time.monotonic() - start) * 1000)
        return ScrapeResponse(
            success=False,
            url=req.url,
            error=str(exc)[:300],
            duration_ms=duration,
            trajectory_id=trajectory_id,
        )


@app.post("/api/linkedin/profile", response_model=LinkedInProfileResponse)
async def api_linkedin_profile(req: LinkedInProfileRequest):
    try:
        profile, trajectory_id = await extract_linkedin_profile(
            pool=pool,
            url=req.url,
            timeout_ms=req.timeout_ms,
        )
        return LinkedInProfileResponse(data=profile, trajectory_id=trajectory_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])


@app.post("/api/company/team", response_model=TeamPageResponse)
async def api_company_team(req: TeamPageRequest):
    try:
        people, trajectory_id = await extract_team_page(
            pool=pool,
            domain=req.domain,
            timeout_ms=req.timeout_ms,
        )
        return TeamPageResponse(data={"people": people}, trajectory_id=trajectory_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])


# ── Trajectory Browsing ──────────────────────────────────────────────────


@app.get("/api/trajectories")
async def list_trajectories(limit: int = 50, offset: int = 0):
    """List recorded trajectories, newest first."""
    if not TRAJECTORIES_DIR.exists():
        return {"trajectories": [], "total": 0}

    dirs = sorted(
        [d for d in TRAJECTORIES_DIR.iterdir() if d.is_dir()],
        key=lambda d: d.name,
        reverse=True,
    )
    total = len(dirs)
    page = dirs[offset : offset + limit]

    summaries = []
    for d in page:
        tj_file = d / "trajectory.json"
        if tj_file.exists():
            try:
                tj = json.loads(tj_file.read_text())
                summaries.append({
                    "trajectory_id": tj.get("trajectory_id"),
                    "task": (tj.get("task") or "")[:200],
                    "endpoint": tj.get("endpoint"),
                    "started_at": tj.get("started_at"),
                    "finished_at": tj.get("finished_at"),
                    "duration_ms": tj.get("duration_ms"),
                    "steps": len(tj.get("actions", [])),
                    "error": tj.get("error"),
                    "has_final_result": tj.get("final_result") is not None,
                })
            except Exception:
                summaries.append({"trajectory_id": d.name, "error": "corrupt"})
        else:
            summaries.append({"trajectory_id": d.name, "error": "missing trajectory.json"})

    return {"trajectories": summaries, "total": total}


@app.get("/api/trajectories/{trajectory_id}")
async def get_trajectory(trajectory_id: str):
    """Get full trajectory data."""
    tj_file = TRAJECTORIES_DIR / trajectory_id / "trajectory.json"
    if not tj_file.exists():
        raise HTTPException(status_code=404, detail="Trajectory not found")
    try:
        return json.loads(tj_file.read_text())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])


@app.get("/api/trajectories/{trajectory_id}/screenshots/{filename}")
async def get_screenshot(trajectory_id: str, filename: str):
    """Serve a trajectory screenshot."""
    # Prevent path traversal
    if ".." in trajectory_id or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid path")
    filepath = TRAJECTORIES_DIR / trajectory_id / "screenshots" / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(filepath, media_type="image/png")
