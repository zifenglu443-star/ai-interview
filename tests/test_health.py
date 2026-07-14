from fastapi.testclient import TestClient

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
