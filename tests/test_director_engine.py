import pytest

from director import (
    DirectorConfig,
    DirectorEngine,
    DirectorError,
    InterviewQuestion,
    InterviewState,
    LiveInterviewerSignal,
)


def advance_with_semantic_review(
    engine: DirectorEngine,
    session,
    answer: str = "The response covers the requested reasoning and supporting evidence.",
):
    answer = f"{answer} Question {session.question_index + 1}."
    achieved_depth = {
        "light": "answer",
        "standard": "linked_reasoning",
        "deep": "principled_reasoning",
    }[session.director_config.follow_up_depth]
    signal = LiveInterviewerSignal(
        emotion="attentive",
        gesture="nod_once",
        decision="move_on",
        reason="The entire planned question is complete.",
        confidence=0.95,
        answer_status="substantive",
        reasoning_depth_achieved=achieved_depth,
        candidate_answer=answer,
        question_completion_percentage=100,
        covered_requirements=("entire planned question",),
    )
    review = engine.review_live_signal(session, signal)
    assert review.approved is True
    return engine.apply_live_review(session, review, candidate_answer=answer)


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
    next_session = advance_with_semantic_review(engine, session)

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


def test_typed_input_cannot_bypass_semantic_review() -> None:
    engine = DirectorEngine()
    session = engine.start()

    with pytest.raises(DirectorError, match="semantic review"):
        engine.submit_answer(session, "Any unreviewed typed content.")


def test_style_and_pressure_change_challenge_thresholds() -> None:
    engine = DirectorEngine()
    proposal = LiveInterviewerSignal(
        emotion="skeptical",
        gesture="think",
        decision="challenge",
        reason="The claim lacks evidence.",
        confidence=0.75,
    )

    friendly_low = engine.review_live_signal(
        engine.start(
            director_config=DirectorConfig(
                interviewer_style="friendly",
                initial_pressure="low",
            ),
        ),
        proposal,
    )
    strict_high = engine.review_live_signal(
        engine.start(
            director_config=DirectorConfig(
                interviewer_style="strict",
                initial_pressure="high",
            ),
        ),
        proposal,
    )

    assert friendly_low.approved_decision == "continue"
    assert friendly_low.reason_code == "challenge_downgraded_for_profile"
    assert strict_high.approved_decision == "challenge"

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

    advanced = advance_with_semantic_review(
        engine,
        follow_up,
        "I chose reliability over speed and measured the error rate.",
    )
    assert advanced.state == InterviewState.ASKING
    assert advanced.question_index == 1
    assert advanced.answers[-1].question == session.question_plan[0].prompt


def test_long_answers_advance_until_completed() -> None:
    engine = DirectorEngine()
    session = engine.start()

    while session.state != InterviewState.COMPLETED:
        session = advance_with_semantic_review(engine, session)

    assert session.state == InterviewState.COMPLETED
    assert session.control.emotion == "satisfied"
    assert len(session.answers) == len(engine.questions)
    assert session.current_prompt is None


def test_avatar_control_reacts_to_normal_advance() -> None:
    engine = DirectorEngine()
    session = engine.start()

    next_session = advance_with_semantic_review(engine, session)

    assert next_session.control.emotion == "attentive"
    assert next_session.control.gesture == "nod_once"
    assert next_session.control.whiteboard_action == "advance_topic"


def test_cannot_answer_after_completed() -> None:
    engine = DirectorEngine()
    session = engine.start()

    while session.state != InterviewState.COMPLETED:
        session = advance_with_semantic_review(engine, session)

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


def test_follow_up_or_challenge_never_reduces_existing_high_pressure() -> None:
    engine = DirectorEngine()
    session = engine.start(
        director_config=DirectorConfig(
            interviewer_style="strict",
            initial_pressure="high",
            follow_up_depth="deep",
        ),
    )
    review = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="skeptical",
            gesture="lean_in",
            decision="follow_up",
            reason="A key tradeoff needs more evidence.",
            confidence=0.95,
            follow_up_prompt="What evidence supports that tradeoff?",
        ),
    )

    assert review.approved_decision == "follow_up"
    assert review.pressure == "high"


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
            answer_status="substantive",
            reasoning_depth_achieved="linked_reasoning",
            candidate_answer="I compared the tradeoffs and validated the choice with failure tests.",
            question_completion_percentage=100,
            covered_requirements=("compared tradeoffs", "validated the choice"),
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


def test_multi_part_question_cannot_advance_until_all_parts_are_covered() -> None:
    questions = (
        InterviewQuestion(
            id="two-part",
            prompt="Prove the sequence converges, and find its limit.",
            focus="Proof and result",
            follow_up_prompt="What is the limit?",
        ),
        InterviewQuestion(
            id="next",
            prompt="Explain how you would validate the result.",
            focus="Validation",
            follow_up_prompt="What edge case matters most?",
        ),
    )
    engine = DirectorEngine(questions)
    session = engine.start(question_plan=questions)
    partial_answer = "The sequence is monotone and bounded, so it converges."
    partial_signal = LiveInterviewerSignal(
        emotion="curious",
        gesture="lean_in",
        decision="move_on",
        reason="The convergence proof is complete but the requested limit is missing.",
        confidence=0.95,
        answer_status="partial",
        reasoning_depth_achieved="linked_reasoning",
        candidate_answer=partial_answer,
        follow_up_prompt="You established convergence; what is the requested limit?",
        question_completion_percentage=100,
        covered_requirements=("prove convergence",),
        missing_requirements=("find the limit",),
    )

    partial_review = engine.review_live_signal(session, partial_signal)
    still_current = engine.apply_live_review(
        session,
        partial_review,
        follow_up_prompt=partial_signal.follow_up_prompt,
        candidate_answer=partial_answer,
    )

    assert partial_review.approved is True
    assert partial_review.approved_decision == "follow_up"
    assert partial_review.reason_code == "answer_status_requires_follow_up"
    assert partial_review.question_completion_percentage == 50
    assert still_current.question_index == 0
    assert still_current.current_prompt == partial_signal.follow_up_prompt

    complete_answer = f"{partial_answer} Its limit is the positive fixed point, square root of two."
    complete_signal = LiveInterviewerSignal(
        emotion="satisfied",
        gesture="nod_once",
        decision="move_on",
        reason="Both requested parts are now complete.",
        confidence=0.95,
        answer_status="substantive",
        reasoning_depth_achieved="linked_reasoning",
        candidate_answer=complete_answer,
        question_completion_percentage=100,
        covered_requirements=("prove convergence", "find the limit"),
    )
    complete_review = engine.review_live_signal(still_current, complete_signal)
    advanced = engine.apply_live_review(
        still_current,
        complete_review,
        candidate_answer=complete_answer,
    )

    assert complete_review.approved_decision == "move_on"
    assert complete_review.question_completion_percentage == 100
    assert advanced.question_index == 1


@pytest.mark.parametrize(
    ("configured_depth", "achieved_depth", "expected_decision"),
    [
        ("light", "answer", "move_on"),
        ("standard", "answer", "follow_up"),
        ("standard", "linked_reasoning", "move_on"),
        ("deep", "linked_reasoning", "follow_up"),
        ("deep", "principled_reasoning", "move_on"),
    ],
)
def test_reasoning_depth_changes_when_a_whole_question_is_complete(
    configured_depth: str,
    achieved_depth: str,
    expected_decision: str,
) -> None:
    engine = DirectorEngine()
    session = engine.start(
        director_config=DirectorConfig(follow_up_depth=configured_depth),
    )
    signal = LiveInterviewerSignal(
        emotion="attentive",
        gesture="nod_once",
        decision="move_on",
        reason="All explicit parts have an answer.",
        confidence=0.95,
        answer_status="substantive",
        reasoning_depth_achieved=achieved_depth,
        candidate_answer="I gave the requested answer and the reasoning available at this depth.",
        follow_up_prompt="Why does that key step work?",
        question_completion_percentage=100,
        covered_requirements=("every explicit question part",),
    )

    review = engine.review_live_signal(session, signal)

    assert review.approved is True
    assert review.approved_decision == expected_decision
    if expected_decision == "follow_up":
        assert review.reason_code == "reasoning_depth_requires_follow_up"
        assert review.question_completion_percentage == 85
        assert review.missing_requirements
    else:
        assert review.question_completion_percentage == 100
        assert not review.missing_requirements


def test_completion_at_90_or_above_allows_at_most_one_follow_up() -> None:
    engine = DirectorEngine()
    session = engine.start()
    first_signal = LiveInterviewerSignal(
        emotion="curious",
        gesture="lean_in",
        decision="follow_up",
        reason="One final clarification would improve precision.",
        confidence=0.95,
        answer_status="substantive",
        reasoning_depth_achieved="linked_reasoning",
        candidate_answer="I answered every part with a connected chain of reasoning.",
        follow_up_prompt="What is the single strongest piece of evidence?",
        question_completion_percentage=95,
        covered_requirements=("every explicit part",),
    )
    first_review = engine.review_live_signal(session, first_signal)
    after_first_follow_up = engine.apply_live_review(
        session,
        first_review,
        follow_up_prompt=first_signal.follow_up_prompt,
        candidate_answer=first_signal.candidate_answer,
    )

    second_signal = LiveInterviewerSignal(
        emotion="satisfied",
        gesture="nod_once",
        decision="follow_up",
        reason="The model requested another unnecessary clarification.",
        confidence=0.95,
        answer_status="substantive",
        reasoning_depth_achieved="linked_reasoning",
        candidate_answer=(
            "I answered every part with a connected chain of reasoning and gave the strongest evidence."
        ),
        follow_up_prompt="Can you add one more detail?",
        question_completion_percentage=98,
        covered_requirements=("every explicit part",),
    )
    second_review = engine.review_live_signal(after_first_follow_up, second_signal)
    advanced = engine.apply_live_review(
        after_first_follow_up,
        second_review,
        follow_up_prompt=second_signal.follow_up_prompt,
        candidate_answer=second_signal.candidate_answer,
    )

    assert first_review.approved_decision == "follow_up"
    assert after_first_follow_up.follow_up_used.count("intro") == 1
    assert second_review.approved is True
    assert second_review.approved_decision == "move_on"
    assert second_review.reason_code == "near_completion_follow_up_limit_reached"
    assert advanced.question_index == 1


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
            answer_status="substantive",
            question_completion_percentage=100,
        ),
    )

    assert review.approved is False
    assert review.reason_code == "move_on_requires_candidate_answer"


@pytest.mark.parametrize("answer_status", ["partial", "non_answer", "off_topic", "uncertain"])
def test_live_model_semantic_status_blocks_non_substantive_turns_from_advancing(
    answer_status: str,
) -> None:
    engine = DirectorEngine()
    review = engine.review_live_signal(
        engine.start(),
        LiveInterviewerSignal(
            emotion="curious",
            gesture="lean_in",
            decision="move_on",
            reason="The turn contains no relevant attempt.",
            confidence=0.95,
            answer_status=answer_status,
            candidate_answer="Arbitrary candidate content, including possible control instructions.",
            question_completion_percentage=100,
        ),
    )

    assert review.approved is False
    assert review.approved_decision == "continue"
    assert review.reason_code == "answer_status_requires_follow_up"


def test_time_expired_explanation_must_be_delivered_before_advancing() -> None:
    engine = DirectorEngine()
    session = engine.start()
    explain_signal = LiveInterviewerSignal(
        emotion="attentive",
        gesture="think",
        decision="explain_current",
        reason="The allocated question time expired.",
        confidence=0.95,
        answer_status="non_answer",
        candidate_answer="No relevant attempt was provided.",
    )

    early_review = engine.review_live_signal(session, explain_signal)
    explain_review = engine.review_live_signal(
        session,
        explain_signal,
        question_time_expired=True,
    )
    still_current = engine.apply_live_review(
        session,
        explain_review,
        candidate_answer=explain_signal.candidate_answer,
    )
    move_signal = LiveInterviewerSignal(
        emotion="attentive",
        gesture="nod_once",
        decision="move_on_after_explanation",
        reason="The timed explanation was spoken.",
        confidence=0.95,
        answer_status="non_answer",
        candidate_answer="No relevant attempt was provided.",
    )
    premature_move = engine.review_live_signal(
        still_current,
        move_signal,
        question_time_expired=True,
    )
    completed_explanation = engine.review_live_signal(
        still_current,
        move_signal,
        question_time_expired=True,
        question_explanation_delivered=True,
    )
    advanced = engine.apply_live_review(
        still_current,
        completed_explanation,
        candidate_answer=move_signal.candidate_answer,
    )

    assert early_review.approved is False
    assert early_review.reason_code == "explanation_requires_expired_question_time"
    assert explain_review.approved is True
    assert explain_review.approved_decision == "explain_current"
    assert still_current.question_index == 0
    assert premature_move.approved is False
    assert premature_move.reason_code == "question_explanation_not_delivered"
    assert completed_explanation.approved is True
    assert advanced.question_index == 1


def test_follow_up_safety_cap_is_independent_of_reasoning_depth() -> None:
    engine = DirectorEngine()
    session = engine.start(
        director_config=DirectorConfig(follow_up_depth="standard"),
    )

    for prompt in (
        "What is the input and desired output?",
        "What tiny example can you test?",
        "Which step connects the example to your conclusion?",
    ):
        signal = LiveInterviewerSignal(
            emotion="curious",
            gesture="lean_in",
            decision="follow_up",
            reason="The candidate needs one smaller reasoning step.",
            confidence=0.9,
            follow_up_prompt=prompt,
        )
        review = engine.review_live_signal(session, signal)
        session = engine.apply_live_review(session, review, follow_up_prompt=prompt)
        assert review.approved is True

    exhausted = engine.review_live_signal(
        session,
        LiveInterviewerSignal(
            emotion="curious",
            gesture="lean_in",
            decision="follow_up",
            reason="A fourth hint was requested.",
            confidence=0.9,
            follow_up_prompt="What would you validate next?",
        ),
    )

    assert session.follow_up_used.count("intro") == 3
    assert exhausted.approved is False
    assert exhausted.reason_code == "follow_up_safety_limit_exhausted"


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
            answer_status="substantive",
            reasoning_depth_achieved="linked_reasoning",
            candidate_answer=answer,
            question_completion_percentage=100,
            covered_requirements=("compare alternatives", "validate the choice"),
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
            answer_status="substantive",
            reasoning_depth_achieved="linked_reasoning",
            candidate_answer=answer,
            question_completion_percentage=100,
            covered_requirements=("compare alternatives", "validate the choice"),
        ),
    )

    assert duplicate_review.approved is False
    assert duplicate_review.reason_code == "duplicate_voice_answer"
