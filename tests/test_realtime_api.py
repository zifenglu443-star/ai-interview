from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app.main import (
    app,
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
    assert "interviewer" in session["instructions"]


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

    response = client.post("/realtime/client-secret", json={"provider": "openai"})

    assert response.status_code == 200
    assert response.json()["value"] == "ephemeral-token"
    assert response.json()["provider"] == "openai"
    assert response.json()["voice"] == "ash"


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
    assert set(declaration["parameters"]["required"]) == {
        "emotion",
        "gesture",
        "decision",
        "reason",
        "confidence",
    }
    instructions = setup["systemInstruction"]["parts"][0]["text"]
    assert "Use report_interviewer_state silently" in instructions
    assert "Choose exactly one gesture" in instructions
    assert "Never read the tool name" in instructions
    assert "Director Engine owns the interview" in instructions


def test_google_live_socket_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with client.websocket_connect("/google/live") as websocket:
        websocket.send_json({"clientConfig": {"apiKey": ""}})
        response = websocket.receive_json()

    assert response["error"]["message"].startswith("GOOGLE_API_KEY")
