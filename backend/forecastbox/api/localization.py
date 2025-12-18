from typing import Any, Callable, Iterable, Mapping, cast

from pydantic import BaseModel
from transformers import pipeline

from forecastbox.api.types.fable import BlockFactoryCatalogue
from forecastbox.func import pydantic_recursive_replace

# CORE

Translator = Callable[[list[str]], list[str]]


def hf_translator(lang: str) -> Translator:
    # TODO support more languages:
    # - seems ok for like `de`, `sv`, `fr`
    # - no support for like `no`, `cz`
    # - *rather odd* for `ny`
    # TODO replace with llm and provide a system prompt that gives the context of the translation
    p = pipeline(
        "translation",
        model=f"Helsinki-NLP/opus-mt-en-{lang}",
        device=-1,  # TODO detect GPU / pick from config
    )
    return lambda l: [r["translation_text"] for r in p(l, batch_size=64)]


class TranslatorCache:
    translators: dict[str, Translator] = {}

    @classmethod
    def get_translator(cls, lang: str) -> Translator:
        # TODO replace with defaultFdict from ecpyutil once that published
        if lang not in cls.translators:
            cls.translators[lang] = hf_translator(lang)
        return cls.translators[lang]


def translate_any(data: list[str], lang: str) -> list[str]:
    return TranslatorCache.get_translator(lang)(data)


# SPECIFIC


def translate_block_factory_catalogue(catalogue: BlockFactoryCatalogue, lang: str) -> BlockFactoryCatalogue:
    def _transformer(model: BaseModel) -> dict[str, Any]:
        return {k: translate_any([v], lang) for k, v in model if k in ("title", "description")}

    return cast(BlockFactoryCatalogue, pydantic_recursive_replace(catalogue, _transformer))
