from reporting import AnswerInput, evaluate_answers


def test_report_evaluator_rewards_complete_specific_answers() -> None:
    report = evaluate_answers(
        (
            AnswerInput(
                question="Tell me about a project.",
                answer=(
                    "I first stated the assumption, compared two alternatives and their "
                    "tradeoff, then validated the safer option with user data while "
                    "monitoring rollout risk and measured impact."
                ),
            ),
            AnswerInput(
                question="Why this role?",
                answer=(
                    "The role matches my example of turning user problems into "
                    "team execution and measurable impact."
                ),
            ),
        ),
    )

    assert report.overall >= 80
    assert report.reasoning_depth >= 78
    assert report.suggestions


def test_report_evaluator_flags_short_or_missing_answers() -> None:
    report = evaluate_answers(
        (
            AnswerInput(question="Question 1", answer="Maybe."),
            AnswerInput(question="Question 2", answer=""),
        ),
    )

    assert report.overall < 70
    assert "Answer every question before ending the interview." in report.suggestions


def test_report_completion_uses_planned_question_count_and_deduplicates_follow_ups() -> None:
    report = evaluate_answers(
        (
            AnswerInput(question="Question 1", answer="Initial answer", question_id="q1"),
            AnswerInput(
                question="Follow-up",
                answer="More detail",
                question_id="q1",
                kind="follow_up",
            ),
        ),
        total_questions=4,
    )

    assert report.completion == 25


def test_report_evaluator_does_not_treat_chinese_as_a_single_word() -> None:
    report = evaluate_answers(
        (
            AnswerInput(
                question="请说明你的方案。",
                answer="我先明确一致性假设，因为跨区域延迟不可避免，所以比较了两种取舍，并用故障注入数据验证结果。",
            ),
        ),
    )

    assert report.clarity >= 72
    assert report.specificity >= 72
    assert report.reasoning_depth >= 78
