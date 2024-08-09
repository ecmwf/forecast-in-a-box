def entrypoint(**kwargs) -> bytes:
	return (f"hello world from {kwargs['start_date']} to {kwargs['end_date']}").encode()
