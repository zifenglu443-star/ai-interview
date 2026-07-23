from fastapi.testclient import TestClient

from backend.app import main
from backend.app.main import app, health


client = TestClient(app)


def test_health() -> None:
    assert health() == {"status": "ok"}


def test_frontend_origin_on_port_3001_is_allowed() -> None:
    response = client.options(
        "/interview/start",
        headers={
            "Origin": "http://127.0.0.1:3001",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3001"
    assert "access-control-allow-credentials" not in response.headers


def test_configuration_status_never_exposes_secrets(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "top-secret-openai")
    monkeypatch.setenv("GOOGLE_API_KEY", "top-secret-google")
    monkeypatch.setenv("PLANNER_API_KEY", "top-secret-planner")

    response = client.get("/configuration/status")

    assert response.status_code == 200
    assert response.json()["openai"]["ready"] is True
    assert response.json()["google"]["ready"] is True
    assert response.json()["planner"]["ready"] is True
    assert "top-secret" not in response.text


def test_local_configuration_form_writes_env_without_echoing_secret(
    monkeypatch,
    tmp_path,
    caplog,
) -> None:
    environment_file = tmp_path / ".env"
    monkeypatch.setattr(main, "ENV_FILE_PATH", environment_file)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post(
        "/configuration/provider",
        headers={"Origin": "http://127.0.0.1:3001"},
        json={
            "provider": "openai",
            "api_key": "openai-secret-for-test",
            "model": "gpt-realtime-2.1",
        },
    )

    assert response.status_code == 200
    assert response.json()["openai"]["ready"] is True
    assert "openai-secret-for-test" not in response.text
    assert "openai-secret-for-test" not in caplog.text
    assert "OPENAI_API_KEY=openai-secret-for-test" in environment_file.read_text()
    assert environment_file.stat().st_mode & 0o777 == 0o600


def test_configuration_form_rejects_non_local_origin(monkeypatch, tmp_path) -> None:
    environment_file = tmp_path / ".env"
    monkeypatch.setattr(main, "ENV_FILE_PATH", environment_file)

    response = client.post(
        "/configuration/provider",
        headers={"Origin": "https://malicious.example"},
        json={
            "provider": "google",
            "api_key": "google-secret-for-test",
            "model": "gemini-3.1-flash-live-preview",
        },
    )

    assert response.status_code == 403
    assert not environment_file.exists()


def test_configuration_form_validates_planner_endpoint(
    monkeypatch,
    tmp_path,
) -> None:
    environment_file = tmp_path / ".env"
    monkeypatch.setattr(main, "ENV_FILE_PATH", environment_file)

    response = client.post(
        "/configuration/provider",
        headers={"Origin": "http://localhost:3001"},
        json={
            "provider": "planner",
            "api_key": "planner-secret-for-test",
            "model": "deepseek-v4-flash",
            "endpoint": "http://insecure.example/v1",
        },
    )

    assert response.status_code == 422
    assert not environment_file.exists()


def test_rate_limit_rejects_request_bursts(monkeypatch) -> None:
    monkeypatch.setattr(main, "API_RATE_LIMIT_PER_MINUTE", 1)
    monkeypatch.setattr(main, "rate_limit_buckets", {})

    assert client.get("/voice/providers").status_code == 200
    response = client.get("/voice/providers")

    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"


def test_upstream_rate_limit_retries_are_short_and_bounded(monkeypatch) -> None:
    calls = []
    delays = []

    class RateLimitedResponse:
        status_code = 429
        headers = {"Retry-After": "100"}

    def fake_post(*_args, **_kwargs):
        calls.append(True)
        return RateLimitedResponse()

    monkeypatch.setattr(main.httpx, "post", fake_post)
    monkeypatch.setattr(main.time, "sleep", delays.append)

    response = main.post_model_request(
        "https://planner.example/v1/chat/completions",
        headers={},
        json={},
        timeout=1,
    )

    assert response.status_code == 429
    assert len(calls) == main.MAX_PROVIDER_RATE_LIMIT_RETRIES + 1
    assert delays == [5, 5]
