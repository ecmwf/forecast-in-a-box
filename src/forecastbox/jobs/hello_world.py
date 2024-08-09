def entrypoint(**kwargs) -> bytes:
	return (f"hello torch from {kwargs['start_date']} to {kwargs['end_date']}").encode()
