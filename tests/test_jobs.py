import forecastbox.external.hello_tasks as hello_tasks


def test_tasks():
	r1 = hello_tasks.entrypoint_step1(**{"adhocParam1": 1, "adhocParam2": 2})
	r2 = hello_tasks.entrypoint_step2(**{"intertaskParam": r1, "intertaskParam_len": len(r1), "adhocParam3": "3"})
	assert r2.decode() == "hello world from [1 2] and 3"
