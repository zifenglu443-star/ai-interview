import asyncio
import base64
import json
import os
import re
import shutil
import time
from threading import Lock
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote, urlparse
from uuid import uuid4

import httpx
import truststore
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from director import (
    DirectorConfig,
    DirectorEngine,
    DirectorError,
    DirectorSession,
    ControlSignal,
    InterviewAnswer,
    InterviewQuestion,
    InterviewState,
    LiveInterviewerSignal,
)
from reporting import AnswerInput, evaluate_answers

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INTERVIEW_RECORDS_DIRECTORY = PROJECT_ROOT / "data" / "interview_records"
# This is a local desktop app: the project .env is the user-controlled source
# of truth and must replace stale values inherited by an older launcher shell.
load_dotenv(PROJECT_ROOT / ".env", override=True)
truststore.inject_into_ssl()

GOOGLE_LIVE_ENDPOINT = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
)
GOOGLE_LIVE_EPHEMERAL_ENDPOINT = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
)

app = FastAPI(
    title="AI Interview Simulator API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3001",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

director_engine = DirectorEngine()
sessions: dict[str, DirectorSession] = {}
session_last_seen: dict[str, float] = {}
sessions_lock = Lock()
SESSION_TTL_SECONDS = 6 * 60 * 60
NUMBERED_QUESTION_START = re.compile(
    r"^\s*(?:\d+|[一二三四五六七八九十]+)\s*[.)、:：]\s*(.+?)\s*$"
)


class PlanningError(Exception):
    """A visible failure from the required text-planning provider."""

    def __init__(self, detail: str, status_code: int = 503) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def prune_expired_sessions_locked(now: float) -> None:
    expired = [
        session_id
        for session_id, last_seen in session_last_seen.items()
        if now - last_seen >= SESSION_TTL_SECONDS
    ]
    for session_id in expired:
        sessions.pop(session_id, None)
        session_last_seen.pop(session_id, None)


def is_numbered_question_set(material: str) -> bool:
    """Return whether material explicitly contains separately numbered questions."""
    return sum(
        bool(NUMBERED_QUESTION_START.match(line))
        for line in material.splitlines()
        if line.strip()
    ) >= 2


def split_question_material(material: str) -> list[str]:
    """Preserve numbered question boundaries and their wrapped formula/text lines."""
    lines = material.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    numbered = is_numbered_question_set(material)

    if numbered:
        questions: list[list[str]] = []
        current: list[str] = []
        for raw_line in lines:
            match = NUMBERED_QUESTION_START.match(raw_line)
            if match:
                if current:
                    questions.append(current)
                current = [match.group(1)]
            elif current and raw_line.strip():
                # A formula or wrapped paragraph belongs to the latest numbered item.
                current.append(raw_line.strip())
        if current:
            questions.append(current)
        return ["\n".join(question).strip() for question in questions if question]

    # Maintain the existing import behaviour: a non-numbered file can still use
    # one question per physical line. Blank-separated paragraphs are kept intact.
    paragraphs = [
        [line.strip() for line in paragraph.splitlines() if line.strip()]
        for paragraph in re.split(r"\n\s*\n", material.strip())
        if paragraph.strip()
    ]
    if len(paragraphs) > 1:
        return ["\n".join(paragraph).strip() for paragraph in paragraphs]
    return [line.strip() for line in lines if line.strip()]


def normalize_question_text(value: str) -> str:
    """Compare question text while allowing only whitespace normalization."""
    return re.sub(r"\s+", " ", value).strip().casefold()


def build_question_plan_from_bank(question_bank: str) -> tuple[InterviewQuestion, ...]:
    """Turn explicit question material into a locked session plan without merging items."""
    prompts = split_question_material(question_bank)
    return tuple(
        InterviewQuestion(
            id=f"bank-{index + 1}",
            prompt=prompt,
            focus="Imported question",
            follow_up_prompt="Give one concrete example, tradeoff, or measurable result.",
        )
        for index, prompt in enumerate(prompts[:20])
    )


def build_interview_plan(
    request: "PlanInterviewRequest",
) -> tuple[tuple[InterviewQuestion, ...], Literal["provider"]]:
    """Generate every plan through the configured text-planning provider."""
    browser_planner = request.planner
    api_key = browser_planner.api_key or os.environ.get("PLANNER_API_KEY") or os.environ.get("DEEPSEEK_API_KEY", "")
    model = browser_planner.model or os.environ.get("PLANNER_MODEL") or os.environ.get("DEEPSEEK_PLANNER_MODEL", "deepseek-v4-flash")
    endpoint = browser_planner.endpoint or os.environ.get("PLANNER_API_ENDPOINT", "https://api.deepseek.com/chat/completions")
    source = request.question_bank.strip() or request.practice_topics.strip() or "Choose appropriate interview questions."
    numbered_source_questions = (
        split_question_material(source) if is_numbered_question_set(source) else []
    )
    if not api_key:
        raise PlanningError("Planning API key is not configured. Add it in Settings or .env.")
    prompt = (
        "Return JSON only with {\"questions\":[{\"id\":string,\"prompt\":string,\"focus\":string,"
        "\"follow_up_prompt\":string,\"allocated_seconds\":integer}]}. Build an interview plan from the "
        "provided questions/topics. The material may contain multiple numbered questions. If it contains "
        "N numbered or separately delimited questions, return exactly N question objects in the same order. "
        "Every prompt must contain exactly one independently answerable original question, including its "
        "continuation lines and formulae. Never merge separate questions, split one question into several "
        "objects, add generic opening/behavioural/closing questions, or prepend wording such as 'Explain'. "
        "Preserve supplied wording except for harmless whitespace. "
        "If the source is a list of topic fragments rather than complete questions, create one concrete, "
        "independently answerable interview question for each supplied topic, in source order, then allocate time. "
        "Allocate the entire time budget across 1-20 questions. This is a flexible reference budget, not a rigid schedule: allow "
        "reasonable variance and leave room to shorten or skip lower-value questions. Do not distribute "
        "time evenly. Give more time to questions with greater conceptual difficulty, implementation or "
        "systems complexity, ambiguity, tradeoff analysis, and opportunity to observe independent reasoning; "
        "give less time to introductory or verification questions. Prioritize independent problem completion "
        "and depth of reasoning over getting a final answer exactly right. "
        f"Role: {request.target_role or 'general'}. Focus: {request.practice_focus}. "
        f"Total seconds: {request.total_duration_seconds}. Source material (preserve boundaries exactly):\n---\n{source}\n---"
    )
    try:
        response = httpx.post(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You create precise interview plans. Return JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {"type": "json_object"},
                "thinking": {"type": "disabled"},
                "max_tokens": 4096,
                "temperature": 0.2,
            },
            timeout=30,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        payload = json.loads(re.sub(r"^```(?:json)?|```$", "", content.strip()).strip())
        questions = tuple(
            InterviewQuestion(
                    id=str(item.get("id") or f"plan-{index + 1}").strip(),
                    prompt=str(item["prompt"]).strip(),
                    focus=str(item.get("focus") or "Interview question").strip(),
                    follow_up_prompt=str(item.get("follow_up_prompt") or "What assumption or tradeoff mattered most?").strip(),
                    allocated_seconds=max(30, int(item.get("allocated_seconds") or 0)),
            )
            for index, item in enumerate(payload.get("questions", [])[:20])
            if str(item.get("prompt", "")).strip()
        )
        preserves_numbered_source = not numbered_source_questions or (
            len(questions) == len(numbered_source_questions)
            and all(
                normalize_question_text(question.prompt)
                == normalize_question_text(source_question)
                for question, source_question in zip(questions, numbered_source_questions)
            )
        )
        if not questions:
            raise PlanningError("Planning API returned no questions.", status_code=502)
        if len({question.id for question in questions}) != len(questions):
            raise PlanningError("Planning API returned duplicate question IDs.", status_code=502)
        if not preserves_numbered_source:
            raise PlanningError(
                "Planning API changed or merged the numbered questions. Please generate again.",
                status_code=502,
            )
        return normalize_plan_allocations(questions, request.total_duration_seconds), "provider"
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 401:
            raise PlanningError("Planning API rejected the configured API key (HTTP 401).") from error
        raise PlanningError(
            f"Planning API request failed (HTTP {error.response.status_code})."
        ) from error
    except httpx.HTTPError as error:
        raise PlanningError("Planning API could not be reached. Check the endpoint and network.") from error
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise PlanningError("Planning API returned an invalid plan response.", status_code=502) from error


def normalize_plan_allocations(
    questions: tuple[InterviewQuestion, ...], total_duration_seconds: int
) -> tuple[InterviewQuestion, ...]:
    count = len(questions)
    if not count:
        return ()
    minimum = min(30, total_duration_seconds // count)
    distributable = total_duration_seconds - minimum * count
    weights = [max(question.allocated_seconds, 1) for question in questions]
    weight_total = sum(weights)
    allocations = [minimum + int(distributable * weight / weight_total) for weight in weights]
    remainder = total_duration_seconds - sum(allocations)
    for index in sorted(range(count), key=lambda item: weights[item], reverse=True)[:remainder]:
        allocations[index] += 1
    return tuple(
        InterviewQuestion(
            id=question.id,
            prompt=question.prompt,
            focus=question.focus,
            follow_up_prompt=question.follow_up_prompt,
            allocated_seconds=allocations[index],
        )
        for index, question in enumerate(questions)
    )


class InterviewAnswerModel(BaseModel):
    question_id: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1, max_length=2_000)
    answer: str = Field(max_length=20_000)
    kind: str = Field(default="primary", max_length=40)


class DirectorConfigModel(BaseModel):
    interviewer_style: Literal["friendly", "professional", "strict"] = "professional"
    initial_pressure: Literal["low", "medium", "high"] = "low"
    follow_up_depth: Literal["light", "standard", "deep"] = "standard"
    interruption_frequency: Literal["low", "medium", "high"] = "medium"
    total_duration_seconds: int = Field(default=900, ge=300, le=3600)


class PlannedQuestionModel(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=2_000)
    focus: str = Field(min_length=1, max_length=200)
    follow_up_prompt: str = Field(min_length=1, max_length=2_000)
    allocated_seconds: int = Field(default=0, ge=0, le=3600)


class DirectorSessionModel(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    state: InterviewState
    question_index: int
    current_prompt: str | None
    current_focus: str | None
    attitude: str
    pressure: str
    control: "ControlSignalModel"
    director_config: DirectorConfigModel = Field(default_factory=DirectorConfigModel)
    turn_index: int = 0
    answers: list[InterviewAnswerModel] = Field(default_factory=list, max_length=100)
    follow_up_used: list[str] = Field(default_factory=list, max_length=100)
    question_plan: list[PlannedQuestionModel] = Field(default_factory=list, max_length=20)


class SubmitAnswerRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    answer: str = Field(max_length=20_000)


class SessionRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)


class StartInterviewRequest(BaseModel):
    target_role: str = Field(default="", max_length=160)
    practice_focus: Literal[
        "behavioral",
        "technical",
        "project",
        "case",
        "custom",
    ] = "behavioral"
    practice_topics: str = Field(default="", max_length=1200)
    question_bank: str = Field(default="", max_length=20_000)
    planned_questions: list[PlannedQuestionModel] = Field(default_factory=list, max_length=20)
    director_config: DirectorConfigModel = Field(default_factory=DirectorConfigModel)


class PlanInterviewRequest(BaseModel):
    target_role: str = Field(default="", max_length=160)
    practice_focus: str = Field(default="behavioral", max_length=80)
    practice_topics: str = Field(default="", max_length=1200)
    question_bank: str = Field(default="", max_length=20_000)
    total_duration_seconds: int = Field(default=900, ge=300, le=3600)
    planner: "PlannerApiSettingsModel" = Field(default_factory=lambda: PlannerApiSettingsModel())


class PlannerApiSettingsModel(BaseModel):
    api_key: str = Field(default="", max_length=500)
    endpoint: str = Field(default="", max_length=1_000)
    model: str = Field(default="", max_length=160)

    def model_post_init(self, __context: object) -> None:
        if not self.endpoint:
            return
        parsed = urlparse(self.endpoint)
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ValueError("Planning endpoint must be a valid HTTPS URL.")


class InterviewPlanResponse(BaseModel):
    provider: str
    model: str
    total_duration_seconds: int
    questions: list[PlannedQuestionModel]


class ControlSignalModel(BaseModel):
    emotion: str
    gesture: str
    whiteboard_action: str | None = None


class LiveInterviewerSignalModel(BaseModel):
    emotion: Literal[
        "neutral",
        "attentive",
        "curious",
        "skeptical",
        "unconvinced",
        "satisfied",
        "firm",
    ]
    gesture: Literal[
        "idle",
        "nod_once",
        "think",
        "lean_in",
        "look_whiteboard",
        "take_note",
        "pause",
    ]
    decision: Literal[
        "continue",
        "follow_up",
        "challenge",
        "interrupt",
        "move_on",
    ]
    reason: str = Field(min_length=1, max_length=240)
    confidence: float = Field(ge=0, le=1)
    follow_up_prompt: str | None = Field(default=None, max_length=2_000)
    candidate_answer: str | None = Field(default=None, max_length=20_000)
    whiteboard_actions: list["WhiteboardActionModel"] = Field(default_factory=list, max_length=4)


class WhiteboardActionModel(BaseModel):
    kind: Literal["note", "summary", "arrow", "line", "circle", "highlight"]
    text: str | None = Field(default=None, max_length=240)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    toX: float | None = Field(default=None, ge=0, le=1)
    toY: float | None = Field(default=None, ge=0, le=1)
    w: float | None = Field(default=None, ge=0, le=1)
    h: float | None = Field(default=None, ge=0, le=1)


class LiveControlReviewRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    proposal: LiveInterviewerSignalModel


class LiveControlReviewResponse(BaseModel):
    approved: bool
    approved_decision: str
    control: ControlSignalModel
    attitude: str
    pressure: str
    reason_code: str
    whiteboard_actions: list[WhiteboardActionModel] = Field(default_factory=list)
    session: DirectorSessionModel


class RealtimeClientSecretRequest(BaseModel):
    provider: str = "openai"
    api_key: str = Field(default="", max_length=500)
    model: str = Field(default="", max_length=160)


class VoiceProviderModel(BaseModel):
    id: str
    label: str
    ready: bool
    primary: bool = False
    detail: str


class RealtimeClientSecretResponse(BaseModel):
    provider: str
    value: str
    expires_at: int | None = None
    model: str
    voice: str


class ReportAnswerModel(BaseModel):
    question_id: str = Field(default="", max_length=200)
    question: str = Field(min_length=1, max_length=2_000)
    answer: str = Field(max_length=20_000)
    kind: str = Field(default="primary", max_length=40)


class EvaluateReportRequest(BaseModel):
    answers: list[ReportAnswerModel] = Field(max_length=100)
    total_questions: int | None = Field(default=None, ge=0, le=100)


class EvaluateReportResponse(BaseModel):
    rubric_version: str
    clarity: int
    specificity: int
    reasoning_depth: int
    completion: int
    overall: int
    suggestions: list[str]


class InterviewTranscriptItemModel(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    speaker: Literal["candidate", "interviewer"]
    text: str = Field(min_length=1, max_length=20_000)


class InterviewReportModel(BaseModel):
    completed_at: datetime
    total_questions: int = Field(ge=0, le=100)
    answered_questions: int = Field(ge=0, le=100)
    answers: list[InterviewAnswerModel] = Field(default_factory=list, max_length=100)
    realtime_transcript: list[InterviewTranscriptItemModel] = Field(
        default_factory=list,
        max_length=200,
    )


class WhiteboardSnapshotModel(BaseModel):
    data: str = Field(min_length=1, max_length=20_000_000)
    mime_type: Literal["image/jpeg"] = "image/jpeg"
    width: int = Field(gt=0, le=10_000)
    height: int = Field(gt=0, le=10_000)


class ArchiveInterviewRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    report: InterviewReportModel
    target_role: str = Field(default="", max_length=160)
    practice_focus: str = Field(default="", max_length=80)
    practice_topics: str = Field(default="", max_length=1200)
    whiteboard: WhiteboardSnapshotModel | None = None


class ArchiveInterviewResponse(BaseModel):
    record_id: str
    record_path: str
    whiteboard_saved: bool


class DeleteInterviewRecordResponse(BaseModel):
    record_id: str
    deleted: bool


class InterviewRecordSummary(BaseModel):
    record_id: str
    completed_at: str
    target_role: str
    answered_questions: int
    total_questions: int
    has_whiteboard: bool


class InterviewRecordDetail(BaseModel):
    record_id: str
    report: dict[str, Any]
    conversation: dict[str, Any]
    plan: dict[str, Any]
    has_whiteboard: bool


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/interview/start")
def start_interview(
    request: StartInterviewRequest | None = None,
) -> DirectorSessionModel:
    request = request or StartInterviewRequest()
    question_plan = tuple(
        InterviewQuestion(
            id=question.id,
            prompt=question.prompt,
            focus=question.focus,
            follow_up_prompt=question.follow_up_prompt,
            allocated_seconds=question.allocated_seconds,
        )
        for question in request.planned_questions
    )
    if not question_plan and (request.question_bank.strip() or request.practice_topics.strip()):
        raise HTTPException(
            status_code=422,
            detail="Generate a text-model interview plan before starting this interview.",
        )
    if question_plan and len({question.id for question in question_plan}) != len(
        question_plan
    ):
        raise HTTPException(status_code=422, detail="Planned question IDs must be unique.")
    session_id = uuid4().hex
    session = director_engine.start(
        practice_focus=request.practice_focus,
        practice_topics=request.practice_topics,
        target_role=request.target_role,
        director_config=DirectorConfig(
            interviewer_style=request.director_config.interviewer_style,
            initial_pressure=request.director_config.initial_pressure,
            follow_up_depth=request.director_config.follow_up_depth,
            interruption_frequency=request.director_config.interruption_frequency,
            total_duration_seconds=request.director_config.total_duration_seconds,
        ),
        question_plan=question_plan or None,
    )
    with sessions_lock:
        prune_expired_sessions_locked(time.monotonic())
        sessions[session_id] = session
        session_last_seen[session_id] = time.monotonic()
    return serialize_session(session, session_id)


@app.post("/interview/plan")
def plan_interview(request: PlanInterviewRequest) -> InterviewPlanResponse:
    try:
        questions, source = build_interview_plan(request)
    except PlanningError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    return InterviewPlanResponse(
        provider=source,
        model=request.planner.model
        or os.environ.get("PLANNER_MODEL")
        or os.environ.get("DEEPSEEK_PLANNER_MODEL", "deepseek-v4-flash"),
        total_duration_seconds=request.total_duration_seconds,
        questions=[
            PlannedQuestionModel(
                id=question.id,
                prompt=question.prompt,
                focus=question.focus,
                follow_up_prompt=question.follow_up_prompt,
                allocated_seconds=question.allocated_seconds,
            )
            for question in questions
        ],
    )


@app.post("/interview/answer")
def submit_answer(request: SubmitAnswerRequest) -> DirectorSessionModel:
    try:
        session = get_active_session(request.session_id)
        next_session = director_engine.submit_answer(session, request.answer)
    except DirectorError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    store_session(request.session_id, next_session)
    return serialize_session(next_session, request.session_id)


@app.post("/interview/end")
def end_interview(request: SessionRequest) -> DirectorSessionModel:
    session = get_active_session(request.session_id)
    ended_session = director_engine.end(session)
    store_session(request.session_id, ended_session)
    return serialize_session(ended_session, request.session_id)


@app.post("/interview/archive")
def archive_interview(request: ArchiveInterviewRequest) -> ArchiveInterviewResponse:
    """Persist one completed interview in the project's fixed records directory."""
    session = get_active_session(request.session_id)
    if session.state not in {InterviewState.COMPLETED, InterviewState.ENDED}:
        raise HTTPException(status_code=409, detail="Only finished interviews can be archived.")
    whiteboard_image: bytes | None = None
    if request.whiteboard:
        try:
            whiteboard_image = base64.b64decode(request.whiteboard.data, validate=True)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Invalid whiteboard image.") from error
        if not whiteboard_image:
            raise HTTPException(status_code=422, detail="Whiteboard image is empty.")
        if len(whiteboard_image) > 10_000_000:
            raise HTTPException(status_code=422, detail="Whiteboard image is too large.")
        if not whiteboard_image.startswith(b"\xff\xd8\xff"):
            raise HTTPException(status_code=422, detail="Whiteboard image is not a JPEG.")

    # Reserve the finished session before writing. This makes concurrent archive
    # requests exactly-once: only one caller can remove the session from the
    # registry. A failed write restores it so the user can retry.
    with sessions_lock:
        reserved_session = sessions.pop(request.session_id, None)
        session_last_seen.pop(request.session_id, None)
    if reserved_session is None:
        raise HTTPException(status_code=404, detail="Interview session not found or expired.")
    session = reserved_session

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    record_id = f"{timestamp}_{uuid4().hex[:8]}"
    record_directory = INTERVIEW_RECORDS_DIRECTORY / record_id
    temporary_directory = INTERVIEW_RECORDS_DIRECTORY / f".{record_id}.tmp"

    try:
        temporary_directory.mkdir(parents=True, exist_ok=False)
        report_payload = request.report.model_dump(mode="json")
        report_payload["answers"] = [
            InterviewAnswerModel(
                question_id=answer.question_id,
                question=answer.question,
                answer=answer.answer,
                kind=answer.kind,
            ).model_dump(mode="json")
            for answer in session.answers
        ]
        archived_evaluation = evaluate_answers(
            tuple(
                AnswerInput(
                    question=answer.question,
                    answer=answer.answer,
                    question_id=answer.question_id,
                    kind=answer.kind,
                )
                for answer in session.answers
            ),
            total_questions=len(session.question_plan or director_engine.questions),
        )
        report_payload["evaluation"] = {
            "rubric_version": archived_evaluation.rubric_version,
            "clarity": archived_evaluation.clarity,
            "specificity": archived_evaluation.specificity,
            "reasoning_depth": archived_evaluation.reasoning_depth,
            "completion": archived_evaluation.completion,
            "overall": archived_evaluation.overall,
            "suggestions": list(archived_evaluation.suggestions),
        }
        report_payload["total_questions"] = len(session.question_plan or director_engine.questions)
        report_payload["answered_questions"] = len(
            {
                answer.question_id
                for answer in session.answers
                if answer.answer.strip()
            }
        )
        report_payload["practice_plan"] = {
            "target_role": request.target_role,
            "focus": request.practice_focus,
            "topics": request.practice_topics,
        }
        write_record_json(temporary_directory / "report.json", report_payload)

        conversation = {
            "submitted_question_answers": [
                {
                    "interviewer": answer.question,
                    "candidate": answer.answer,
                    "kind": answer.kind,
                }
                for answer in session.answers
            ],
            # The browser adds incoming transcript entries to the front of its list.
            # Reverse them here so the saved conversation reads in spoken order.
            "realtime_transcript": [
                item.model_dump(mode="json")
                for item in reversed(request.report.realtime_transcript)
            ],
        }
        write_record_json(temporary_directory / "conversation.json", conversation)
        write_record_json(
            temporary_directory / "plan.json",
            {
                "total_duration_seconds": session.director_config.total_duration_seconds,
                "questions": [
                    {
                        "id": question.id,
                        "prompt": question.prompt,
                        "focus": question.focus,
                        "follow_up_prompt": question.follow_up_prompt,
                        "allocated_seconds": question.allocated_seconds,
                    }
                    for question in session.question_plan
                ],
            },
        )

        whiteboard_saved = False
        if whiteboard_image:
            (temporary_directory / "whiteboard.jpg").write_bytes(whiteboard_image)
            whiteboard_saved = True
        temporary_directory.rename(record_directory)
    except OSError as error:
        shutil.rmtree(temporary_directory, ignore_errors=True)
        store_session(request.session_id, session)
        raise HTTPException(status_code=500, detail="Could not archive interview.") from error
    except Exception:
        shutil.rmtree(temporary_directory, ignore_errors=True)
        store_session(request.session_id, session)
        raise

    return ArchiveInterviewResponse(
        record_id=record_id,
        record_path=str(record_directory),
        whiteboard_saved=whiteboard_saved,
    )


def write_record_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


@app.get("/interview/records")
def list_interview_records() -> list[InterviewRecordSummary]:
    if not INTERVIEW_RECORDS_DIRECTORY.exists():
        return []

    records: list[InterviewRecordSummary] = []
    for record_directory in INTERVIEW_RECORDS_DIRECTORY.iterdir():
        if not record_directory.is_dir() or record_directory.name.startswith("."):
            continue
        try:
            report = read_record_json(record_directory / "report.json")
            practice_plan = report.get("practice_plan", {})
            records.append(
                InterviewRecordSummary(
                    record_id=record_directory.name,
                    completed_at=str(report["completed_at"]),
                    target_role=str(practice_plan.get("target_role", "")),
                    answered_questions=int(report.get("answered_questions", 0)),
                    total_questions=int(report.get("total_questions", 0)),
                    has_whiteboard=(record_directory / "whiteboard.jpg").is_file(),
                )
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            continue
    return sorted(records, key=lambda record: record.completed_at, reverse=True)


@app.get("/interview/records/{record_id}")
def get_interview_record(record_id: str) -> InterviewRecordDetail:
    record_directory = get_record_directory(record_id)
    try:
        report = read_record_json(record_directory / "report.json")
        conversation = read_record_json(record_directory / "conversation.json")
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview record not found.") from error
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=500, detail="Interview record is unreadable.") from error
    try:
        plan = read_record_json(record_directory / "plan.json")
    except FileNotFoundError:
        plan = {"total_duration_seconds": 0, "questions": []}

    return InterviewRecordDetail(
        record_id=record_id,
        report=report,
        conversation=conversation,
        plan=plan,
        has_whiteboard=(record_directory / "whiteboard.jpg").is_file(),
    )


@app.get("/interview/records/{record_id}/whiteboard")
def get_interview_record_whiteboard(record_id: str) -> FileResponse:
    whiteboard_path = get_record_directory(record_id) / "whiteboard.jpg"
    if not whiteboard_path.is_file():
        raise HTTPException(status_code=404, detail="Whiteboard snapshot not found.")
    return FileResponse(whiteboard_path, media_type="image/jpeg")


@app.delete("/interview/records/{record_id}")
def delete_interview_record(record_id: str) -> DeleteInterviewRecordResponse:
    record_directory = get_record_directory(record_id)
    try:
        shutil.rmtree(record_directory)
    except OSError as error:
        raise HTTPException(status_code=500, detail="Could not delete interview record.") from error
    return DeleteInterviewRecordResponse(record_id=record_id, deleted=True)


def get_record_directory(record_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", record_id):
        raise HTTPException(status_code=404, detail="Interview record not found.")
    record_directory = INTERVIEW_RECORDS_DIRECTORY / record_id
    if not record_directory.is_dir():
        raise HTTPException(status_code=404, detail="Interview record not found.")
    return record_directory


def read_record_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as file:
        return json.load(file)


@app.post("/interview/live-control")
def review_live_control(
    request: LiveControlReviewRequest,
) -> LiveControlReviewResponse:
    proposal = request.proposal
    session = get_active_session(request.session_id)
    review = director_engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion=proposal.emotion,
            gesture=proposal.gesture,
            decision=proposal.decision,
            reason=proposal.reason,
            confidence=proposal.confidence,
            follow_up_prompt=proposal.follow_up_prompt,
            candidate_answer=proposal.candidate_answer,
        ),
    )
    reviewed_session = director_engine.apply_live_review(
        session,
        review,
        proposal.follow_up_prompt,
        proposal.candidate_answer,
    )
    approved_whiteboard_actions = validate_whiteboard_actions(proposal, review.approved)
    store_session(request.session_id, reviewed_session)
    return LiveControlReviewResponse(
        approved=review.approved,
        approved_decision=review.approved_decision,
        control=ControlSignalModel(
            emotion=review.control.emotion,
            gesture=review.control.gesture,
            whiteboard_action=review.control.whiteboard_action,
        ),
        attitude=review.attitude,
        pressure=review.pressure,
        reason_code=review.reason_code,
        whiteboard_actions=approved_whiteboard_actions,
        session=serialize_session(reviewed_session, request.session_id),
    )


def validate_whiteboard_actions(
    proposal: LiveInterviewerSignalModel,
    proposal_approved: bool,
) -> list[WhiteboardActionModel]:
    """Approve only bounded, image-relative annotations tied to a relevant model cue."""
    if not proposal_approved or not proposal.whiteboard_actions:
        return []
    if proposal.gesture not in {"look_whiteboard", "take_note"} and proposal.decision != "move_on":
        return []

    approved: list[WhiteboardActionModel] = []
    text_action_used = False
    for action in proposal.whiteboard_actions:
        if action.kind in {"note", "summary"}:
            if text_action_used or not action.text or not action.text.strip():
                continue
            text_action_used = True
        elif action.kind in {"arrow", "line"}:
            if action.toX is None or action.toY is None:
                continue
        elif action.w is None or action.h is None or action.w <= 0.01 or action.h <= 0.01:
            continue
        approved.append(action)
    return approved


@app.get("/voice/providers")
def list_voice_providers() -> list[VoiceProviderModel]:
    return [
        VoiceProviderModel(
            id="openai",
            label="OpenAI Realtime",
            ready=bool(os.environ.get("OPENAI_API_KEY")),
            detail="Uses browser WebRTC and a backend-created client secret.",
        ),
        VoiceProviderModel(
            id="google",
            label="Google Gemini Live",
            ready=bool(os.environ.get("GOOGLE_API_KEY")),
            primary=True,
            detail=(
                "Live audio uses Gemini 3.1 Flash through the Python WebSocket proxy."
            ),
        ),
    ]


@app.post("/realtime/client-secret")
async def create_realtime_client_secret(
    request: RealtimeClientSecretRequest,
) -> RealtimeClientSecretResponse:
    provider = request.provider.lower()

    if provider != "openai":
        raise HTTPException(
            status_code=501,
            detail=f"{provider} voice provider is not implemented by this endpoint.",
        )

    api_key = request.api_key or os.environ.get("OPENAI_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is required to start realtime voice.",
        )

    model = request.model or os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
    # Every new interview starts with the same male-presenting interviewer voice.
    # Do not accept a client-selected voice here: a Realtime voice cannot be changed
    # after the model has produced audio, and consistency matters for the interview.
    voice = "ash"
    payload = build_realtime_session_payload(model=model, voice=voice)

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "OpenAI-Safety-Identifier": "local-interview-simulator",
            },
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail="OpenAI Realtime client secret request failed.",
        )

    data = response.json()
    secret = data.get("value") or data.get("client_secret", {}).get("value")
    expires_at = data.get("expires_at") or data.get("client_secret", {}).get("expires_at")

    if not secret:
        raise HTTPException(
            status_code=502,
            detail="OpenAI Realtime client secret response did not include a token.",
        )

    return RealtimeClientSecretResponse(
        provider="openai",
        value=secret,
        expires_at=expires_at,
        model=model,
        voice=voice,
    )


@app.websocket("/google/live")
async def google_live_proxy(
    browser_socket: WebSocket,
    model: str = "",
) -> None:
    await browser_socket.accept()
    try:
        client_config_message = await asyncio.wait_for(browser_socket.receive_text(), timeout=10)
        client_config = json.loads(client_config_message).get("clientConfig", {})
        browser_api_key = client_config.get("apiKey", "") if isinstance(client_config, dict) else ""
        if not isinstance(browser_api_key, str) or len(browser_api_key) > 500:
            raise ValueError("Invalid API key configuration.")
    except WebSocketDisconnect:
        return
    except (asyncio.TimeoutError, json.JSONDecodeError, ValueError):
        await browser_socket.send_json(
            {"error": {"message": "A valid client configuration is required."}},
        )
        await browser_socket.close(code=1008)
        return

    api_key = browser_api_key or os.environ.get("GOOGLE_API_KEY")

    if not api_key:
        await browser_socket.send_json(
            {"error": {"message": "GOOGLE_API_KEY is required for Gemini Live."}},
        )
        await browser_socket.close(code=1011)
        return

    model = model or os.environ.get(
        "GOOGLE_LIVE_MODEL",
        "gemini-3.1-flash-live-preview",
    )
    # Gemini ephemeral tokens use the documented AQ.* form and must use the
    # v1alpha constrained endpoint with access_token, not the normal API-key URL.
    if api_key.startswith("AQ."):
        google_url = (
            f"{GOOGLE_LIVE_EPHEMERAL_ENDPOINT}?access_token={quote(api_key, safe='')}"
        )
    else:
        google_url = f"{GOOGLE_LIVE_ENDPOINT}?key={quote(api_key, safe='')}"

    try:
        async with websockets.connect(
            google_url,
            open_timeout=20,
            max_size=16 * 1024 * 1024,
            max_queue=16,
        ) as google_socket:
            await google_socket.send(json.dumps(build_google_live_setup(model)))

            async def browser_to_google() -> None:
                while True:
                    message = await browser_socket.receive_text()
                    await google_socket.send(message)

            async def google_to_browser() -> None:
                async for message in google_socket:
                    if isinstance(message, bytes):
                        await browser_socket.send_bytes(message)
                    else:
                        await browser_socket.send_text(message)

            relays = {
                asyncio.create_task(browser_to_google()),
                asyncio.create_task(google_to_browser()),
            }
            _, pending = await asyncio.wait(
                relays,
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*relays, return_exceptions=True)
    except WebSocketDisconnect:
        return
    except Exception as error:
        upstream_message = str(error).lower()
        if "auth token" in upstream_message or "authentication" in upstream_message:
            message = (
                "Gemini Live authentication failed. Use a valid Google AI Studio API key "
                "or a fresh Gemini ephemeral token."
            )
        else:
            message = "Gemini Live connection failed."
        try:
            await browser_socket.send_json({"error": {"message": message}})
            await browser_socket.close(code=1011)
        except RuntimeError:
            return


@app.post("/report/evaluate")
def evaluate_report(request: EvaluateReportRequest) -> EvaluateReportResponse:
    report = evaluate_answers(
        tuple(
            AnswerInput(
                question=answer.question,
                answer=answer.answer,
                question_id=answer.question_id,
                kind=answer.kind,
            )
            for answer in request.answers
        ),
        total_questions=request.total_questions,
    )
    return EvaluateReportResponse(
        rubric_version=report.rubric_version,
        clarity=report.clarity,
        specificity=report.specificity,
        reasoning_depth=report.reasoning_depth,
        completion=report.completion,
        overall=report.overall,
        suggestions=list(report.suggestions),
    )


def get_active_session(session_id: str) -> DirectorSession:
    with sessions_lock:
        now = time.monotonic()
        prune_expired_sessions_locked(now)
        session = sessions.get(session_id)
        if session is not None:
            session_last_seen[session_id] = now
    if session is None:
        raise HTTPException(status_code=404, detail="Interview session not found or expired.")
    return session


def store_session(session_id: str, session: DirectorSession) -> None:
    with sessions_lock:
        sessions[session_id] = session
        session_last_seen[session_id] = time.monotonic()


def serialize_session(session: DirectorSession, session_id: str) -> DirectorSessionModel:
    return DirectorSessionModel(
        session_id=session_id,
        state=session.state,
        question_index=session.question_index,
        current_prompt=session.current_prompt,
        current_focus=session.current_focus,
        attitude=session.attitude,
        pressure=session.pressure,
        control=ControlSignalModel(
            emotion=session.control.emotion,
            gesture=session.control.gesture,
            whiteboard_action=session.control.whiteboard_action,
        ),
        director_config=DirectorConfigModel(
            interviewer_style=session.director_config.interviewer_style,
            initial_pressure=session.director_config.initial_pressure,
            follow_up_depth=session.director_config.follow_up_depth,
            interruption_frequency=session.director_config.interruption_frequency,
            total_duration_seconds=session.director_config.total_duration_seconds,
        ),
        turn_index=session.turn_index,
        answers=[
            InterviewAnswerModel(
                question_id=answer.question_id,
                question=answer.question,
                answer=answer.answer,
                kind=answer.kind,
            )
            for answer in session.answers
        ],
        follow_up_used=list(session.follow_up_used),
        question_plan=[
            PlannedQuestionModel(
                id=question.id,
                prompt=question.prompt,
                focus=question.focus,
                follow_up_prompt=question.follow_up_prompt,
                allocated_seconds=question.allocated_seconds,
            )
            for question in session.question_plan
        ],
    )


def build_realtime_session_payload(model: str, voice: str) -> dict[str, Any]:
    return {
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": (
                "You are a professional interviewer. Ask concise interview "
                "questions, listen carefully, and never become a tutor. Keep "
                "the candidate in an interview setting."
            ),
            "audio": {
                "input": {
                    "transcription": {
                        "model": "gpt-realtime-whisper",
                        "language": "en",
                        "delay": "low",
                    },
                    "turn_detection": {
                        "type": "server_vad",
                    },
                },
                "output": {
                    "voice": voice,
                },
            },
        },
    }


def build_google_live_setup(model: str) -> dict[str, Any]:
    return {
        "setup": {
            "model": f"models/{model}",
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                # The deployed v1beta BidiGenerateContent endpoint accepts the
                # voice configuration inside generationConfig.
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {
                            "voiceName": "Charon",
                        },
                    },
                },
            },
            "inputAudioTranscription": {},
            "outputAudioTranscription": {},
            "tools": [
                {
                    "functionDeclarations": [
                        {
                            "name": "report_interviewer_state",
                            "description": (
                                "Silently report a material change in the interviewer's "
                                "internal reaction and recommended next action."
                            ),
                            "parameters": {
                                "type": "OBJECT",
                                "properties": {
                                    "emotion": {
                                        "type": "STRING",
                                        "enum": [
                                            "neutral",
                                            "attentive",
                                            "curious",
                                            "skeptical",
                                            "unconvinced",
                                            "satisfied",
                                            "firm",
                                        ],
                                    },
                                    "gesture": {
                                        "type": "STRING",
                                        "description": (
                                            "A single, brief visual cue. Use idle by default; "
                                            "do not request a repeating motion."
                                        ),
                                        "enum": [
                                            "idle",
                                            "nod_once",
                                            "think",
                                            "lean_in",
                                            "look_whiteboard",
                                            "take_note",
                                            "pause",
                                        ],
                                    },
                                    "decision": {
                                        "type": "STRING",
                                        "enum": [
                                            "continue",
                                            "follow_up",
                                            "challenge",
                                            "interrupt",
                                            "move_on",
                                        ],
                                    },
                                    "reason": {
                                        "type": "STRING",
                                        "description": (
                                            "A short internal reason. Never say this aloud."
                                        ),
                                    },
                                    "confidence": {
                                        "type": "NUMBER",
                                        "description": "Confidence from 0 to 1.",
                                    },
                                    "follow_up_prompt": {
                                        "type": "STRING",
                                        "description": (
                                            "Required only when decision is follow_up: the exact, "
                                            "concise question to ask next."
                                        ),
                                    },
                                    "candidate_answer": {
                                        "type": "STRING",
                                        "description": (
                                            "Required for move_on: a faithful, concise capture of the "
                                            "candidate's answer for the current planned question."
                                        ),
                                    },
                                    "whiteboard_actions": {
                                        "type": "ARRAY",
                                        "description": "Optional, at most four concise board annotations. Use only for a material error, a helpful transition summary, or when explicitly asked to demonstrate. Never write a full solution.",
                                        "items": {
                                            "type": "OBJECT",
                                            "properties": {
                                                "kind": {"type": "STRING", "enum": ["note", "summary", "arrow", "line", "circle", "highlight"]},
                                                "text": {"type": "STRING"},
                                                "x": {"type": "NUMBER", "description": "0..1 horizontal image coordinate"},
                                                "y": {"type": "NUMBER", "description": "0..1 vertical image coordinate"},
                                                "toX": {"type": "NUMBER", "description": "0..1 horizontal image coordinate"},
                                                "toY": {"type": "NUMBER", "description": "0..1 vertical image coordinate"},
                                                "w": {"type": "NUMBER", "description": "0..1 image-width fraction"},
                                                "h": {"type": "NUMBER", "description": "0..1 image-height fraction"},
                                            },
                                            "required": ["kind", "x", "y"],
                                        },
                                    },
                                },
                                "required": [
                                    "emotion",
                                    "gesture",
                                    "decision",
                                    "reason",
                                    "confidence",
                                ],
                            },
                        },
                    ],
                },
            ],
            "systemInstruction": {
                "parts": [
                    {
                        "text": (
                            "You are a professional technical interviewer with a calm adult "
                            "male interviewer persona and demeanor, not an "
                            "assistant or tutor. You control the room, ask one concise "
                            "question at a time, listen carefully, and keep the exchange "
                            "realistic. Do not give away answers or praise by default. "
                            "After a candidate finishes a turn, respond promptly: either ask "
                            "one concise clarifying question, acknowledge and ask the next "
                            "planned question, or ask them to continue if their answer was cut "
                            "off. Do not remain silent waiting for an internal tool response, "
                            "and do not leave more than a brief conversational beat without "
                            "speaking. "
                            "Judge substance from the candidate's reasoning, assumptions, "
                            "tradeoffs, evidence, and ability to independently complete the "
                            "work—not from answer length. A candidate may reach an imperfect "
                            "final answer while still demonstrating strong thinking; recognize "
                            "that by probing their reasoning rather than supplying the answer. "
                            "When a follow-up would reveal independent thinking or clarify a "
                            "meaningful gap, call report_interviewer_state with decision "
                            "follow_up and a concise follow_up_prompt. The Director permits at "
                            "most one model-requested follow-up per planned question. If the "
                            "candidate is stuck, ask an orienting question about assumptions, "
                            "constraints, or the next validation step; never reveal a solution. "
                            "When the current planned question is sufficiently answered, call "
                            "report_interviewer_state with decision move_on and candidate_answer. "
                            "After approval, state the real progress from the tool result and ask "
                            "exactly the returned currentQuestion; if state is completed, conclude. "
                            "You may receive periodic images of the candidate's "
                            "whiteboard. Read handwritten text, labels, and diagrams as "
                            "the candidate's current working notes.\n\n"
                            "When the whiteboard contains a material mistake, you may include a "
                            "whiteboard_actions proposal in the state report: circle or highlight the "
                            "relevant candidate work in red/yellow and add one short, question-like note. "
                            "Use arrows or lines only to clarify a relationship. At a completed-question "
                            "transition, a short summary annotation is allowed. Never erase candidate work, "
                            "never annotate trivial issues, and never write a full solution. Coordinates and "
                            "sizes are normalized from 0 to 1 relative to the current whiteboard image; only "
                            "annotate areas you can identify.\n\n"
                            "Use report_interviewer_state silently when a completed "
                            "candidate answer or a material whiteboard change changes your "
                            "assessment. For ordinary answers, you may report neutral or "
                            "attentive with continue and gesture idle. Gesture is one brief "
                            "visual cue, never a sustained animation: use nod_once only for "
                            "a clear acknowledgement; think for careful evaluation; lean_in, "
                            "look_whiteboard, take_note, or pause only when directly relevant. "
                            "Choose exactly one gesture. Prefer idle when no visible reaction "
                            "is necessary, and never report a gesture merely to create motion. "
                            "For vague, unsupported, contradictory, technically questionable, "
                            "or unusually strong answers, choose the appropriate emotion and "
                            "decision. Do not call it for audio "
                            "fragments, filler words, ordinary listening, or the initial "
                            "startup instruction.\n\n"
                            "Never read the tool name, arguments, reason, confidence, "
                            "emotion, gesture, or decision aloud. Never tell the candidate "
                            "that an internal state tool exists. The tool reports a "
                            "proposal only; the Director Engine owns the interview. Wait "
                            "for the tool response and follow approved_decision. If the "
                            "Director rejects or downgrades the proposal, comply without "
                            "mentioning that decision to the candidate."
                        ),
                    },
                ],
            },
        },
    }
