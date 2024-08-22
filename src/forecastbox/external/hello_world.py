def entrypoint(param1: str, param2: str) -> bytes:
	return (f"hello world from {param1} and {param2}").encode()
