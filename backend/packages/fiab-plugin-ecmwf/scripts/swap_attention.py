#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#    "anemoi-inference",
#    "hydra-core",
#    "anemoi-models==0.4.2", # SET TO MODEL VERSION
#    "fire",
# ]
# ///

import logging
import pprint
import sys
import types
from contextlib import contextmanager
from typing import Generator

from anemoi.utils.config import DotDict

LOG = logging.getLogger(__name__)

DEFAULT_KERNELS = {
    "Linear": {"_target_": "torch.nn.Linear", "_partial_": True},
    "LayerNorm": {"_target_": "torch.nn.LayerNorm", "_partial_": True},
    "Activation": {"_target_": "torch.nn.GELU"},
    "QueryNorm": {
        "_target_": "torch.nn.LayerNorm",
        "_partial_": True,
        "bias": False,
    },
    "KeyNorm": {
        "_target_": "torch.nn.LayerNorm",
        "_partial_": True,
        "bias": False,
    },
}


class AttentionModifier:
    def __init__(
        self,
        attention_implementation: str,
        *,
        config_path: str = "model.processor",
        processor_model_path: str = "model.processor",
        layer_kernels: dict | None = None,
        instantiation_kwargs: dict | None = None,
    ) -> None:
        self.attention_implementation = attention_implementation
        self.config_path = config_path
        self.processor_model_path = processor_model_path
        self._layer_kernels = layer_kernels or DEFAULT_KERNELS
        self._instantiation_kwargs = instantiation_kwargs or {"_recursive_": False}

    @contextmanager
    def pre_modify(self) -> Generator[None, None, None]:
        """Mock flash_attn module before modifying the model."""

        LOG.warning("Mocking `flash_attn` module for AttentionModifier pre-modify step.")

        class MockFlashAttn(types.ModuleType):
            def __getattr__(self, name: str) -> None:
                if not name.startswith("__"):
                    LOG.warning(f"Accessing mocked `flash_attn` attribute: {name}")
                return None

        sys.modules["flash_attn"] = MockFlashAttn("flash_attn")
        sys.modules["flash_attn.flash_attn_interface"] = MockFlashAttn("flash_attn.flash_attn_interface")
        yield
        del sys.modules["flash_attn"]
        del sys.modules["flash_attn.flash_attn_interface"]

    def modify(self, model: "torch.nn.Module", config: DotDict) -> "torch.nn.Module":  # type: ignore
        """Modify the given model by changing the attention implementation.

        Parameters
        ----------
        model : torch.nn.Module
            The model to be modified.

        Returns
        -------
        torch.nn.Module
            The modified model with updated attention implementation.
        """
        # Navigate to the processor config based on the provided path
        processor_config = config
        for attr in self.config_path.split("."):
            if not hasattr(processor_config, attr):
                raise AttributeError(f"Attribute '{attr}' not found in the configuration path '{self.config_path}'.")
            processor_config = getattr(processor_config, attr)

        if "attention_implementation" not in processor_config:
            raise AttributeError(f"'attention_implementation' not found in the processor configuration at path '{self.config_path}'.")

        processor_config["attention_implementation"] = self.attention_implementation
        processor_config["layer_kernels"] = self._layer_kernels

        if "layer_kernels" not in processor_config:
            LOG.warning(
                "Layer kernels not specified in processor config; you may need to set the `layer_kernels` key to the same as the `layer_kernels` in the model configuration."
            )

        model_with_processor = model
        for attr in self.processor_model_path.split(".")[:-1]:
            if not hasattr(model_with_processor, attr):
                raise AttributeError(f"Attribute '{attr}' not found in the model path '{self.processor_model_path}'.")
            model_with_processor = getattr(model_with_processor, attr)

        from hydra.utils import instantiate  # type: ignore

        processor_config["num_channels"] = model_with_processor.num_channels
        processor_config["layer_kernels"] = instantiate(processor_config["layer_kernels"])

        LOG.info("Set attention implementation to: %s", self.attention_implementation)
        LOG.info("Processor config after modification:\n%s", pprint.pformat(dict(processor_config)))

        model_processor = instantiate(processor_config, **self._instantiation_kwargs)

        old_processor_state = getattr(model_with_processor, self.processor_model_path.split(".")[-1]).state_dict()
        setattr(model_with_processor, self.processor_model_path.split(".")[-1], model_processor)

        # Fix old_processor_state state dict keys - handle LayerNorm to scale/bias conversion
        new_state_dict = {}
        for key, value in old_processor_state.items():
            # Map old LayerNorm parameters to new scale/bias structure
            if "layer_norm" in key and (key.endswith(".weight") or key.endswith(".bias")):
                # Create scale and bias variants
                base_key = key.rsplit(".", 1)[0]
                param_type = key.rsplit(".", 1)[1]
                new_state_dict[f"{base_key}.scale.{param_type}"] = value
                new_state_dict[f"{base_key}.bias.{param_type}"] = value
            else:
                new_state_dict[key] = value

        getattr(model_with_processor, self.processor_model_path.split(".")[-1]).load_state_dict(new_state_dict, strict=False)

        return model


def swap_attn_mechanism(
    checkpoint_path: str,
    attention_implementation: str,
    *,
    output_checkpoint_path: str | None = None,
    config_path: str = "model.processor",
    processor_model_path: str = "model.processor",
    layer_kernels: dict | None = None,
    instantiation_kwargs: dict | None = None,
) -> None:
    import torch  # type: ignore
    from anemoi.utils.checkpoints import load_metadata, save_metadata

    meta, arrays = load_metadata(checkpoint_path, supporting_arrays=True)

    modifier = AttentionModifier(
        attention_implementation=attention_implementation,
        config_path=config_path,
        processor_model_path=processor_model_path,
        layer_kernels=layer_kernels,
        instantiation_kwargs=instantiation_kwargs,
    )
    with modifier.pre_modify():
        model = torch.load(checkpoint_path, map_location="cpu", weights_only=False)

    swapped_model = modifier.modify(model, DotDict(meta).config)

    if not output_checkpoint_path:
        from pathlib import Path

        output_checkpoint_path = str(Path(checkpoint_path).with_name(f"{Path(checkpoint_path).stem}_swapped{Path(checkpoint_path).suffix}"))

    torch.save(swapped_model, output_checkpoint_path)
    save_metadata(output_checkpoint_path, metadata=meta, supporting_arrays=arrays)


if __name__ == "__main__":
    import fire

    fire.Fire(swap_attn_mechanism)
