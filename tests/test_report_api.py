from fastapi.testclient import TestClient

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
