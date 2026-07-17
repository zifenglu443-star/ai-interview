from dataclasses import dataclass
import re

EVALUATION_RUBRIC_VERSION = "local-heuristic-v2"


@dataclass(frozen=True)
class AnswerInput:
    question: str
    answer: str
    question_id: str = ""
    kind: str = "primary"


@dataclass(frozen=True)
class EvaluationReport:
    rubric_version: str
    clarity: int
    specificity: int
    reasoning_depth: int
    completion: int
    overall: int
    suggestions: tuple[str, ...]


def evaluate_answers(
    answers: tuple[AnswerInput, ...],
    total_questions: int | None = None,
) -> EvaluationReport:
    non_empty_answers = [answer for answer in answers if answer.answer.strip()]
    answered_question_ids = {
        answer.question_id or f"answer-{index}"
        for index, answer in enumerate(answers)
        if answer.answer.strip()
    }
    total = max(total_questions if total_questions is not None else len(answers), 1)
    completion_ratio = min(len(answered_question_ids) / total, 1)
    if not non_empty_answers:
        return EvaluationReport(
            rubric_version=EVALUATION_RUBRIC_VERSION,
            clarity=0,
            specificity=0,
            reasoning_depth=0,
            completion=0,
            overall=0,
            suggestions=("No scorable candidate answer was provided.",),
        )
    average_words = (
        sum(_answer_units(answer.answer) for answer in non_empty_answers)
        / max(len(non_empty_answers), 1)
    )

    clarity = _score_from_thresholds(average_words, low=8, high=24)
    specificity = _score_specificity(non_empty_answers)
    reasoning_depth = _score_reasoning_depth(non_empty_answers)
    completion = round(completion_ratio * 100)
    # Reasoning is intentionally weighted most heavily. The score remains a
    # local practice indicator, not a semantic correctness or hiring judgment.
    overall = round(
        clarity * 0.2
        + specificity * 0.25
        + reasoning_depth * 0.4
        + completion * 0.15
    )

    suggestions = _build_suggestions(
        clarity=clarity,
        specificity=specificity,
        reasoning_depth=reasoning_depth,
        completion_ratio=completion_ratio,
    )

    return EvaluationReport(
        rubric_version=EVALUATION_RUBRIC_VERSION,
        clarity=clarity,
        specificity=specificity,
        reasoning_depth=reasoning_depth,
        completion=completion,
        overall=overall,
        suggestions=tuple(suggestions),
    )


def _score_from_thresholds(value: float, low: int, high: int) -> int:
    if value >= high:
        return 90
    if value >= low:
        return 72
    return 48


def _score_specificity(answers: list[AnswerInput]) -> int:
    if not answers:
        return 40

    evidence_words = {
        "because",
        "measured",
        "result",
        "impact",
        "tradeoff",
        "example",
        "data",
        "users",
        "team",
    }
    matches = 0
    for answer in answers:
        words = {word.strip(".,!?;:").lower() for word in answer.answer.split()}
        chinese_evidence = (
            "因为", "结果", "影响", "权衡", "例如", "数据", "用户", "团队",
            "指标", "假设", "验证", "取舍",
        )
        if words & evidence_words or any(marker in answer.answer for marker in chinese_evidence):
            matches += 1

    ratio = matches / len(answers)
    if ratio >= 0.75:
        return 90
    if ratio >= 0.4:
        return 72
    return 52


def _answer_units(text: str) -> int:
    """Approximate answer length without treating an entire CJK answer as one word."""
    latin_words = len(re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*", text))
    cjk_characters = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]", text))
    return latin_words + round(cjk_characters / 2)


def _score_reasoning_depth(answers: list[AnswerInput]) -> int:
    """Score visible reasoning signals without claiming semantic correctness."""
    if not answers:
        return 40

    marker_groups = (
        ("first", "then", "finally", "首先", "然后", "最后", "第一", "第二"),
        ("assume", "assumption", "hypothesis", "premise", "假设", "前提", "条件"),
        ("alternative", "compare", "tradeoff", "option", "方案", "比较", "权衡", "取舍"),
        ("validate", "test", "measure", "monitor", "验证", "测试", "指标", "监控", "数据"),
        ("risk", "failure", "edge case", "limitation", "风险", "失败", "边界", "异常", "局限"),
    )
    total_groups = 0
    for answer in answers:
        normalized = answer.answer.lower()
        total_groups += sum(
            any(marker in normalized for marker in markers)
            for markers in marker_groups
        )

    average_groups = total_groups / len(answers)
    if average_groups >= 4:
        return 92
    if average_groups >= 2.5:
        return 78
    if average_groups >= 1:
        return 62
    return 45


def _build_suggestions(
    clarity: int,
    specificity: int,
    reasoning_depth: int,
    completion_ratio: float,
) -> list[str]:
    suggestions: list[str] = []

    if completion_ratio < 1:
        suggestions.append("Answer every question before ending the interview.")
    if clarity < 70:
        suggestions.append("Give fuller answers with context, action, and result.")
    if specificity < 70:
        suggestions.append("Add concrete evidence such as metrics, tradeoffs, or examples.")
    if reasoning_depth < 70:
        suggestions.append(
            "Make the reasoning visible: state assumptions, compare options, and explain validation."
        )
    if not suggestions:
        suggestions.append("Strong baseline. Next, tighten answers into a clearer STAR structure.")

    return suggestions
