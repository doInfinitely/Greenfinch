"""
browser-use FastAPI microservice

Provides web scraping and data extraction endpoints using the browser-use
library with LLM-powered extraction. Designed to be called from the
Greenfinch TypeScript client (src/lib/browser-use.ts).

Endpoints:
  POST /api/scrape           — Generic page scrape with LLM extraction
  POST /api/linkedin/profile — LinkedIn profile data extraction
  POST /api/company/team     — Company team page scrape
  GET  /health               — Health check
"""

import asyncio
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from scraper import BrowserPool, scrape_page, extract_linkedin_profile, extract_team_page

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


# ── Endpoints ────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "ok", "concurrent_limit": MAX_CONCURRENT}


@app.post("/api/scrape", response_model=ScrapeResponse)
async def api_scrape(req: ScrapeRequest):
    start = time.monotonic()
    try:
        result = await scrape_page(
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
        )
    except asyncio.TimeoutError:
        duration = int((time.monotonic() - start) * 1000)
        return ScrapeResponse(
            success=False,
            url=req.url,
            error="Timeout exceeded",
            duration_ms=duration,
        )
    except Exception as exc:
        duration = int((time.monotonic() - start) * 1000)
        return ScrapeResponse(
            success=False,
            url=req.url,
            error=str(exc)[:300],
            duration_ms=duration,
        )


@app.post("/api/linkedin/profile", response_model=LinkedInProfileResponse)
async def api_linkedin_profile(req: LinkedInProfileRequest):
    try:
        profile = await extract_linkedin_profile(
            pool=pool,
            url=req.url,
            timeout_ms=req.timeout_ms,
        )
        return LinkedInProfileResponse(data=profile)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])


@app.post("/api/company/team", response_model=TeamPageResponse)
async def api_company_team(req: TeamPageRequest):
    try:
        people = await extract_team_page(
            pool=pool,
            domain=req.domain,
            timeout_ms=req.timeout_ms,
        )
        return TeamPageResponse(data={"people": people})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])
