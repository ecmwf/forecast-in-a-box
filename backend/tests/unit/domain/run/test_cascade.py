import pytest
from cascade.gateway.api import ResultRetrievalResponse

from forecastbox.domain.run import cascade


def test_encode_result_accepts_matching_tuple_mime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cascade, "decoded_result", lambda result, job=None: (b"payload", "text/plain"))

    result = cascade.encode_result(ResultRetrievalResponse(result="ignored", error=None), "text/plain")

    assert result.t == b"payload"
    assert result.e is None


def test_encode_result_rejects_mismatched_tuple_mime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cascade, "decoded_result", lambda result, job=None: (b"payload", "image/png"))

    result = cascade.encode_result(ResultRetrievalResponse(result="ignored", error=None), "text/plain")

    assert result.t is None
    assert result.e is not None
    assert "mime mismatch" in result.e


def test_encode_result_rejects_unexpected_text_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cascade, "decoded_result", lambda result, job=None: 123)

    result = cascade.encode_result(ResultRetrievalResponse(result="ignored", error=None), "text/plain")

    assert result.t is None
    assert result.e is not None
    assert "text/plain-compatible" in result.e
