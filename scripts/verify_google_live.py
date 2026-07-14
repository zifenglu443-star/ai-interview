"""Verify the local Gemini Live proxy setup and hidden control tool round trip."""

import asyncio
import json
import os
from argparse import ArgumentParser

import httpx
import websockets


async def main(exercise_tool: bool, exercise_opening: bool) -> None:
    async with websockets.connect("ws://127.0.0.1:8000/google/live") as socket:
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
            await verify_tool_round_trip(socket)
        if exercise_opening:
            await verify_opening_response(socket)

    print("Gemini Live setup accepted.")


async def verify_tool_round_trip(socket: websockets.ClientConnection) -> None:
    await socket.send(
        json.dumps(
            {
                "realtimeInput": {
                    "text": (
                        "I will compare every element with every other element, "
                        "but the algorithm is still O(n)."
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

        async with httpx.AsyncClient(base_url="http://127.0.0.1:8000") as client:
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
        review.raise_for_status()
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
    args = parser.parse_args()
    asyncio.run(main(args.exercise_tool, args.exercise_opening))
