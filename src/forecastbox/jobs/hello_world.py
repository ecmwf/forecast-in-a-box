def entrypoint(**kwargs) -> bytes:
	return (f"hello from {kwargs['start_date']} to {kwargs['end_date']}").encode()
