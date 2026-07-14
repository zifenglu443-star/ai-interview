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
    follow_up_prompt: str | None = None
    candidate_answer: str | None = None


@dataclass(frozen=True)
class LiveSignalReview:
    approved: bool
    approved_decision: str
    control: ControlSignal
    attitude: str
    pressure: str
    reason_code: str


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
        if session.state in {InterviewState.COMPLETED, InterviewState.ENDED}:
            raise DirectorError(f"Cannot submit answer while interview is {session.state}.")

        questions = session.question_plan or self.questions
        if session.question_index >= len(questions):
            raise DirectorError("Session question index is outside the question set.")

        clean_answer = answer.strip()
        question = questions[session.question_index]

        if session.state == InterviewState.ASKING:
            active_question = InterviewQuestion(
                id=question.id,
                prompt=session.current_prompt or question.prompt,
                focus=session.current_focus or question.focus,
                follow_up_prompt=(
                    "Can you make that more specific with a concrete example, "
                    "tradeoff, or result?"
                    if session.question_index == 0
                    else question.follow_up_prompt
                ),
            )
            next_answers = session.answers + (
                InterviewAnswer(
                    question_id=active_question.id,
                    question=active_question.prompt,
                    answer=clean_answer,
                ),
            )

            return self._advance(session, next_answers)

        if session.state == InterviewState.FOLLOW_UP:
            follow_up_question_id = (
                session.follow_up_used[-1] if session.follow_up_used else question.id
            )
            next_answers = session.answers + (
                InterviewAnswer(
                    question_id=follow_up_question_id,
                    question=session.current_prompt or question.follow_up_prompt,
                    answer=clean_answer,
                    kind="follow_up",
                ),
            )
            return self._advance(session, next_answers)

        raise DirectorError(f"Unsupported interview state: {session.state}.")

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
    ) -> LiveSignalReview:
        """Review Gemini's observation without surrendering interview control."""
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

        if approved_decision == "move_on" and not (signal.candidate_answer or "").strip():
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="move_on_requires_candidate_answer",
            )
        if (
            approved_decision == "move_on"
            and session.answers
            and session.answers[-1].kind == "voice"
            and session.answers[-1].answer.strip() == (signal.candidate_answer or "").strip()
        ):
            return LiveSignalReview(
                approved=False,
                approved_decision="continue",
                control=session.control,
                attitude=session.attitude,
                pressure=session.pressure,
                reason_code="duplicate_voice_answer",
            )

        # Interruptions carry a higher realism cost, so require stronger evidence.
        interruption_threshold = {
            "low": 0.95,
            "medium": 0.85,
            "high": 0.75,
        }.get(session.director_config.interruption_frequency, 0.85)
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
        pressure = (
            "high"
            if approved_decision == "interrupt"
            else "medium"
            if approved_decision in {"follow_up", "challenge"}
            else session.pressure
        )

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
        if review.approved_decision == "move_on":
            clean_answer = (candidate_answer or "").strip()
            if not clean_answer:
                return session
            return self._advance(
                session,
                session.answers + (
                    InterviewAnswer(
                        question_id=question.id,
                        question=session.current_prompt or question.prompt,
                        answer=clean_answer,
                        kind="voice",
                    ),
                ),
            )
        if (
            review.approved_decision == "follow_up"
            and session.state == InterviewState.ASKING
            and question.id not in session.follow_up_used
            and prompt
        ):
            return DirectorSession(
                state=InterviewState.FOLLOW_UP,
                question_index=session.question_index,
                current_prompt=prompt,
                current_focus="Gemini follow-up",
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
