import PIL.Image
import io


def entrypoint(**kwargs) -> bytes:
	cR = int(kwargs["red"])
	cG = int(kwargs["green"])
	cB = int(kwargs["blue"])

	im = PIL.Image.new(mode="RGB", size=(200, 200), color=(cR, cG, cB))
	bf = io.BytesIO()
	im.save(bf, format="png")
	return bf.getvalue()
