import json

from fastapi.testclient import TestClient

from backend.app import main
from backend.app.main import app


client = TestClient(app)


def test_start_interview_api() -> None:
    response = client.post("/interview/start")

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"]
    assert payload["state"] == "asking"
    assert payload["question_index"] == 0
    assert payload["current_prompt"]


def test_start_interview_api_accepts_a_practice_plan() -> None:
    response = client.post(
        "/interview/start",
        json={
            "target_role": "Data Science Intern",
            "practice_focus": "project",
            "practice_topics": "my forecasting project",
            "planned_questions": [
                {
                    "id": "forecasting",
                    "prompt": "Walk me through my forecasting project.",
                    "focus": "Project deep dive",
                    "follow_up_prompt": "How did you validate it?",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_focus"] == "Project deep dive"
    assert payload["current_prompt"] == "Walk me through my forecasting project."


def test_start_interview_api_locks_a_generated_question_plan() -> None:
    response = client.post(
        "/interview/start",
        json={
            "planned_questions": [
                {
                    "id": "one",
                    "prompt": "Explain a difficult system you built.",
                    "focus": "Imported question",
                    "follow_up_prompt": "What was the tradeoff?",
                },
                {
                    "id": "two",
                    "prompt": "How did you measure its impact?",
                    "focus": "Imported question",
                    "follow_up_prompt": "What did the result show?",
                },
            ],
            "director_config": {"total_duration_seconds": 600},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_prompt"] == "Explain a difficult system you built."
    assert [question["prompt"] for question in payload["question_plan"]] == [
        "Explain a difficult system you built.",
        "How did you measure its impact?",
    ]
    assert payload["director_config"]["total_duration_seconds"] == 600


def test_start_rejects_duplicate_planned_question_ids() -> None:
    response = client.post(
        "/interview/start",
        json={
            "planned_questions": [
                {"id": "same", "prompt": "Question one", "focus": "One", "follow_up_prompt": "More one"},
                {"id": "same", "prompt": "Question two", "focus": "Two", "follow_up_prompt": "More two"},
            ]
        },
    )

    assert response.status_code == 422


def test_plan_api_requires_a_configured_text_model(monkeypatch) -> None:
    monkeypatch.delenv("PLANNER_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    response = client.post(
        "/interview/plan",
        json={
            "question_bank": "Explain a cache.\nDiscuss cache invalidation.",
            "total_duration_seconds": 600,
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Planning API key is not configured. Add it in Settings or .env."


def test_plan_provider_preserves_numbered_multiline_questions(monkeypatch) -> None:
    topics = """1. Consider the function
f(x)=x^3-3x. Find the values of k for which f(x)=k has three distinct real solutions.
2. A fair coin is tossed until two consecutive heads appear. Find the expected toss count.
3. Without a calculator, determine which is larger: 2^(100) or 3^(60)."""

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": json.dumps({"questions": [
                {"source_id": "source-1", "id": "one", "prompt": "Rewritten first question."},
                {"source_id": "source-2", "id": "two", "prompt": "Rewritten second question."},
                {"source_id": "source-3", "id": "three", "prompt": "Rewritten third question."},
            ]})}}]}

    monkeypatch.setattr(main.httpx, "post", lambda *_args, **_kwargs: FakeResponse())
    response = client.post(
        "/interview/plan",
        json={"practice_topics": topics, "total_duration_seconds": 900, "planner": {"api_key": "test"}},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "provider"
    assert [question["prompt"] for question in payload["questions"]] == [
        "Consider the function\nf(x)=x^3-3x. Find the values of k for which f(x)=k has three distinct real solutions.",
        "A fair coin is tossed until two consecutive heads appear. Find the expected toss count.",
        "Without a calculator, determine which is larger: 2^(100) or 3^(60).",
    ]
    assert sum(question["allocated_seconds"] for question in payload["questions"]) == 900


def test_plan_rejects_provider_output_that_merges_source_questions(monkeypatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": json.dumps({"questions": [
                {"source_id": "source-1", "id": "merged", "prompt": "Explain both supplied questions."},
            ]})}}]}

    monkeypatch.setattr(main.httpx, "post", lambda *_args, **_kwargs: FakeResponse())
    response = client.post(
        "/interview/plan",
        json={
            "practice_topics": "1. First independent problem.\n2. Second independent problem.",
            "planner": {"api_key": "test"},
        },
    )

    assert response.status_code == 502
    assert "merged, omitted, or added" in response.json()["detail"]


def test_plan_rejects_provider_output_that_reorders_source_questions(monkeypatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": json.dumps({"questions": [
                {"source_id": "source-2", "id": "two", "prompt": "Second."},
                {"source_id": "source-1", "id": "one", "prompt": "First."},
            ]})}}]}

    monkeypatch.setattr(main.httpx, "post", lambda *_args, **_kwargs: FakeResponse())
    response = client.post(
        "/interview/plan",
        json={
            "question_bank": "First question.\nSecond question.",
            "planner": {"api_key": "test"},
        },
    )

    assert response.status_code == 502
    assert "duplicated or reordered" in response.json()["detail"]


def test_plan_preserves_a_single_numbered_question_with_continuation(monkeypatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": json.dumps({"questions": [
                {"source_id": "source-1", "id": "one", "prompt": "Changed by provider."},
            ]})}}]}

    monkeypatch.setattr(main.httpx, "post", lambda *_args, **_kwargs: FakeResponse())
    response = client.post(
        "/interview/plan",
        json={
            "question_bank": "1. Solve the equation\nx^2 - 1 = 0",
            "planner": {"api_key": "test"},
        },
    )

    assert response.status_code == 200
    assert response.json()["questions"][0]["prompt"] == "Solve the equation\nx^2 - 1 = 0"


def test_plan_preserves_question_text_after_a_bare_number_marker(monkeypatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": json.dumps({"questions": [
                {"source_id": "source-1", "id": "one", "prompt": "Changed by provider."},
            ]})}}]}

    monkeypatch.setattr(main.httpx, "post", lambda *_args, **_kwargs: FakeResponse())
    response = client.post(
        "/interview/plan",
        json={
            "question_bank": "1.\nExplain the invariant.\nInclude the proof.",
            "planner": {"api_key": "test"},
        },
    )

    assert response.status_code == 200
    assert response.json()["questions"][0]["prompt"] == "Explain the invariant.\nInclude the proof."


def test_plan_rejects_empty_numbered_questions_before_calling_provider(monkeypatch) -> None:
    monkeypatch.setattr(
        main.httpx,
        "post",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider should not be called")),
    )
    response = client.post(
        "/interview/plan",
        json={
            "question_bank": "1.\n2. A real question.",
            "planner": {"api_key": "test"},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Numbered questions cannot be empty."


def test_plan_rejects_more_than_twenty_source_items(monkeypatch) -> None:
    monkeypatch.setattr(
        main.httpx,
        "post",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider should not be called")),
    )
    response = client.post(
        "/interview/plan",
        json={
            "practice_topics": "\n".join(f"Topic {index}" for index in range(21)),
            "planner": {"api_key": "test"},
        },
    )

    assert response.status_code == 422
    assert "more than 20" in response.json()["detail"]


def test_start_requires_a_generated_plan_for_supplied_topics() -> None:
    response = client.post(
        "/interview/start",
        json={
            "practice_topics": "1. First solve this.\nwith a continuation.\n2. Then compare the alternatives.",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Generate a text-model interview plan before starting this interview."


def test_plan_api_accepts_browser_planner_settings(monkeypatch) -> None:
    monkeypatch.delenv("PLANNER_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "questions": [
                                        {
                                            "source_id": "source-1",
                                            "id": "browser-plan",
                                            "prompt": "Explain your approach.",
                                            "focus": "Reasoning",
                                            "follow_up_prompt": "What would you validate?",
                                            "allocated_seconds": 600,
                                        }
                                    ]
                                }
                            )
                        }
                    }
                ]
            }

    def fake_post(endpoint: str, **kwargs: object) -> FakeResponse:
        captured["endpoint"] = endpoint
        captured["headers"] = kwargs["headers"]
        captured["json"] = kwargs["json"]
        return FakeResponse()

    monkeypatch.setattr(main.httpx, "post", fake_post)
    response = client.post(
        "/interview/plan",
        json={
            "total_duration_seconds": 600,
            "planner": {
                "api_key": "browser-key",
                "endpoint": "https://planner.example/v1/chat/completions",
                "model": "planning-model",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "provider"
    assert response.json()["model"] == "planning-model"
    assert captured["endpoint"] == "https://planner.example/v1/chat/completions"
    assert captured["headers"] == {
        "Authorization": "Bearer browser-key",
        "Content-Type": "application/json",
    }
    prompt = captured["json"]["messages"][1]["content"]  # type: ignore[index]
    assert "Return exactly one question for every source_item" in prompt
    assert "Never merge, omit, duplicate, or reorder source items" in prompt
    assert '"source_id": "source-1"' in prompt


def test_plan_api_rejects_non_https_browser_planner_endpoint() -> None:
    response = client.post(
        "/interview/plan",
        json={
            "planner": {
                "api_key": "browser-key",
                "endpoint": "http://127.0.0.1:8000/unsafe",
                "model": "planning-model",
            }
        },
    )

    assert response.status_code == 422


def test_start_interview_api_locks_the_director_configuration() -> None:
    response = client.post(
        "/interview/start",
        json={
            "director_config": {
                "interviewer_style": "strict",
                "initial_pressure": "high",
                "follow_up_depth": "deep",
                "interruption_frequency": "high",
            }
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["attitude"] == "firm"
    assert payload["pressure"] == "high"
    assert payload["director_config"] == {
        "interviewer_style": "strict",
        "initial_pressure": "high",
        "follow_up_depth": "deep",
        "interruption_frequency": "high",
        "total_duration_seconds": 900,
    }


def test_answer_api_moves_state_forward() -> None:
    start_response = client.post("/interview/start")
    session = start_response.json()

    answer_response = client.post(
        "/interview/answer",
        json={
            "session_id": session["session_id"],
            "answer": (
                "This answer has enough specific detail and context to avoid "
                "a follow up question."
            ),
        },
    )

    assert answer_response.status_code == 200
    payload = answer_response.json()
    assert payload["state"] == "asking"
    assert payload["question_index"] == 1
    assert len(payload["answers"]) == 1


def test_live_control_is_reviewed_by_director() -> None:
    session = client.post("/interview/start").json()

    response = client.post(
        "/interview/live-control",
        json={
            "session_id": session["session_id"],
            "proposal": {
                "emotion": "skeptical",
                "gesture": "look_whiteboard",
                "decision": "challenge",
                "reason": "The candidate skipped an important justification.",
                "confidence": 0.9,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["approved"] is True
    assert payload["approved_decision"] == "challenge"
    assert payload["control"]["emotion"] == "skeptical"
    assert payload["control"]["whiteboard_action"] == "inspect_whiteboard"
    assert payload["session"]["control"]["gesture"] == "look_whiteboard"
    assert payload["session"]["pressure"] == "medium"


def test_live_control_validates_whiteboard_annotations() -> None:
    session = client.post("/interview/start").json()
    response = client.post(
        "/interview/live-control",
        json={
            "session_id": session["session_id"],
            "proposal": {
                "emotion": "skeptical",
                "gesture": "look_whiteboard",
                "decision": "challenge",
                "reason": "A material diagram error needs clarification.",
                "confidence": 0.9,
                "whiteboard_actions": [
                    {"kind": "circle", "x": 0.2, "y": 0.3, "w": 0.2, "h": 0.1},
                    {"kind": "note", "text": "What happens on failover?", "x": 0.5, "y": 0.4},
                ],
            },
        },
    )

    assert response.status_code == 200
    assert [action["kind"] for action in response.json()["whiteboard_actions"]] == ["circle", "note"]


def test_live_control_rejects_out_of_range_whiteboard_coordinates() -> None:
    session = client.post("/interview/start").json()
    response = client.post(
        "/interview/live-control",
        json={
            "session_id": session["session_id"],
            "proposal": {
                "emotion": "skeptical",
                "gesture": "look_whiteboard",
                "decision": "challenge",
                "reason": "Invalid coordinate.",
                "confidence": 0.9,
                "whiteboard_actions": [
                    {"kind": "circle", "x": 1.5, "y": 0.3, "w": 0.2, "h": 0.1}
                ],
            },
        },
    )

    assert response.status_code == 422


def test_live_control_can_request_one_model_authored_follow_up() -> None:
    session = client.post("/interview/start").json()

    response = client.post(
        "/interview/live-control",
        json={
            "session_id": session["session_id"],
            "proposal": {
                "emotion": "curious",
                "gesture": "lean_in",
                "decision": "follow_up",
                "reason": "The tradeoff needs clarification.",
                "confidence": 0.9,
                "follow_up_prompt": "What tradeoff did you make, and how did you validate it?",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["state"] == "follow_up"
    assert payload["session"]["current_prompt"] == "What tradeoff did you make, and how did you validate it?"


def test_live_control_move_on_advances_real_progress_with_voice_answer() -> None:
    session = client.post("/interview/start").json()
    response = client.post(
        "/interview/live-control",
        json={
            "session_id": session["session_id"],
            "proposal": {
                "emotion": "attentive",
                "gesture": "nod_once",
                "decision": "move_on",
                "reason": "The current question is sufficiently answered.",
                "confidence": 0.95,
                "candidate_answer": "I compared alternatives, stated the tradeoff, and described how I validated it.",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["approved_decision"] == "move_on"
    assert payload["session"]["question_index"] == 1
    assert payload["session"]["answers"][0]["kind"] == "voice"


def test_live_control_rejects_unknown_values() -> None:
    session = client.post("/interview/start").json()

    response = client.post(
        "/interview/live-control",
        json={
            "session_id": session["session_id"],
            "proposal": {
                "emotion": "furious",
                "gesture": "throw_laptop",
                "decision": "challenge",
                "reason": "Invalid model output.",
                "confidence": 0.9,
            },
        },
    )

    assert response.status_code == 422


def test_archive_rejects_unbounded_transcript_history() -> None:
    response = client.post(
        "/interview/archive",
        json={
            "report": {
                "completed_at": "2026-07-13T10:00:00Z",
                "total_questions": 0,
                "answered_questions": 0,
                "answers": [],
                "realtime_transcript": [
                    {"id": str(index), "speaker": "candidate", "text": "answer"}
                    for index in range(201)
                ],
            }
        },
    )

    assert response.status_code == 422


def test_archive_rejects_invalid_completion_timestamp() -> None:
    response = client.post(
        "/interview/archive",
        json={
            "session_id": "missing-session",
            "report": {
                "completed_at": "not-a-date",
                "total_questions": 0,
                "answered_questions": 0,
                "answers": [],
                "realtime_transcript": [],
            },
        },
    )

    assert response.status_code == 422


def test_archive_interview_writes_report_conversation_and_whiteboard(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "INTERVIEW_RECORDS_DIRECTORY", tmp_path)
    session = client.post("/interview/start").json()
    assert client.post(
        "/interview/answer",
        json={
            "session_id": session["session_id"],
            "answer": "I improved the onboarding flow with clearer guidance for new users.",
        },
    ).status_code == 200
    assert client.post("/interview/end", json={"session_id": session["session_id"]}).status_code == 200

    response = client.post(
        "/interview/archive",
        json={
            "session_id": session["session_id"],
            "report": {
                "completed_at": "2026-07-13T10:00:00Z",
                "total_questions": 5,
                "answered_questions": 1,
                "answers": [
                    {
                        "question_id": "question-1",
                        "question": "Tell me about a project.",
                        "answer": "I improved the onboarding flow.",
                    }
                ],
                "realtime_transcript": [
                    {"id": "new", "speaker": "interviewer", "text": "Thank you."},
                    {"id": "old", "speaker": "candidate", "text": "My answer."},
                ],
            },
            "target_role": "Software Engineering Intern",
            "practice_focus": "technical",
            "practice_topics": "data structures",
            "whiteboard": {
                "data": "/9j/2Q==",
                "mime_type": "image/jpeg",
                "width": 1,
                "height": 1,
            },
        },
    )

    assert response.status_code == 200
    record_directory = tmp_path / response.json()["record_id"]
    assert (record_directory / "report.json").exists()
    assert (record_directory / "conversation.json").exists()
    assert (record_directory / "plan.json").exists()
    assert (record_directory / "whiteboard.jpg").read_bytes() == b"\xff\xd8\xff\xd9"

    report = json.loads((record_directory / "report.json").read_text())
    assert report["evaluation"]["rubric_version"] == "local-heuristic-v2"
    assert report["evaluation"]["completion"] == 20
    assert session["session_id"] not in main.sessions

    conversation = json.loads((record_directory / "conversation.json").read_text())
    assert conversation["realtime_transcript"][0]["id"] == "old"

    summaries = client.get("/interview/records")
    assert summaries.status_code == 200
    assert summaries.json()[0]["record_id"] == record_directory.name

    detail = client.get(f"/interview/records/{record_directory.name}")
    assert detail.status_code == 200
    assert detail.json()["conversation"]["submitted_question_answers"][0]["candidate"]

    whiteboard = client.get(f"/interview/records/{record_directory.name}/whiteboard")
    assert whiteboard.status_code == 200
    assert whiteboard.content == b"\xff\xd8\xff\xd9"

    duplicate_archive = client.post(
        "/interview/archive",
        json={
            "session_id": session["session_id"],
            "report": {
                "completed_at": "2026-07-13T10:00:00Z",
                "total_questions": 1,
                "answered_questions": 1,
                "answers": [],
            },
        },
    )
    assert duplicate_archive.status_code == 404

    deleted = client.delete(f"/interview/records/{record_directory.name}")
    assert deleted.status_code == 200
    assert deleted.json() == {"record_id": record_directory.name, "deleted": True}
    assert not record_directory.exists()


def test_archive_failure_restores_session_and_removes_partial_record(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "INTERVIEW_RECORDS_DIRECTORY", tmp_path)
    original_write_record_json = main.write_record_json

    def fail_on_conversation(path, payload) -> None:
        if path.name == "conversation.json":
            raise OSError("simulated disk failure")
        original_write_record_json(path, payload)

    monkeypatch.setattr(main, "write_record_json", fail_on_conversation)
    session = client.post("/interview/start").json()
    assert client.post("/interview/end", json={"session_id": session["session_id"]}).status_code == 200

    response = client.post(
        "/interview/archive",
        json={
            "session_id": session["session_id"],
            "report": {
                "completed_at": "2026-07-13T10:00:00Z",
                "total_questions": 0,
                "answered_questions": 0,
                "answers": [],
            },
        },
    )

    assert response.status_code == 500
    assert session["session_id"] in main.sessions
    assert list(tmp_path.iterdir()) == []


def test_archive_rejects_non_jpeg_whiteboard_without_consuming_session(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "INTERVIEW_RECORDS_DIRECTORY", tmp_path)
    session = client.post("/interview/start").json()
    assert client.post("/interview/end", json={"session_id": session["session_id"]}).status_code == 200

    response = client.post(
        "/interview/archive",
        json={
            "session_id": session["session_id"],
            "report": {
                "completed_at": "2026-07-13T10:00:00Z",
                "total_questions": 0,
                "answered_questions": 0,
                "answers": [],
            },
            "whiteboard": {
                "data": "bm90LWEtanBlZw==",
                "mime_type": "image/jpeg",
                "width": 1,
                "height": 1,
            },
        },
    )

    assert response.status_code == 422
    assert session["session_id"] in main.sessions


def test_record_list_hides_in_progress_atomic_archive_directory(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "INTERVIEW_RECORDS_DIRECTORY", tmp_path)
    partial = tmp_path / ".2026-07-15T00-00-00Z_partial.tmp"
    partial.mkdir()
    (partial / "report.json").write_text(
        json.dumps(
            {
                "completed_at": "2026-07-15T00:00:00Z",
                "answered_questions": 1,
                "total_questions": 4,
            }
        )
    )

    response = client.get("/interview/records")

    assert response.status_code == 200
    assert response.json() == []


def test_answer_uses_server_session_id() -> None:
    session = client.post("/interview/start").json()
    response = client.post(
        "/interview/answer",
        json={
            "session_id": session["session_id"],
            "answer": "This answer is detailed enough to advance directly to the next interview question without a follow up.",
        },
    )

    assert response.status_code == 200
    assert response.json()["question_index"] == 1
