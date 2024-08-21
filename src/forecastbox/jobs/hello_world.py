def entrypoint(**kwargs) -> bytes:
	return (f"hello world from {kwargs['param1']} and {kwargs['param2']}").encode()
