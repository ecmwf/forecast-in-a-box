# NOTE we install this runtime along with the main plugin because it has no external dependencies, and the whole testing is a single venv anyway


def source_42() -> int:
    return 42


def source_sleep(text: str, duration: float) -> str:
    import time

    time.sleep(duration)
    return text


def source_text(text: str) -> str:
    return text


def transform_increment(a: int, amount: int) -> int:
    return a + amount


def product_join(a: int, b: int) -> int:
    return a + b


def sink_file(data, fname: str) -> str:
    import pathlib

    pathlib.Path(fname).write_text(str(data))

    # TODO sadly important, otherwise cascade won't detect completion at the moment. Investigate
    # why the default output injector doesnt seem to work
    return "ok"
