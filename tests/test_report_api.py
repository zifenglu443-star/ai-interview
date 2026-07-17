import json

from fastapi.testclient import TestClient

from backend.app import main
from backend.app.main import app


client = TestClient(app)


def test_report_evaluate_api() -> None:
    response = client.post(
        "/report/evaluate",
        json={
            "total_questions": 4,
            "answers": [
                {
                    "question_id": "question-1",
                    "question": "Tell me about a project.",
                    "answer": (
                        "I led a team project because users needed faster setup, "
                        "measured impact, and improved the result with data."
                    ),
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["overall"] > 0
    assert payload["rubric_version"] == "local-heuristic-v2"
    assert payload["reasoning_depth"] > 0
    assert payload["completion"] == 25
    assert payload["suggestions"]


def test_report_evaluate_marks_empty_evidence_without_calling_text_model(monkeypatch) -> None:
    def unexpected_post(*args, **kwargs):
        raise AssertionError("Text model must not be called without answer evidence")

    monkeypatch.setattr(main.httpx, "post", unexpected_post)
    response = client.post(
        "/report/evaluate",
        json={
            "total_questions": 2,
            "answers": [
                {"question_id": "q1", "question": "First?", "answer": ""},
                {"question_id": "q2", "question": "Second?", "answer": "   "},
            ],
            "prefer_text_model": True,
            "planner": {
                "api_key": "configured-key",
                "endpoint": "https://planner.example/chat/completions",
                "model": "existing-text-model",
            },
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "rubric_version": "local-heuristic-v2",
        "clarity": 0,
        "specificity": 0,
        "reasoning_depth": 0,
        "completion": 0,
        "overall": 0,
        "suggestions": ["No scorable candidate answer was provided."],
        "sufficient_evidence": False,
    }


def test_report_evaluate_uses_existing_text_model_as_final_quality_rater(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class MockResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "choices": [{"message": {"content": json.dumps({
                    "clarity": 81,
                    "specificity": 77,
                    "reasoning_depth": 86,
                    "overall_quality": 83,
                    "suggestions": ["State the validation result more precisely."],
                })}}],
            }

    def fake_post(endpoint, **kwargs):
        captured["endpoint"] = endpoint
        captured["json"] = kwargs["json"]
        return MockResponse()

    monkeypatch.setattr(main.httpx, "post", fake_post)
    response = client.post(
        "/report/evaluate",
        json={
            "total_questions": 2,
            "answers": [{
                "question_id": "q1",
                "question": "Explain the tradeoff.",
                "answer": "I compared latency and consistency, then validated the choice with data.",
            }],
            "prefer_text_model": True,
            "planner": {
                "api_key": "configured-key",
                "endpoint": "https://planner.example/chat/completions",
                "model": "existing-text-model",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["rubric_version"] == "text-model-v1:existing-text-model"
    assert payload["clarity"] == 81
    assert payload["specificity"] == 77
    assert payload["reasoning_depth"] == 86
    assert payload["completion"] == 50
    assert payload["sufficient_evidence"] is True
    assert captured["endpoint"] == "https://planner.example/chat/completions"
    upstream = captured["json"]
    assert isinstance(upstream, dict)
    system_prompt = upstream["messages"][0]["content"]
    assert "separate task from the hidden live progress verifier" in system_prompt
    assert "never alter interview state" in system_prompt
    user_prompt = upstream["messages"][1]["content"]
    assert "candidate_answer_summaries" in user_prompt
    assert "Explain the tradeoff." in user_prompt
