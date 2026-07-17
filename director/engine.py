from dataclasses import dataclass, field
from enum import StrEnum


class InterviewState(StrEnum):
    ASKING = "asking"
    FOLLOW_UP = "follow_up"
    COMPLETED = "completed"
    ENDED = "ended"


class DirectorError(ValueError):
    pass


@dataclass(frozen=True)
class InterviewQuestion:
    id: str
    prompt: str
    focus: str
    follow_up_prompt: str
    allocated_seconds: int = 0


@dataclass(frozen=True)
class InterviewAnswer:
    question_id: str
    question: str
    answer: str
    kind: str = "primary"


@dataclass(frozen=True)
class ControlSignal:
    emotion: str
    gesture: str
    whiteboard_action: str | None = None


@dataclass(frozen=True)
class DirectorConfig:
    interviewer_style: str = "professional"
    initial_pressure: str = "low"
    follow_up_depth: str = "standard"
    interruption_frequency: str = "medium"
    total_duration_seconds: int = 900


@dataclass(frozen=True)
class LiveInterviewerSignal:
    emotion: str
    gesture: str
    decision: str
    reason: str
    confidence: float
    answer_status: str = "uncertain"
    reasoning_depth_achieved: str = "none"
    follow_up_prompt: str | None = None
    candidate_answer: str | None = None
    question_completion_percentage: int = 0
    covered_requirements: tuple[str, ...] = field(default_factory=tuple)
    missing_requirements: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class LiveSignalReview:
    approved: bool
    approved_decision: str
    control: ControlSignal
    attitude: str
    pressure: str
    reason_code: str
    reasoning_depth_achieved: str = "none"
    question_completion_percentage: int = 0
    covered_requirements: tuple[str, ...] = field(default_factory=tuple)
    missing_requirements: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class DirectorSession:
    state: InterviewState
    question_index: int
    current_prompt: str | None
    current_focus: str | None
    attitude: str
    pressure: str
    control: ControlSignal
    director_config: DirectorConfig = field(default_factory=DirectorConfig)
    turn_index: int = 0
    answers: tuple[InterviewAnswer, ...] = field(default_factory=tuple)
    follow_up_used: tuple[str, ...] = field(default_factory=tuple)
    question_plan: tuple[InterviewQuestion, ...] = field(default_factory=tuple)


DEFAULT_QUESTIONS: tuple[InterviewQuestion, ...] = (
    InterviewQuestion(
        id="intro",
        prompt="Walk me through your background and the role you are targeting.",
        focus="Opening pitch",
        follow_up_prompt="What part of that background is most relevant to this role?",
    ),
    InterviewQuestion(
        id="project",
        prompt="Tell me about a project where you had to make a difficult tradeoff.",
        focus="Judgment",
        follow_up_prompt="What did you give up, and why was that the right call?",
    ),
    InterviewQuestion(
        id="conflict",
        prompt="Describe a time you disagreed with a teammate. What happened?",
        focus="Collaboration",
        follow_up_prompt="How did you keep the relationship productive afterward?",
    ),
    InterviewQuestion(
        id="problem-solving",
        prompt="How would you approach an ambiguous problem with limited data?",
        focus="Structured thinking",
        follow_up_prompt="What signal would you look for first?",
    ),
    InterviewQuestion(
        id="closing",
        prompt="Why should we move you forward to the next round?",
        focus="Closing argument",
        follow_up_prompt="What is the strongest evidence for that claim?",
    ),
)


MAX_FOLLOW_UPS_PER_QUESTION = 3

REASONING_DEPTH_RANK = {
    "none": 0,
    "answer": 1,
    "linked_reasoning": 2,
    "principled_reasoning": 3,
}


def required_reasoning_depth(config: DirectorConfig) -> str:
    return {
        "light": "answer",
        "standard": "linked_reasoning",
        "deep": "principled_reasoning",
    }.get(config.follow_up_depth, "linked_reasoning")


def reasoning_depth_satisfies(achieved: str, required: str) -> bool:
    return REASONING_DEPTH_RANK.get(achieved, 0) >= REASONING_DEPTH_RANK.get(required, 2)


def reasoning_depth_requirement(required: str) -> str:
    return {
        "answer": "Provide an independent, relevant answer or conclusion for every requested part.",
        "linked_reasoning": (
            "Connect the key assumptions, steps, evidence, and conclusion into a coherent chain."
        ),
        "principled_reasoning": (
            "Explain why the key steps work, including governing principles, conditions, or tradeoffs."
        ),
    }.get(required, "Connect the key reasoning steps into a coherent chain.")


QUESTION_COMPLETION_THRESHOLD = 90


def _review_question_completion(
    signal: LiveInterviewerSignal,
) -> tuple[int, tuple[str, ...], tuple[str, ...]]:
    """Bound the model score and keep it consistent with its coverage list."""
    covered = tuple(item.strip() for item in signal.covered_requirements if item.strip())
    missing = tuple(item.strip() for item in signal.missing_requirements if item.strip())
    reported = max(0, min(100, round(signal.question_completion_percentage)))
    requirement_count = len(covered) + len(missing)
    if requirement_count:
        coverage_percentage = round(100 * len(covered) / requirement_count)
        reported = min(reported, coverage_percentage)
    return reported, covered, missing


class DirectorEngine:
    def __init__(self, questions: tuple[InterviewQuestion, ...] = DEFAULT_QUESTIONS):
        if not questions:
            raise DirectorError("DirectorEngine requires at least one question.")

        self.questions = questions

    def start(
        self,
        practice_focus: str = "behavioral",
        practice_topics: str = "",
        target_role: str = "",
        director_config: DirectorConfig | None = None,
        question_plan: tuple[InterviewQuestion, ...] | None = None,
    ) -> DirectorSession:
        config = director_config or DirectorConfig()
        plan = question_plan or self._build_question_plan(
            practice_focus=practice_focus,
            practice_topics=practice_topics,
            target_role=target_role,
        )
        first_question = plan[0]
        return DirectorSession(
            state=InterviewState.ASKING,
            question_index=0,
            current_prompt=first_question.prompt,
            current_focus=first_question.focus,
            attitude=self._base_attitude(config),
            pressure=config.initial_pressure,
            control=ControlSignal(
                emotion="neutral",
                gesture="idle",
                whiteboard_action=None,
            ),
            director_config=config,
            question_plan=plan,
        )

    def submit_answer(self, session: DirectorSession, answer: str) -> DirectorSession:
        """Reject legacy unreviewed typed progression.

        Typed input is routed through the live model by the browser when available;
        otherwise it is retained only as a transcript note.
        """
        if session.state in {InterviewState.COMPLETED, InterviewState.ENDED}:
            raise DirectorError(f"Cannot submit answer while interview is {session.state}.")
        raise DirectorError(
            "Typed input cannot advance the interview without live semantic review."
        )

    def end(self, session: DirectorSession) -> DirectorSession:
        return DirectorSession(
            state=InterviewState.ENDED,
            question_index=session.question_index,
            current_prompt=None,
            current_focus=None,
            attitude=self._base_attitude(session.director_config),
            pressure=session.director_config.initial_pressure,
            control=ControlSignal(
                emotion="neutral",
                gesture="idle",
                whiteboard_action=None,
            ),
            director_config=session.director_config,
            turn_index=session.turn_index,
            answers=session.answers,
            follow_up_used=session.follow_up_used,
            question_plan=session.question_plan,
        )

    def review_live_signal(
        self,
        session: DirectorSession,
        signal: LiveInterviewerSignal,
        question_time_expired: bool = False,
        question_explanation_delivered: bool = False,
    ) -> LiveSignalReview:
        """Review a live provider observation without surrendering interview control."""
        if session.state in {InterviewState.COMPLETED, InterviewState.ENDED}:
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="session_inactive",
            )

        if signal.confidence < 0.65:
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="confidence_below_threshold",
            )

        approved_decision = signal.decision
        reason_code = "approved"
        completion_percentage, covered_requirements, missing_requirements = (
            _review_question_completion(signal)
        )
        required_depth = required_reasoning_depth(session.director_config)
        depth_satisfied = reasoning_depth_satisfies(
            signal.reasoning_depth_achieved,
            required_depth,
        )
        if not depth_satisfied:
            completion_percentage = min(completion_percentage, 85)
            depth_requirement = reasoning_depth_requirement(required_depth)
            if depth_requirement not in missing_requirements:
                missing_requirements = (*missing_requirements, depth_requirement)

        candidate_answer = (signal.candidate_answer or "").strip()
        if approved_decision == "explain_current" and not question_time_expired:
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="explanation_requires_expired_question_time",
            )
        if approved_decision == "move_on_after_explanation" and not (
            question_time_expired and question_explanation_delivered
        ):
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="question_explanation_not_delivered",
            )
        if approved_decision == "move_on" and not candidate_answer:
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="move_on_requires_candidate_answer",
                reasoning_depth_achieved=signal.reasoning_depth_achieved,
            )
        if approved_decision == "move_on" and signal.answer_status != "substantive":
            if (signal.follow_up_prompt or "").strip():
                approved_decision = "follow_up"
                reason_code = "answer_status_requires_follow_up"
            else:
                return LiveSignalReview(
                    approved=False,
                    approved_decision="continue",
                    control=session.control,
                    attitude="probing",
                    pressure=session.pressure,
                    reason_code="answer_status_requires_follow_up",
                    reasoning_depth_achieved=signal.reasoning_depth_achieved,
                    question_completion_percentage=completion_percentage,
                    covered_requirements=covered_requirements,
                    missing_requirements=missing_requirements,
                )
        if approved_decision == "move_on" and not depth_satisfied:
            if (signal.follow_up_prompt or "").strip():
                approved_decision = "follow_up"
                reason_code = "reasoning_depth_requires_follow_up"
            else:
                return LiveSignalReview(
                    approved=False,
                    approved_decision="continue",
                    control=session.control,
                    attitude="probing",
                    pressure=session.pressure,
                    reason_code="reasoning_depth_below_requirement",
                    reasoning_depth_achieved=signal.reasoning_depth_achieved,
                    question_completion_percentage=completion_percentage,
                    covered_requirements=covered_requirements,
                    missing_requirements=missing_requirements,
                )
        if approved_decision == "move_on" and (
            completion_percentage < QUESTION_COMPLETION_THRESHOLD
            or missing_requirements
        ):
            if (signal.follow_up_prompt or "").strip():
                approved_decision = "follow_up"
                reason_code = "question_incomplete_requires_follow_up"
            else:
                return LiveSignalReview(
                    approved=False,
                    approved_decision="continue",
                    control=session.control,
                    attitude="probing",
                    pressure=session.pressure,
                    reason_code="question_completion_below_threshold",
                    question_completion_percentage=completion_percentage,
                    covered_requirements=covered_requirements,
                    missing_requirements=missing_requirements,
                )
        if approved_decision == "follow_up":
            question = (session.question_plan or self.questions)[session.question_index]
            follow_up_count = session.follow_up_used.count(question.id)
            if (
                completion_percentage >= QUESTION_COMPLETION_THRESHOLD
                and follow_up_count >= 1
            ):
                if (
                    candidate_answer
                    and signal.answer_status == "substantive"
                    and depth_satisfied
                    and not missing_requirements
                ):
                    approved_decision = "move_on"
                    reason_code = "near_completion_follow_up_limit_reached"
                else:
                    return LiveSignalReview(
                        approved=False,
                        approved_decision="continue",
                        control=session.control,
                        attitude=session.attitude,
                        pressure=session.pressure,
                        reason_code="near_completion_follow_up_limit_reached",
                        reasoning_depth_achieved=signal.reasoning_depth_achieved,
                        question_completion_percentage=completion_percentage,
                        covered_requirements=covered_requirements,
                        missing_requirements=missing_requirements,
                    )
            if (
                approved_decision == "follow_up"
                and follow_up_count >= MAX_FOLLOW_UPS_PER_QUESTION
            ):
                return LiveSignalReview(
                    approved=False,
                    approved_decision="continue",
                    control=session.control,
                    attitude=session.attitude,
                    pressure=session.pressure,
                    reason_code="follow_up_safety_limit_exhausted",
                    reasoning_depth_achieved=signal.reasoning_depth_achieved,
                    question_completion_percentage=completion_percentage,
                    covered_requirements=covered_requirements,
                    missing_requirements=missing_requirements,
                )
        if (
            approved_decision in {"move_on", "move_on_after_explanation"}
            and session.answers
            and session.answers[-1].kind == "voice"
            and session.answers[-1].answer.strip() == candidate_answer
        ):
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="duplicate_voice_answer",
            )

        # Style and current pressure affect delivery intensity, not topic or plan.
        style_adjustment = {
            "friendly": 0.05,
            "professional": 0.0,
            "strict": -0.05,
        }.get(session.director_config.interviewer_style, 0.0)
        pressure_adjustment = {
            "low": 0.05,
            "medium": 0.0,
            "high": -0.05,
        }.get(session.pressure, 0.0)

        challenge_threshold = min(
            0.95,
            max(0.65, 0.75 + style_adjustment + pressure_adjustment),
        )
        if approved_decision == "challenge" and signal.confidence < challenge_threshold:
            approved_decision = "continue"
            reason_code = "challenge_downgraded_for_profile"

        # Interruptions carry a higher realism cost, so require stronger evidence.
        interruption_threshold = {
            "low": 0.95,
            "medium": 0.85,
            "high": 0.75,
        }.get(session.director_config.interruption_frequency, 0.85)
        interruption_threshold = min(
            0.99,
            max(
                0.70,
                interruption_threshold + style_adjustment + pressure_adjustment,
            ),
        )
        if approved_decision == "interrupt" and signal.confidence < interruption_threshold:
            approved_decision = "challenge"
            reason_code = "interrupt_downgraded_to_challenge"

        gesture = signal.gesture
        whiteboard_action = (
            "inspect_whiteboard" if signal.gesture == "look_whiteboard" else None
        )
        attitude = (
            "firm"
            if approved_decision == "interrupt"
            else "probing"
            if approved_decision in {"follow_up", "challenge"}
            else "professional"
        )
        pressure = session.pressure
        if approved_decision == "interrupt":
            pressure = "high"
        elif approved_decision in {"follow_up", "challenge"} and pressure == "low":
            pressure = "medium"

        return LiveSignalReview(
            approved=True,
            approved_decision=approved_decision,
            control=ControlSignal(
                emotion=signal.emotion,
                gesture=gesture,
                whiteboard_action=whiteboard_action,
            ),
            attitude=attitude,
            pressure=pressure,
            reason_code=reason_code,
            reasoning_depth_achieved=signal.reasoning_depth_achieved,
            question_completion_percentage=completion_percentage,
            covered_requirements=covered_requirements,
            missing_requirements=missing_requirements,
        )

    def apply_live_review(
        self,
        session: DirectorSession,
        review: LiveSignalReview,
        follow_up_prompt: str | None = None,
        candidate_answer: str | None = None,
    ) -> DirectorSession:
        """Apply an approved model follow-up within the Director's bounded flow."""
        if not review.approved:
            return session
        question = (session.question_plan or self.questions)[session.question_index]
        prompt = (follow_up_prompt or "").strip()
        if review.approved_decision in {"move_on", "move_on_after_explanation"}:
            clean_answer = (candidate_answer or "").strip()
            if not clean_answer and review.approved_decision == "move_on":
                return session
            if not clean_answer:
                clean_answer = "No substantive answer before the question time expired."
            return self._advance(
                session,
                session.answers + (
                    InterviewAnswer(
                        question_id=question.id,
                        question=question.prompt,
                        answer=clean_answer,
                        kind="voice",
                    ),
                ),
            )
        if (
            review.approved_decision == "follow_up"
            and session.state in {InterviewState.ASKING, InterviewState.FOLLOW_UP}
            and session.follow_up_used.count(question.id) < MAX_FOLLOW_UPS_PER_QUESTION
            and prompt
        ):
            return DirectorSession(
                state=InterviewState.FOLLOW_UP,
                question_index=session.question_index,
                current_prompt=prompt,
                current_focus="Interviewer follow-up",
                attitude=review.attitude,
                pressure=review.pressure,
                control=review.control,
                director_config=session.director_config,
                turn_index=session.turn_index + 1,
                answers=session.answers,
                follow_up_used=session.follow_up_used + (question.id,),
                question_plan=session.question_plan,
            )
        return DirectorSession(
            state=session.state,
            question_index=session.question_index,
            current_prompt=session.current_prompt,
            current_focus=session.current_focus,
            attitude=review.attitude,
            pressure=review.pressure,
            control=review.control,
            director_config=session.director_config,
            turn_index=session.turn_index,
            answers=session.answers,
            follow_up_used=session.follow_up_used,
            question_plan=session.question_plan,
        )

    def _advance(
        self,
        session: DirectorSession,
        answers: tuple[InterviewAnswer, ...],
    ) -> DirectorSession:
        next_index = session.question_index + 1

        questions = session.question_plan or self.questions
        if next_index >= len(questions):
            return DirectorSession(
                state=InterviewState.COMPLETED,
                question_index=session.question_index,
                current_prompt=None,
                current_focus=None,
                attitude=self._base_attitude(session.director_config),
                pressure=session.director_config.initial_pressure,
                control=ControlSignal(
                    emotion="satisfied",
                    gesture="nod_once",
                    whiteboard_action="mark_complete",
                ),
                director_config=session.director_config,
                turn_index=session.turn_index + 1,
                answers=answers,
                follow_up_used=session.follow_up_used,
                question_plan=session.question_plan,
            )

        next_question = questions[next_index]
        return DirectorSession(
            state=InterviewState.ASKING,
            question_index=next_index,
            current_prompt=next_question.prompt,
            current_focus=next_question.focus,
            attitude=self._base_attitude(session.director_config),
            pressure=session.director_config.initial_pressure,
            control=ControlSignal(
                emotion="attentive",
                gesture="nod_once",
                whiteboard_action="advance_topic",
            ),
            director_config=session.director_config,
            turn_index=session.turn_index + 1,
            answers=answers,
            follow_up_used=session.follow_up_used,
            question_plan=session.question_plan,
        )

    @staticmethod
    def _base_attitude(config: DirectorConfig) -> str:
        return {
            "friendly": "supportive",
            "professional": "professional",
            "strict": "firm",
        }.get(config.interviewer_style, "professional")

    def _build_opening_question(
        self,
        practice_focus: str,
        practice_topics: str,
        target_role: str,
    ) -> InterviewQuestion:
        role_suffix = f" for the {target_role}" if target_role else ""
        topic = practice_topics.strip()

        # Preserve the established general opening for API callers that have not
        # supplied a practice plan. The setup flow always supplies one.
        if not topic and not target_role:
            return self.questions[0]

        if practice_focus == "custom" and topic:
            return InterviewQuestion(
                id="custom-practice",
                prompt=topic.splitlines()[0].strip(),
                focus="Today's question",
                follow_up_prompt="What assumption or detail would you examine next?",
            )

        templates = {
            "technical": (
                "Technical explanation",
                f"Explain {topic or 'a technical concept you know well'}{role_suffix}. "
                "State your assumptions, tradeoffs, and how you would validate it.",
            ),
            "project": (
                "Project deep dive",
                f"Walk me through {topic or 'a project you are proud of'}{role_suffix}. "
                "Focus on your decisions, tradeoffs, and measurable result.",
            ),
            "case": (
                "Structured problem solving",
                f"Let us practise {topic or 'an ambiguous problem'}{role_suffix}. "
                "How would you structure the problem before proposing a solution?",
            ),
            "behavioral": (
                "Behavioral story",
                f"Tell me about {topic or 'a time you handled a difficult challenge'}"
                f"{role_suffix}. What was your specific contribution?",
            ),
        }
        focus, prompt = templates.get(practice_focus, templates["behavioral"])
        return InterviewQuestion(
            id="practice-opening",
            prompt=prompt,
            focus=focus,
            follow_up_prompt="Can you make that more specific with a concrete example?",
        )

    def _build_question_plan(
        self,
        practice_focus: str,
        practice_topics: str,
        target_role: str,
    ) -> tuple[InterviewQuestion, ...]:
        opening = self._build_opening_question(
            practice_focus=practice_focus,
            practice_topics=practice_topics,
            target_role=target_role,
        )
        remaining = tuple(question for question in self.questions if question.id != opening.id)
        return (opening, *remaining)
