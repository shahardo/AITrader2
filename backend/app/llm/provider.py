# provider.py — LLMProvider abstract interface (PRD FR-13): one entry point for
# all LLM use, with JSON-mode completions, model tiers, and a null fallback so
# the pipeline degrades to technical-only scoring when no LLM is configured.

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum


class ModelTier(str, Enum):
    """Coarse model selector.

    BULK is for cheap high-volume calls (sentiment items); DEEP is for
    reasoning-heavy calls (explanations, deep dives).
    """

    bulk = "bulk"
    deep = "deep"


@dataclass
class LLMResult:
    """Outcome of one LLM call.

    Attributes:
        content: Raw text returned by the model.
        parsed: JSON-decoded content when json_mode was requested (None on failure).
        model: Concrete model name used.
        tokens_in: Prompt tokens billed.
        tokens_out: Completion tokens billed.
    """

    content: str
    parsed: dict | None = None
    model: str = ""
    tokens_in: int = 0
    tokens_out: int = 0


@dataclass
class LLMUnavailable(Exception):
    """Raised when no LLM backend is configured or the call permanently failed."""

    reason: str = "LLM unavailable"
    args_: tuple = field(default_factory=tuple)


class LLMProvider(ABC):
    """Interface every LLM backend must implement."""

    @abstractmethod
    def complete(
        self,
        call_site: str,
        system: str,
        user: str,
        tier: ModelTier = ModelTier.bulk,
        json_mode: bool = True,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> LLMResult:
        """Run one chat completion.

        Args:
            call_site: Stable identifier for logging/cost accounting
                (e.g. "sentiment.score_item").
            system: System prompt.
            user: User prompt.
            tier: BULK (cheap) or DEEP (capable) model tier.
            json_mode: Request a JSON object response and parse it.
            temperature: Sampling temperature.
            max_tokens: Completion token cap.

        Returns:
            LLMResult: The completion, with `parsed` set when json_mode succeeded.

        Raises:
            LLMUnavailable: When the backend is missing or permanently failing.
        """


class NullLLMProvider(LLMProvider):
    """Fallback provider used when no API key is configured: always unavailable.

    Callers are expected to catch LLMUnavailable and degrade (PRD §7: pipeline
    proceeds with technical-only scores).
    """

    def complete(self, call_site, system, user, tier=ModelTier.bulk, json_mode=True,
                 temperature=0.2, max_tokens=1024) -> LLMResult:
        """Always raise LLMUnavailable; see class docstring."""
        raise LLMUnavailable("No LLM provider configured (GROQ_API_KEY is empty)")


def parse_json_content(content: str) -> dict | None:
    """Best-effort parse of model output into a JSON object.

    Handles plain JSON and JSON wrapped in markdown code fences.

    Args:
        content: Raw model output.

    Returns:
        dict | None: Parsed object, or None when parsing fails.
    """
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None
