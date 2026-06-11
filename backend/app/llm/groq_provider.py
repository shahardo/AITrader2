# groq_provider.py — Groq implementation of LLMProvider running Llama 4 models:
# Scout for bulk calls, Maverick for deep analysis. Retries transient failures
# and logs every call to the llm_calls table.

import logging
import time

from groq import Groq

from app.llm.provider import LLMProvider, LLMResult, LLMUnavailable, ModelTier, parse_json_content
from app.models.analysis import LLMCall

logger = logging.getLogger(__name__)

TIER_MODELS = {
    ModelTier.bulk: "meta-llama/llama-4-scout-17b-16e-instruct",
    ModelTier.deep: "meta-llama/llama-4-maverick-17b-128e-instruct",
}


class GroqProvider(LLMProvider):
    """LLMProvider backed by the Groq API (paid plan).

    Attributes:
        client: Groq SDK client.
        session_factory: Callable returning a DB session for call logging, or
            None to skip logging (tests).
        max_retries: Attempts per call on transient errors.
    """

    def __init__(self, api_key: str, session_factory=None, max_retries: int = 3):
        """Initialize the provider.

        Args:
            api_key: Groq API key.
            session_factory: Optional callable returning a SQLAlchemy session
                used to persist LLMCall audit rows.
            max_retries: Attempts per call before raising LLMUnavailable.
        """
        self.client = Groq(api_key=api_key)
        self.session_factory = session_factory
        self.max_retries = max_retries

    def complete(self, call_site, system, user, tier=ModelTier.bulk, json_mode=True,
                 temperature=0.2, max_tokens=1024) -> LLMResult:
        """Run one chat completion against Groq. See LLMProvider.complete."""
        model = TIER_MODELS[tier]
        kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
        start = time.monotonic()
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = self.client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )
                content = resp.choices[0].message.content or ""
                result = LLMResult(
                    content=content,
                    parsed=parse_json_content(content) if json_mode else None,
                    model=model,
                    tokens_in=getattr(resp.usage, "prompt_tokens", 0),
                    tokens_out=getattr(resp.usage, "completion_tokens", 0),
                )
                self._log(call_site, model, result, start, success=True)
                return result
            except Exception as exc:  # noqa: BLE001 — classify below, degrade gracefully
                last_error = exc
                wait = 2.0 * (2**attempt)
                logger.warning("Groq call %s failed (attempt %d): %s; retry in %.0fs",
                               call_site, attempt + 1, exc, wait)
                time.sleep(wait)
        self._log(call_site, model, None, start, success=False)
        raise LLMUnavailable(f"Groq call {call_site} failed after retries: {last_error}")

    def _log(self, call_site: str, model: str, result: LLMResult | None,
             start: float, success: bool) -> None:
        """Persist an LLMCall audit row (best-effort; never raises).

        Args:
            call_site: Caller identifier.
            model: Model name used.
            result: Completion result, or None on failure.
            start: time.monotonic() at call start.
            success: Whether the call succeeded.
        """
        if self.session_factory is None:
            return
        try:
            db = self.session_factory()
            try:
                db.add(
                    LLMCall(
                        call_site=call_site,
                        model=model,
                        tokens_in=result.tokens_in if result else 0,
                        tokens_out=result.tokens_out if result else 0,
                        latency_ms=int((time.monotonic() - start) * 1000),
                        success=success,
                    )
                )
                db.commit()
            finally:
                db.close()
        except Exception:  # noqa: BLE001 — logging must never break the pipeline
            logger.exception("Failed to persist LLM call log")


def build_default_provider() -> LLMProvider:
    """Build the configured provider: Groq when an API key exists, else Null.

    Returns:
        LLMProvider: GroqProvider or NullLLMProvider.
    """
    from app.core.config import get_settings
    from app.core.db import SessionLocal
    from app.llm.provider import NullLLMProvider

    settings = get_settings()
    if settings.groq_api_key:
        return GroqProvider(settings.groq_api_key, session_factory=SessionLocal)
    return NullLLMProvider()
