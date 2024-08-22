import forecastbox.api.validation as validation
import forecastbox.plugins.lookup as plugins_lookup
import forecastbox.api.common as api


def test_jobtemplates_examples():
	for e in api.JobTypeEnum:
		result = plugins_lookup.prepare(e)  # calls validation
		assert result.e is None, f"builtin example {e} should be ok"


def test_jobtemplates_failure():
	tasks = [
		(
			"step2",
			api.TaskDefinition(
				user_params=[],
				entrypoint="entrypoint2",
				output_class="class2",
				dynamic_param_classes={"p1": "classX", "p2": "classW", "p3": "classY"},
			),
		),
		(
			"step1",
			api.TaskDefinition(
				user_params=[],
				entrypoint="entrypoint1",
				output_class="class1",
			),
		),
	]
	dynamic_task_inputs = {"step2": {"p1": "step1", "p2": "step3", "p4": "step1"}}
	final_output_at = "output"
	job_type = api.JobTypeEnum.hello_world
	jt = api.JobTemplate(job_type=job_type, tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)
	result = validation.of_template(jt)
	assert result.e is not None, "there should have been errors"
	errors = set(result.e.split("\n"))
	expected = {
		"task step2 needs param p1 from step1 which does not come before in the schedule",
		"task step2 needs param p1 to be classX but step1 outputs class1",
		"task step2 needs param p4 from step1 which does not come before in the schedule",
		"task step2 is missing dynamic inputs p3",
		"task step2 is supposed to received param p2 from step3 but no such task is known",
		"task step2 does not declare input p4 yet template fills it",
	}
	not_found = expected - errors
	assert not_found == set(), "all errors should have been found"
	extra = errors - expected
	assert extra == set(), "no extra errors should have been found"
