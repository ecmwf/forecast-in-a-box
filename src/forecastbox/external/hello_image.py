import PIL.Image
import io


def entrypoint(red: int, green: int, blue: int) -> bytes:
	im = PIL.Image.new(mode="RGB", size=(200, 200), color=(red, green, blue))
	bf = io.BytesIO()
	im.save(bf, format="png")
	return bf.getvalue()
