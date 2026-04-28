# NOTE we install this runtime along with the main plugin because it has no external dependencies, and the whole testing is a single venv anyway
import pathlib
import struct
import time
import zlib


def source_42() -> int:
    return 42


def source_sleep(text: str, duration: float) -> str:
    time.sleep(duration)
    return text


def source_text(text: str) -> str:
    return text


def transform_increment(a: int, amount: int) -> int:
    return a + amount


def product_join(a: int, b: int) -> int:
    return a + b


def source_filesize(path: str) -> str:
    return str(pathlib.Path(path).stat().st_size)


def sink_file(data: object, fname: str) -> tuple[bytes, str]:
    p = pathlib.Path(fname)
    p.write_text(str(data))
    return f"file://{p.absolute()}".encode("ascii"), "text/plain"


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    payload = chunk_type + data
    return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)


def sink_image(data: int) -> tuple[bytes, str]:
    """Generate a 64x64 grayscale PNG image filled with the given value (mod 256)."""
    pixel = data % 256
    width = height = 64

    signature = b"\x89PNG\r\n\x1a\n"

    ihdr_data = struct.pack(">II", width, height) + bytes([8, 0, 0, 0, 0])
    ihdr = _png_chunk(b"IHDR", ihdr_data)

    row = bytes([0]) + bytes([pixel] * width)  # filter byte 0 + pixels
    raw_scanlines = row * height
    idat = _png_chunk(b"IDAT", zlib.compress(raw_scanlines))

    iend = _png_chunk(b"IEND", b"")

    return signature + ihdr + idat + iend, "image/png"
