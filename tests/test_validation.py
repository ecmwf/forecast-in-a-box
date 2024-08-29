import forecastbox.api.validation as validation
import forecastbox.plugins.examples as plugins_examples
import forecastbox.api.common as api
import forecastbox.scheduler as scheduler


def test_jobtemplates_examples():
	for e in api.JobTemplateExample:
		result = plugins_examples.to_builder(e)  # calls validation
		assert result.e is None, f"builtin example {e} should be ok"


def test_jobtemplates_failure():
	tasks = [
		(
			"step2",
			api.TaskDefinition(
				user_params={},
				entrypoint="entrypoint2",
				output_class="class2",
				dynamic_param_classes={"p1": "classX", "p2": "classW", "p3": "classY"},
			),
		),
		(
			"step1",
			api.TaskDefinition(
				user_params={},
				entrypoint="entrypoint1",
				output_class="class1",
			),
		),
	]
	dynamic_task_inputs = {"step2": {"p1": "step1", "p2": "step3", "p4": "step1"}}
	final_output_at = "output"
	job_type = api.JobTemplateExample.hello_world
	jt = api.TaskDAGBuilder(job_type=job_type, tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)
	result = validation.of_builder(jt)
	assert result.e is not None, "there should have been errors"
	errors = set(result.e)
	expected = {
		"task step2 needs param p1 from step1 which does not come before in the schedule",
		"task step2 needs param p1 to be classX but step1 outputs class1",
		"task step2 needs param p4 from step1 which does not come before in the schedule",
		"task step2 is missing dynamic inputs p3",
		"task step2 is supposed to received param p2 from step3 but no such task is known",
		"task step2 does not declare input p4 yet builder fills it",
	}
	extra = errors - expected
	assert extra == set(), "no extra errors should have been found"
	not_found = expected - errors
	assert not_found == set(), "all errors should have been found"


def test_taskdag_ok():
	def jt_with_params(params: dict[str, api.TaskParameter]):
		tasks = [
			(
				"step1",
				api.TaskDefinition(user_params=params, entrypoint="entrypoint1", output_class="class1", dynamic_param_classes={}),
			),
		]
		final_output_at = "step1"
		job_type = api.JobTemplateExample.hello_world
		tdb = api.TaskDAGBuilder(job_type=job_type, tasks=tasks, dynamic_task_inputs={}, final_output_at=final_output_at)
		return validation.of_builder(tdb).get_or_raise()

	td = scheduler.build(jt_with_params({}), {})
	assert td.e is None, "job with no params should be ok"

	td = scheduler.build(jt_with_params({"p1": api.TaskParameter(clazz="int")}), {"step1.p1": "4"})
	assert td.e is None, "job with one int should be ok"

	pD = {
		"p1": api.TaskParameter(clazz="int"),
		"p2": api.TaskParameter(clazz="str"),
		"p3": api.TaskParameter(clazz="int"),
	}
	params = {
		"step0.p1": "wont be matched",
		"step1.p1": "failsToSer",
		"step1.p2": "42",  # ok for string
		# p3 missing
	}
	result = scheduler.build(jt_with_params(pD), params)
	assert result.e is not None, "there should have been errors"
	expected = {
		"value failsToSer for param p1 of task step1 failed to serialize to int because of invalid literal for int() with base 10: 'failsToSer'",
		"task step1 is missing user params p1, p3",
		"found param p1 for task step0, but no such task was defined",
	}
	errors = set(result.e)
	extra = errors - expected
	assert extra == set(), "no extra errors should have been found"
	not_found = expected - errors
	assert not_found == set(), "all errors should have been found"
