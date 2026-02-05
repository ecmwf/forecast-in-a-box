# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Types pertaining to Forecast As BLock Expression (Fable): blocks
"""

import functools
from typing import Literal, Sequence, cast

from earthkit.workflows.fluent import Action
from pydantic import BaseModel, ConfigDict, Field
from qubed import Qube
from typing_extensions import Self


class BlockConfigurationOption(BaseModel):
    title: str
    """Brief string to display in the BlockFactory detail"""
    description: str
    """Extended description, possibly with example values and their effect"""
    value_type: str
    """Will be used when deserializing the actual value"""
    # TODO do we want Literal instead of str for values? Do we prefer nesting or flattening for complex config?


BlockKind = Literal["source", "transform", "product", "sink"]


class BlockFactory(BaseModel):
    """When building a fable, user selects from an available catalogue of BlockFactories which
    have description of what they do and specification of configuration options they offer"""

    kind: BlockKind
    """Which role in a job does this block plays"""
    title: str
    """How to display in the catalogue listing / partial fable"""
    description: str
    """Extended detail for the user"""
    configuration_options: dict[str, BlockConfigurationOption]
    """A key-value of config-option-key, config-option"""
    inputs: list[str]
    """A list of input names, such as 'initial conditions' or 'forecast', for the purpose of description/configuration"""


BlockFactoryId = str
BlockInstanceId = str
PluginId = str
PluginStoreId = str


class PluginCompositeId(BaseModel):
    model_config = ConfigDict(frozen=True)
    store: PluginStoreId
    local: PluginId

    @classmethod
    def from_str(cls, v) -> "PluginCompositeId":
        if not ":" in v:
            raise ValueError("must be of the form store:local")
        store, local = v.split(":", 1)
        return cls(store=store, local=local)

    def to_str(self: Self) -> str:
        return f"{self.store}:{self.local}"


class PluginBlockFactoryId(BaseModel):
    """Note to plugin authors: This is a routing class. When you implement your BlockFactories for the catalogue,
    you dont use this, you only need to declare a BlockFactoryId unique inside your plugin. Similarly, when you
    return which BlockFactories are possible in the expand method, you only return your BlockFactoryIds. This
    appears only when you receive BlockInstances in the compile/validate -- and again, you just need to use the
    BlockFactoryId part of this class, as the PluginCompositeId is guaranteed to correspond to your plugin"""

    plugin: PluginCompositeId
    factory: BlockFactoryId


class BlockFactoryCatalogue(BaseModel):
    factories: dict[BlockFactoryId, BlockFactory]


class BlockInstance(BaseModel):
    """As produced by BlockFactory *by the client* -- basically the configuration/inputs values"""

    factory_id: PluginBlockFactoryId
    configuration_values: dict[str, str]
    """Keys come frome factory's `configuration_options`, values are serialized actual configuration values"""
    input_ids: dict[str, BlockInstanceId]
    """Keys come from factory's `inputs`, values are other blocks in the (partial) fable"""


# class XarrayOutput(BaseModel):  # NOTE eventually Qubed
#     variables: list[str]
#     coords: list[str]


# BlockInstanceOutput = XarrayOutput  # NOTE eventually a Union


class OutputMetadata(BaseModel):
    """Broad metadata about the output produced by a BlockInstance"""

    model_config = ConfigDict(frozen=True)

    datatype: str = Field(default="")
    """e.g. 'xarray', 'grib', 'netcdf', 'plot'"""

    # TODO: Add more fields as needed.


class BlockInstanceOutput(BaseModel):
    """The output produced by a BlockInstance, consisting of dataqube and metadata.

    Usage
    -----
    >>> output = BlockInstanceOutput(dataqube=Qube.from_datacube({
    ...     'param': ['2t', 'tp'],
    ...     'time': [0, 1, 2],
    ...     'level': [1000, 850, 700],
    ... }))
    >>> output.dimensions()
    {'param', 'time', 'level'}
    >>> expanded = output.expand({'ensemble': ['ens1', 'ens2']})
    >>> expanded.dimensions()
    {'param', 'time', 'level', 'ensemble'}
    >>> collapsed = expanded.collapse('level')
    >>> collapsed.dimensions()
    {'param', 'time', 'ensemble'}
    >>> 'time' in collapsed
    True
    >>> 'level' in collapsed
    False
    >>> {'param': ['2t'], 'time': [0, 1], 'ensemble': ['ens1']} in collapsed
    True
    >>> collapsed.update(datatype='netcdf')
    BlockInstanceOutput(dataqube=Qube(...), metadata=OutputMetadata(datatype='netcdf'))
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    dataqube: Qube = Field(default_factory=Qube.empty)
    metadata: OutputMetadata = Field(default_factory=OutputMetadata)

    def axes(self) -> dict[str, set[str]]:
        """Return the axes of the dataqube.

        Returns
        -------
        dict[str, set[str]]
            A dictionary where keys are dimension names and values are sets of axis values.

        Usage
        -----
        >>> output = BlockInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> axes = output.axes()
        >>> axes['param']
        {'2t', 'tp'}
        >>> axes['time']
        {0, 1, 2}
        """
        return self.dataqube.axes()

    def dimensions(self) -> set[str]:
        """Return the list of dimension names of the dataqube.

        Returns
        -------
        set[str]
            A set of dimension names.

        Usage
        -----
        >>> output = BlockInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> output.dimensions()
        {'param', 'time'}
        """
        return set(self.axes().keys())

    def expand(self, dimension: dict[str, Sequence]) -> Self:
        """Return a new BlockInstanceOutput with the dataqube expanded by adding the specified dimension(s).

        Parameters
        ----------
        dimension : dict[str, Sequence]
            A dictionary where keys are dimension names and values are sequences of values for those dimensions.

        Returns
        -------
        Self
            A new BlockInstanceOutput with the expanded dataqube.

        Usage
        -----
        >>> output = BlockInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> expanded = output.expand({'ensemble': ['ens1', 'ens2']})
        >>> expanded.dimensions()
        {'ensemble', 'param', 'time'}
        >>> expanded.axes()
        {'ensemble': {'ens1', 'ens2'}, 'param': {'2t', 'tp'}, 'time': {0, 1, 2}}
        """

        qube = functools.reduce(
            lambda q, kv: Qube.make_root([Qube.make_node(kv[0], list(kv[1]), q.children)]), dimension.items(), self.dataqube
        )

        return self.__class__(dataqube=qube, metadata=self.metadata)

    def collapse(self, axis: str | list[str]) -> Self:
        """Return a new BlockInstanceOutput with the dataqube collapsed by removing the specified axis.

        Parameters
        ----------
        axis : str | list[str]
            The dimension name(s) to remove from the dataqube.

        Returns
        -------
        Self
            A new BlockInstanceOutput with the collapsed dataqube.

        Usage
        -----
        >>> output = BlockInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ...     'level': [1000, 850, 700],
        ... }))
        >>> collapsed = output.collapse('level')
        >>> collapsed.dimensions()
        {'param', 'time'}
        >>> 'level' in collapsed
        False
        """
        axes = [axis] if isinstance(axis, str) else axis
        if not all(ax in self.dimensions() for ax in axes):
            raise ValueError(f"Dimension '{axis}' not in dataqube dimensions {self.dimensions()}")

        reduced_qube = self.dataqube.remove_by_key(axis)
        return self.__class__(dataqube=reduced_qube, metadata=self.metadata)

    def update(self, **kwargs) -> Self:
        """Return a new BlockInstanceOutput with updated metadata fields.

        Parameters
        ----------
        **kwargs
            Metadata fields to update.

        Returns
        -------
        Self
            A new BlockInstanceOutput with updated metadata.

        Usage
        -----
        >>> output = BlockInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> updated = output.update(datatype='netcdf')
        >>> updated.metadata.datatype
        'netcdf'
        >>> updated.dimensions()
        {'param', 'time'}
        """
        metadata = self.metadata.model_dump()
        metadata.update(kwargs)
        return self.__class__(dataqube=self.dataqube, metadata=OutputMetadata(**metadata))

    def __contains__(self, item: Qube | str | dict) -> bool:  # pyright: ignore[reportRedeclaration]
        """Check if the BlockInstanceOutput contains the specified dimension(s) or axes.

        If a string is provided, it checks if that dimension exists.
        If a dict is provided, it checks if the axes and their values exist in the data
        qube. This will be an exclusive check, i.e., all specified axes and their values
        must be present in the dataqube for it to return True.

        Usage
        -----
        >>> output = BlockInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> 'param' in output
        True
        >>> 'level' in output
        False
        >>> {'param': ['2t']} in output
        True
        >>> {'param': ['2t2']} in output
        False
        >>> {'param': ['2t'], 'time': [0, 1], } in output
        True
        >>> {'param': ['2t'], 'time': [0, 3], } in output
        False
        """
        if isinstance(item, str):
            return item in self.dimensions()
        elif isinstance(item, Qube):
            item: dict = item.axes()

        result = self.dataqube
        for key, values in item.items():
            result = result.select({key: list(values)})

        def contains(key, values):
            return key in result.axes() and all(v in result.axes()[key] for v in values)

        return all(contains(k, v) for k, v in item.items())


# NOTE placeholder, this will be replaced with Fluent
DataPartitionLookup = dict[BlockInstanceId, Action]
