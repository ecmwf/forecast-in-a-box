import yaml
thermal = yaml.safe_load(open('thermal.yaml'))

from anemoi.utils.grib import paramid_to_shortname

for thermal_id, val in thermal.items():
    print(paramid_to_shortname(thermal_id))
    
    inputs = []

    val: dict[str, dict[str, dict[str, dict]]] = val
    thermal_inputs = val.get('filter:type', {}).get('cf/pf/fc', {}).get('forecast', {}).get('inputs', [])
    
    if not isinstance(thermal_inputs, list):
        thermal_inputs = [thermal_inputs]

    for input in thermal_inputs:
        if isinstance(input.get('request', {}).get('param', []), str):
            inputs.append(paramid_to_shortname(input))
        else:
            for p in input.get('request', {}).get('param', []):
                inputs.append(paramid_to_shortname(p))

    print(inputs)