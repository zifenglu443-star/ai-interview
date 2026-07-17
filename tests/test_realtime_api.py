from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app.main import (
    app,
    build_interviewer_behavior_instruction,
    build_interviewer_system_instruction,
    build_google_live_setup,
    build_realtime_session_payload,
)


client = TestClient(app)


def test_realtime_client_secret_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post("/realtime/client-secret", json={"provider": "openai"})

    assert response.status_code == 503


def test_voice_providers_include_supported_models_only() -> None:
    response = client.get("/voice/providers")

    assert response.status_code == 200
    providers = {provider["id"]: provider for provider in response.json()}
    assert providers["google"]["primary"] is True
    assert providers["google"]["label"] == "Google Gemini Live"
    assert set(providers) == {"openai", "google"}


def test_non_openai_realtime_provider_is_explicitly_not_implemented() -> None:
    response = client.post("/realtime/client-secret", json={"provider": "google"})

    assert response.status_code == 501


def test_realtime_session_payload_is_interviewer_voice_session() -> None:
    payload = build_realtime_session_payload(model="gpt-realtime-2.1", voice="marin")
    session = payload["session"]

    assert session["type"] == "realtime"
    assert session["model"] == "gpt-realtime-2.1"
    assert session["audio"]["output"]["voice"] == "marin"
    assert session["audio"]["input"]["transcription"]["model"] == "gpt-realtime-whisper"
    assert session["audio"]["input"]["turn_detection"] == {
        "type": "semantic_vad",
        "eagerness": "auto",
        "create_response": True,
        "interrupt_response": True,
    }
    assert "interviewer" in session["instructions"]
    assert "wait for the candidate's attempt" in session["instructions"]
    assert "must never use move_on" in session["instructions"]
    assert "explain_current" in session["instructions"]
    assert "move_on_after_explanation" in session["instructions"]
    assert "question_completion_percentage" in session["instructions"]
    assert "one of two equally important parts is answered" in session["instructions"]
    assert "normally no more than 25 spoken words total" in session["instructions"]
    assert "stop speaking immediately and listen" in session["instructions"]
    assert "First call report_interviewer_state exactly once" in session["instructions"]
    assert "Never bypass this review with a direct reply" in session["instructions"]
    assert "at most one follow_up total" in session["instructions"]
    assert session["output_modalities"] == ["audio"]
    assert session["tool_choice"] == "auto"
    tool = session["tools"][0]
    assert tool["type"] == "function"
    assert tool["name"] == "report_interviewer_state"
    assert "Required exactly once after every completed candidate turn" in tool["description"]
    assert "move_on" in tool["parameters"]["properties"]["decision"]["enum"]
    assert "explain_current" in tool["parameters"]["properties"]["decision"]["enum"]
    assert "move_on_after_explanation" in tool["parameters"]["properties"]["decision"]["enum"]
    assert tool["parameters"]["properties"]["answer_status"]["enum"] == [
        "substantive",
        "partial",
        "non_answer",
        "off_topic",
        "uncertain",
    ]
    assert tool["parameters"]["properties"]["question_completion_percentage"] == {
        "type": "integer",
        "minimum": 0,
        "maximum": 100,
        "description": (
            "Completion of the entire original planned question under the locked expected "
            "reasoning depth. Score all explicit subparts; one of two equal parts is at "
            "most 50 and insufficient reasoning depth is at most 85."
        ),
    }
    assert {
        "reasoning_depth_achieved",
        "question_completion_percentage",
        "covered_requirements",
        "missing_requirements",
    }.issubset(tool["parameters"]["required"])


def test_style_pressure_and_reasoning_depth_are_shared_without_topic_mutation() -> None:
    behavior = build_interviewer_behavior_instruction("strict", "high", "deep")
    openai_instructions = build_realtime_session_payload(
        "gpt-realtime-2.1",
        "ash",
        interviewer_style="strict",
        initial_pressure="high",
        follow_up_depth="deep",
    )["session"]["instructions"]
    google_instructions = build_google_live_setup(
        "gemini-3.1-flash-live-preview",
        interviewer_style="strict",
        initial_pressure="high",
        follow_up_depth="deep",
    )["setup"]["systemInstruction"]["parts"][0]["text"]

    assert "terse, formal tone" in behavior
    assert "brisk pacing" in behavior
    assert "Expected reasoning depth is deep" in behavior
    assert "why the key steps work" in behavior
    assert "must never add, remove, reorder, rewrite, skip, or replace planned questions" in behavior
    assert behavior in openai_instructions
    assert openai_instructions == google_instructions


def test_realtime_client_secret_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    class MockResponse:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {"value": "ephemeral-token", "expires_at": 123456}

    class MockAsyncClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self) -> "MockAsyncClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        post = AsyncMock(return_value=MockResponse())

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", MockAsyncClient)

    response = client.post(
        "/realtime/client-secret",
        json={
            "provider": "openai",
            "interviewer_style": "strict",
            "initial_pressure": "high",
        },
    )

    assert response.status_code == 200
    assert response.json()["value"] == "ephemeral-token"
    assert response.json()["provider"] == "openai"
    assert response.json()["voice"] == "ash"
    upstream_payload = MockAsyncClient.post.await_args.kwargs["json"]
    assert "Locked interviewer style: strict" in upstream_payload["session"]["instructions"]
    assert "Locked initial pressure: high" in upstream_payload["session"]["instructions"]


def test_google_live_setup_uses_audio_and_transcription() -> None:
    payload = build_google_live_setup("gemini-3.1-flash-live-preview")
    setup = payload["setup"]

    assert setup["model"] == "models/gemini-3.1-flash-live-preview"
    assert setup["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert (
        setup["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"]
        == "Charon"
    )
    assert setup["inputAudioTranscription"] == {}
    assert setup["outputAudioTranscription"] == {}
    assert setup["realtimeInputConfig"] == {
        "automaticActivityDetection": {
            "disabled": False,
            "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
            "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
            "prefixPaddingMs": 40,
            "silenceDurationMs": 700,
        },
    }
    assert setup["contextWindowCompression"] == {"slidingWindow": {}}
    assert setup["sessionResumption"] == {}
    assert setup["systemInstruction"]["parts"][0]["text"] == build_interviewer_system_instruction()
    assert setup["systemInstruction"]["parts"][0]["text"] == build_realtime_session_payload(
        "gpt-realtime-2.1", "ash"
    )["session"]["instructions"]
    assert "interviewer" in setup["systemInstruction"]["parts"][0]["text"]
    assert "whiteboard" in setup["systemInstruction"]["parts"][0]["text"]
    declaration = setup["tools"][0]["functionDeclarations"][0]
    assert declaration["name"] == "report_interviewer_state"
    assert set(declaration["parameters"]["properties"]["gesture"]["enum"]) == {
        "idle",
        "nod_once",
        "think",
        "lean_in",
        "look_whiteboard",
        "take_note",
        "pause",
    }
    assert declaration["parameters"]["properties"]["answer_status"]["enum"] == [
        "substantive",
        "partial",
        "non_answer",
        "off_topic",
        "uncertain",
    ]
    assert declaration["parameters"]["properties"]["reasoning_depth_achieved"]["enum"] == [
        "none",
        "answer",
        "linked_reasoning",
        "principled_reasoning",
    ]
    assert set(declaration["parameters"]["required"]) == {
        "emotion",
        "gesture",
        "decision",
        "reason",
        "confidence",
        "answer_status",
        "reasoning_depth_achieved",
        "question_completion_percentage",
        "covered_requirements",
        "missing_requirements",
    }
    instructions = setup["systemInstruction"]["parts"][0]["text"]
    assert "silently call report_interviewer_state" in instructions
    assert "exactly one brief gesture" in instructions
    assert "Never mention the tool" in instructions
    assert "Director approval" in instructions
    assert "normally no more than 25 spoken words total" in instructions
    assert "Never bypass this review with a direct reply" in instructions


def test_google_live_setup_accepts_session_resumption_handle() -> None:
    setup = build_google_live_setup(
        "gemini-3.1-flash-live-preview",
        "resume-token",
    )["setup"]

    assert setup["sessionResumption"] == {"handle": "resume-token"}


def test_google_live_socket_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with client.websocket_connect("/google/live") as websocket:
        websocket.send_json({"clientConfig": {"apiKey": ""}})
        response = websocket.receive_json()

    assert response["error"]["message"].startswith("GOOGLE_API_KEY")
