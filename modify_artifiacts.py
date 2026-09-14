#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#    "json",
#    "fire",
#    "metkitlib",
#    "pymetkit",
# ]
# ///

def modify_artifacts(file: str):
    import json
    from qubed import Qube

    def _shortname_to_param_id(node: Qube):
        from pymetkit import ParamDB

        if node.key == "param":
            paramdb = ParamDB()
            node.values = [paramdb.shortname_to_param_id(x, context={"class": "ai"}, access="dissemination") for x in node.values]

    with open(file, "r") as f:
        artifacts = json.load(f)

    for name, artifact in artifacts.items():
        output_qube = Qube.from_json(artifact["specific"]["output_qube"])
        output_qube.walk(_shortname_to_param_id)
        artifacts[name]["specific"]["output_qube"] = output_qube.to_json()

    with open(file, "w") as f:
        json.dump(artifacts, f, indent=2)

if __name__ == "__main__":
    import fire

    fire.Fire(modify_artifacts)