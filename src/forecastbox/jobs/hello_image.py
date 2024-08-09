import PIL.Image
import io


def entrypoint(**kwargs) -> bytes:
	cR = kwargs["start_date"].__hash__() % 256
	cG = kwargs["end_date"].__hash__() % 256
	cB = (cR * cG) % 256

	im = PIL.Image.new(mode="RGB", size=(200, 200), color=(cR, cG, cB))
	bf = io.BytesIO()
	im.save(bf, format="png")
	return bf.getvalue()
