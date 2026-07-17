"""Verify the local Gemini Live proxy setup and hidden control tool round trip."""

import asyncio
import json
import os
from argparse import ArgumentParser
from urllib.parse import urlparse

import httpx
import websockets


async def main(
    exercise_tool: bool,
    exercise_opening: bool,
    exercise_resumption: bool,
    base_url: str,
) -> None:
    parsed = urlparse(base_url)
    websocket_scheme = "wss" if parsed.scheme == "https" else "ws"
    websocket_url = f"{websocket_scheme}://{parsed.netloc}/google/live"
    resumption_handle = ""
    async with websockets.connect(websocket_url) as socket:
        # The proxy requires this configuration frame before it opens the
        # upstream provider socket. An empty value intentionally selects the
        # backend's GOOGLE_API_KEY fallback without putting a key in the URL.
        await socket.send(
            json.dumps(
                {"clientConfig": {"apiKey": os.environ.get("GOOGLE_API_KEY", "")}}
            )
        )
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))

        if "setupComplete" not in message:
            raise RuntimeError(f"Gemini Live did not accept setup: {message}")

        if exercise_tool:
            await verify_tool_round_trip(socket, base_url)
        if exercise_opening:
            await verify_opening_response(socket)
        if exercise_resumption:
            resumption_handle = await receive_resumption_handle(socket)

    if resumption_handle:
        await verify_resumed_connection(websocket_url, resumption_handle)

    print("Gemini Live setup accepted.")


async def receive_resumption_handle(socket: websockets.ClientConnection) -> str:
    await socket.send(
        json.dumps(
            {
                "realtimeInput": {
                    "text": "Connection test only. Reply with the single word ready."
                }
            }
        )
    )
    for _ in range(10):
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))
        update = message.get("sessionResumptionUpdate", {})
        if update.get("resumable") and update.get("newHandle"):
            return update["newHandle"]
    raise RuntimeError("Gemini Live did not provide a resumable session handle.")


async def verify_resumed_connection(websocket_url: str, handle: str) -> None:
    async with websockets.connect(websocket_url) as socket:
        await socket.send(
            json.dumps(
                {
                    "clientConfig": {
                        "apiKey": os.environ.get("GOOGLE_API_KEY", ""),
                        "resumptionHandle": handle,
                    }
                }
            )
        )
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))
        if "setupComplete" not in message:
            raise RuntimeError(f"Gemini Live did not resume setup: {message}")
    print("Gemini Live session resumption accepted.")


async def verify_tool_round_trip(
    socket: websockets.ClientConnection,
    base_url: str,
) -> None:
    await socket.send(
        json.dumps(
            {
                "realtimeInput": {
                    "text": (
                        "Interview control test. Ask this planned question exactly, then stop "
                        "and wait for the candidate: If an algorithm compares every pair of "
                        "elements in an array of size n, what is its time complexity, and why?"
                    )
                }
            }
        )
    )
    await wait_for_completed_model_turn(socket)

    await socket.send(
        json.dumps(
            {
                "realtimeInput": {
                    "text": (
                        "[APPLICATION_CONTROL_NOT_CANDIDATE] The candidate turn is complete. "
                        "Before any spoken reply, call report_interviewer_state exactly once. "
                        "The candidate answered: I will compare every element with every other "
                        "element, but the algorithm is still O(n)."
                    )
                }
            }
        )
    )

    for _ in range(100):
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))
        calls = message.get("toolCall", {}).get("functionCalls", [])
        if not calls:
            if message.get("serverContent", {}).get("turnComplete"):
                break
            continue

        call = next(
            (item for item in calls if item.get("name") == "report_interviewer_state"),
            None,
        )
        if call is None:
            raise RuntimeError("Gemini called an unexpected tool.")

        async with httpx.AsyncClient(base_url=base_url) as client:
            start = await client.post("/interview/start", json={})
            start.raise_for_status()
            session = start.json()
            review = await client.post(
                "/interview/live-control",
                json={
                    "session_id": session["session_id"],
                    "proposal": call.get("args", {}),
                },
            )
        if review.is_error:
            raise RuntimeError(
                f"Director rejected Gemini tool arguments: {review.status_code} {review.text}"
            )
        result = review.json()

        await socket.send(
            json.dumps(
                {
                    "toolResponse": {
                        "functionResponses": [
                            {
                                "id": call["id"],
                                "name": call["name"],
                                "response": {
                                    "result": {
                                        "approved": result["approved"],
                                        "approvedDecision": result["approved_decision"],
                                        "reasonCode": result["reason_code"],
                                    }
                                },
                            }
                        ]
                    }
                }
            )
        )
        print("Gemini Live tool call completed through Director review.")
        return

    raise RuntimeError("Gemini Live did not call report_interviewer_state.")


async def wait_for_completed_model_turn(
    socket: websockets.ClientConnection,
) -> None:
    for _ in range(100):
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))
        calls = message.get("toolCall", {}).get("functionCalls", [])
        if calls:
            await socket.send(
                json.dumps(
                    {
                        "toolResponse": {
                            "functionResponses": [
                                {
                                    "id": call["id"],
                                    "name": call["name"],
                                    "response": {
                                        "result": {
                                            "approved": True,
                                            "approvedDecision": "continue",
                                            "reasonCode": "opening_test",
                                            "instruction": (
                                                "Ask the supplied planned question exactly, "
                                                "then stop and wait."
                                            ),
                                        }
                                    },
                                }
                                for call in calls
                            ]
                        }
                    }
                )
            )
            continue
        if message.get("serverContent", {}).get("turnComplete"):
            return
    raise RuntimeError("Gemini did not complete the test question before the answer.")


async def verify_opening_response(socket: websockets.ClientConnection) -> None:
    await socket.send(
        json.dumps(
            {
                "realtimeInput": {
                    "text": (
                        "Begin the interview now. Introduce yourself briefly and ask: "
                        "Walk me through your background and the role you are targeting."
                    )
                }
            }
        )
    )

    for _ in range(12):
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))
        parts = message.get("serverContent", {}).get("modelTurn", {}).get("parts", [])
        if any(part.get("inlineData", {}).get("data") for part in parts):
            print("Gemini Live opening audio received.")
            return

    raise RuntimeError("Gemini Live did not return opening audio.")


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--exercise-tool", action="store_true")
    parser.add_argument("--exercise-opening", action="store_true")
    parser.add_argument("--exercise-resumption", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    asyncio.run(
        main(
            args.exercise_tool,
            args.exercise_opening,
            args.exercise_resumption,
            args.base_url,
        )
    )
