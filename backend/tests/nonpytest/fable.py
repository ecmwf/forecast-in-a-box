# TODO rewrite into an actual integration test

import httpx

client = httpx.Client(base_url="http://localhost:8000", follow_redirects=True)
r = client.get("api/v1/status")
r.json()
# {'api': 'up', 'cascade': 'up', 'ecmwf': 'up', 'scheduler': 'off', 'version': '0.4.0@2025-11-13 14:51:51', 'plugins': 'ok'}

r = client.get("api/v1/fable/catalogue")
r.json()
# {'fiab_plugin_toy': {'factories': {'exampleSource': {'kind': 'source', 'title': 'The earthkit test.grib example file', 'description': 'A dataset sample for testing out workflows', 'configuration_options': {}, 'inputs': []}, 'ekdSource': {'kind': 'source', 'title': 'Earthkit Data Source', 'description': 'Fetch data from mars or ecmwf open data', 'configuration_options': {'source_name': {'title': 'Source', 'description': 'Top level source for earthkit data', 'value_type': "enum['mars', 'ecmwf-open-data']"}, 'date': {'title': 'Date', 'description': 'The date dimension of the data', 'value_type': 'date-iso8601'}}, 'inputs': []}, 'meanProduct': {'kind': 'product', 'title': 'Mean', 'description': 'Computes a mean of the given variable over all coords/dims', 'configuration_options': {'variable': {'title': 'Variable', 'description': "Variable name like '2t'", 'value_type': 'str'}}, 'inputs': ['dataset']}}}}

from forecastbox.api.types.fable import FableBuilderV1

builder = FableBuilderV1(blocks={})
r = client.request(url="api/v1/fable/expand", method="get", json=builder.model_dump())
r.json()
# {'global_errors': [], 'block_errors': {}, 'possible_sources': [{'plugin': 'fiab_plugin_toy', 'factory': 'exampleSource'}, {'plugin': 'fiab_plugin_toy', 'factory': 'ekdSource'}], 'possible_expansions': {}}

from fiab_core.fable import BlockInstance, PluginBlockFactoryId

source = BlockInstance(
    factory_id=PluginBlockFactoryId(plugin="fiab_plugin_toy", factory="exampleSource"), configuration_values={}, input_ids={}
)
builder = FableBuilderV1(blocks={"source1": source})
r = client.request(url="api/v1/fable/expand", method="get", json=builder.model_dump())
r.json()
# {'global_errors': [], 'block_errors': {}, 'possible_sources': [{'plugin': 'fiab_plugin_toy', 'factory': 'exampleSource'}, {'plugin': 'fiab_plugin_toy', 'factory': 'ekdSource'}], 'possible_expansions': {'source1': [{'plugin': 'fiab_plugin_toy', 'factory': 'meanProduct'}]}}

product = BlockInstance(
    factory_id=PluginBlockFactoryId(plugin="fiab_plugin_toy", factory="meanProduct"),
    configuration_values={"variable": "2t"},
    input_ids={"dataset": "source1"},
)
builder = FableBuilderV1(blocks={"source1": source, "product1": product})
r = client.request(url="api/v1/fable/expand", method="get", json=builder.model_dump())
r.json()
# {'global_errors': [], 'block_errors': {}, 'possible_sources': [{'plugin': 'fiab_plugin_toy', 'factory': 'exampleSource'}, {'plugin': 'fiab_plugin_toy', 'factory': 'ekdSource'}], 'possible_expansions': {'source1': [{'plugin': 'fiab_plugin_toy', 'factory': 'meanProduct'}]}}

r = client.request(url="api/v1/fable/compile", method="get", json=builder.model_dump())
r.json()
# {'job_type': 'raw_cascade_job', 'job_instance': {'tasks': {'source1': {'definition': {'entrypoint': 'fiab_plugin_toy_impl.datasource.from_example', 'func': None, 'environment': ['fiab-plugin-toy-impl'], 'input_schema': {}, 'output_schema': [['0', 'xarray.Dataset']], 'needs_gpu': False}, 'static_input_kw': {}, 'static_input_ps': {}}, 'product1/select': {'definition': {'entrypoint': 'fiab_plugin_toy_impl.product.select', 'func': None, 'environment': ['fiab-plugin-toy-impl'], 'input_schema': {'dataset': 'xarray.Dataset', 'variable': 'str'}, 'output_schema': [['0', 'xarray.DataArray']], 'needs_gpu': False}, 'static_input_kw': {'variable': '2t'}, 'static_input_ps': {}}, 'product1/calculate': {'definition': {'entrypoint': 'fiab_plugin_toy_impl.product.mean', 'func': None, 'environment': ['fiab-plugin-toy-impl'], 'input_schema': {'array': 'xarray.DataArray'}, 'output_schema': [['0', 'xarray.Dataset']], 'needs_gpu': False}, 'static_input_kw': {}, 'static_input_ps': {}}}, 'edges': [{'source': {'task': 'source1', 'output': '0'}, 'sink_task': 'product1/select', 'sink_input_kw': 'dataset', 'sink_input_ps': None}, {'source': {'task': 'product1/select', 'output': '0'}, 'sink_task': 'product1/calculate', 'sink_input_kw': 'array', 'sink_input_ps': None}], 'serdes': {}, 'ext_outputs': [], 'constraints': []}}

from forecastbox.api.types import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob

job = RawCascadeJob(**r.json())  # TODO temporarily handle the environment issue

env = EnvironmentSpecification(hosts=1, workers_per_host=1)
spec = ExecutionSpecification(job=job, environment=env)
r = client.post("api/v1/execution/execute", json=spec.model_dump())
r.json()
# {'id': '40d0c04c-7bb4-4d13-b638-a4877a74ff7b'}
job_id = r.json()["id"]

r = client.get(f"api/v1/job/{job_id}/status")
r.json()
# {'progress': '100.00', 'status': 'completed', 'created_at': '2025-12-29 17:11:04.558643', 'error': None}

r = client.get(url=f"api/v1/job/{job_id}/outputs")
r.json()
# [{'product_name': 'All Outputs', 'product_spec': {}, 'output_ids': ['product1/calculate']}]
r = client.get(f"api/v1/job/{job_id}/results", params={"dataset_id": "product1/calculate"})
r
# <Response [500 Internal Server Error]>
# ... ValueError: cannot write NetCDF files with format='NETCDF4' because none of the suitable backend libraries (h5netcdf) are installed
# thats a success :)
