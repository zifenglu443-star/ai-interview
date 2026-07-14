import pytest

from director import (
    DirectorConfig,
    DirectorEngine,
    DirectorError,
    InterviewState,
    LiveInterviewerSignal,
)


def test_start_opens_first_question() -> None:
    session = DirectorEngine().start()

    assert session.state == InterviewState.ASKING
    assert session.question_index == 0
    assert session.current_focus == "Opening pitch"
    assert session.pressure == "low"


def test_director_config_sets_and_preserves_the_session_profile() -> None:
    engine = DirectorEngine()
    config = DirectorConfig(
        interviewer_style="strict",
        initial_pressure="high",
        follow_up_depth="deep",
        interruption_frequency="high",
    )

    session = engine.start(director_config=config)
    next_session = engine.submit_answer(
        session,
        "This answer is deliberately detailed enough to continue to the next question.",
    )

    assert session.attitude == "firm"
    assert session.pressure == "high"
    assert next_session.director_config == config


def test_start_uses_the_candidate_practice_plan_for_the_opening_question() -> None:
    session = DirectorEngine().start(
        practice_focus="technical",
        practice_topics="binary search in a sorted array",
        target_role="Software Engineering Intern",
    )

    assert session.current_focus == "Technical explanation"
    assert "binary search in a sorted array" in (session.current_prompt or "")
    assert "Software Engineering Intern" in (session.current_prompt or "")


def test_custom_practice_question_is_used_verbatim_for_the_opening() -> None:
    session = DirectorEngine().start(
        practice_focus="custom",
        practice_topics=(
            "Ask me to explain the architecture of my coursework project.\n"
            "Then challenge my tradeoffs."
        ),
    )

    assert session.current_focus == "Today's question"
    assert session.current_prompt == (
        "Ask me to explain the architecture of my coursework project."
    )


def test_answer_length_does_not_trigger_a_director_follow_up() -> None:
    engine = DirectorEngine()
    session = engine.start()

    next_question = engine.submit_answer(session, "I build products.")

    assert next_question.state == InterviewState.ASKING
    assert next_question.question_index == 1
    assert next_question.follow_up_used == ()

def test_model_requested_follow_up_is_bounded_and_keeps_its_prompt() -> None:
    engine = DirectorEngine()
    session = engine.start()
    review = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="curious",
            gesture="lean_in",
            decision="follow_up",
            reason="The answer needs its main tradeoff explained.",
            confidence=0.9,
            follow_up_prompt="What tradeoff did you make, and how did you validate it?",
        ),
    )
    follow_up = engine.apply_live_review(
        session, review, "What tradeoff did you make, and how did you validate it?"
    )

    assert follow_up.state == InterviewState.FOLLOW_UP
    assert follow_up.current_prompt == "What tradeoff did you make, and how did you validate it?"
    assert follow_up.follow_up_used == ("intro",)

    advanced = engine.submit_answer(follow_up, "I chose reliability over speed and measured the error rate.")
    assert advanced.state == InterviewState.ASKING
    assert advanced.question_index == 1
    assert advanced.answers[-1].question == follow_up.current_prompt


def test_long_answers_advance_until_completed() -> None:
    engine = DirectorEngine()
    session = engine.start()

    while session.state != InterviewState.COMPLETED:
        session = engine.submit_answer(
            session,
            "This answer has enough detail to move forward without a follow up question.",
        )

    assert session.state == InterviewState.COMPLETED
    assert session.control.emotion == "satisfied"
    assert len(session.answers) == len(engine.questions)
    assert session.current_prompt is None


def test_avatar_control_reacts_to_normal_advance() -> None:
    engine = DirectorEngine()
    session = engine.start()

    next_session = engine.submit_answer(
        session,
        "This answer has enough detail to move forward without a follow up question.",
    )

    assert next_session.control.emotion == "attentive"
    assert next_session.control.gesture == "nod_once"
    assert next_session.control.whiteboard_action == "advance_topic"


def test_cannot_answer_after_completed() -> None:
    engine = DirectorEngine()
    session = engine.start()

    while session.state != InterviewState.COMPLETED:
        session = engine.submit_answer(
            session,
            "This answer has enough detail to move forward without a follow up question.",
        )

    with pytest.raises(DirectorError):
        engine.submit_answer(session, "Too late.")


def test_end_moves_to_ended_from_active_session() -> None:
    engine = DirectorEngine()
    session = engine.start()

    ended = engine.end(session)

    assert ended.state == InterviewState.ENDED
    assert ended.current_prompt is None


def test_live_signal_is_reviewed_without_advancing_the_interview() -> None:
    engine = DirectorEngine()
    session = engine.start()

    review = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="skeptical",
            gesture="look_whiteboard",
            decision="challenge",
            reason="The complexity claim is unsupported.",
            confidence=0.9,
        ),
    )

    assert review.approved is True
    assert review.approved_decision == "challenge"
    assert review.control.emotion == "skeptical"
    assert review.control.gesture == "look_whiteboard"
    assert review.control.whiteboard_action == "inspect_whiteboard"
    assert review.pressure == "medium"
    assert session.state == InterviewState.ASKING
    assert session.question_index == 0


def test_approved_live_review_updates_presentation_without_advancing() -> None:
    engine = DirectorEngine()
    session = engine.start()
    review = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="skeptical",
            gesture="look_whiteboard",
            decision="challenge",
            reason="The candidate skipped a justification.",
            confidence=0.9,
        ),
    )
    updated = engine.apply_live_review(session, review)

    assert updated.state == session.state
    assert updated.question_index == session.question_index
    assert updated.control.gesture == "look_whiteboard"
    assert updated.pressure == "medium"


def test_low_confidence_live_signal_is_rejected() -> None:
    engine = DirectorEngine()
    session = engine.start()

    review = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="firm",
            gesture="pause",
            decision="interrupt",
            reason="The answer might be drifting.",
            confidence=0.5,
        ),
    )

    assert review.approved is False
    assert review.approved_decision == "continue"
    assert review.control == session.control
    assert review.reason_code == "confidence_below_threshold"


def test_interruption_frequency_changes_the_approval_threshold() -> None:
    engine = DirectorEngine()
    proposal = LiveInterviewerSignal(
        emotion="firm",
        gesture="pause",
        decision="interrupt",
        reason="The answer is drifting away from the question.",
        confidence=0.8,
    )

    low = engine.review_live_signal(
        engine.start(
            director_config=DirectorConfig(interruption_frequency="low")
        ),
        proposal,
    )
    high = engine.review_live_signal(
        engine.start(
            director_config=DirectorConfig(interruption_frequency="high")
        ),
        proposal,
    )

    assert low.approved_decision == "challenge"
    assert high.approved_decision == "interrupt"


def test_live_model_can_move_on_only_with_a_captured_candidate_answer() -> None:
    engine = DirectorEngine()
    session = engine.start()

    review = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="attentive",
            gesture="nod_once",
            decision="move_on",
            reason="The answer is complete.",
            confidence=0.95,
            candidate_answer="I compared the tradeoffs and validated the choice with failure tests.",
        ),
    )
    advanced = engine.apply_live_review(
        session,
        review,
        candidate_answer="I compared the tradeoffs and validated the choice with failure tests.",
    )

    assert review.approved is True
    assert review.approved_decision == "move_on"
    assert advanced.question_index == 1
    assert advanced.answers[-1].kind == "voice"


def test_live_model_move_on_without_an_answer_is_rejected() -> None:
    engine = DirectorEngine()
    review = engine.review_live_signal(
        engine.start(),
        LiveInterviewerSignal(
            emotion="attentive",
            gesture="nod_once",
            decision="move_on",
            reason="The answer is complete.",
            confidence=0.95,
        ),
    )

    assert review.approved is False
    assert review.reason_code == "move_on_requires_candidate_answer"


def test_duplicate_voice_answer_cannot_advance_a_second_question() -> None:
    engine = DirectorEngine()
    session = engine.start()
    answer = "I compared alternatives and validated the selected tradeoff."
    first_review = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="attentive",
            gesture="nod_once",
            decision="move_on",
            reason="The answer is complete.",
            confidence=0.95,
            candidate_answer=answer,
        ),
    )
    advanced = engine.apply_live_review(session, first_review, candidate_answer=answer)
    duplicate_review = engine.review_live_signal(
        advanced,
        LiveInterviewerSignal(
            emotion="attentive",
            gesture="nod_once",
            decision="move_on",
            reason="Duplicate tool event.",
            confidence=0.95,
            candidate_answer=answer,
        ),
    )

    assert duplicate_review.approved is False
    assert duplicate_review.reason_code == "duplicate_voice_answer"
