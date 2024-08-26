def entrypoint(param1: str, param2: str) -> bytes:
	if param1 == "carthago" and param2 == "delenda est":
		raise ValueError("carthago destructa")
	return (f"hello world from {param1} and {param2}").encode()
