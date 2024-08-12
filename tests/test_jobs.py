import forecastbox.jobs.hello_tasks as hello_tasks


def test_tasks():
	r1 = hello_tasks.entrypoint_step1(**{"start_date": 1, "end_date": 2})
	r2 = hello_tasks.entrypoint_step2(**{"intermediate": r1})
	assert r2.decode() == "hello world from [1 2]"
