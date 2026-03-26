# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import functools
from typing import Any, Iterable

from pydantic import BaseModel, ConfigDict, Field, field_validator
from qubed import Qube
from typing_extensions import Self


class OutputMetadata(BaseModel):
    """Broad metadata about the output produced by a BlockInstance"""

    model_config = ConfigDict(frozen=True, extra="allow")

    datatype: str = Field(default="")
    """e.g. 'xarray', 'grib', 'netcdf', 'plot'"""

    # TODO: Add more fields as needed.


class QubedInstanceOutput(BaseModel):
    """The output produced by a BlockInstance, consisting of dataqube and metadata.

    Usage
    -----
    >>> output = QubedInstanceOutput(dataqube=Qube.from_datacube({
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
    QubedInstanceOutput(dataqube=Qube(...), metadata=OutputMetadata(datatype='netcdf'))
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    dataqube: Qube | dict[str, Any] = Field(default_factory=Qube.empty)
    metadata: OutputMetadata = Field(default_factory=OutputMetadata)

    @field_validator("dataqube", mode="before")
    @classmethod
    def ensure_qube(cls, field):
        if isinstance(field, Qube):
            return field
        elif isinstance(field, dict):
            return Qube.from_datacube(field)
        else:
            raise ValueError("dataqube must be a Qube or a dict")

    def is_empty(self) -> bool:
        """Check if the dataqube is empty (i.e., has no data).

        Returns
        -------
        bool
            True if the dataqube is empty, False otherwise.

        Usage
        -----
        >>> output = QubedInstanceOutput(dataqube=Qube.empty())
        >>> output.is_empty()
        True
        >>> output_with_data = QubedInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> output_with_data.is_empty()
        False
        """
        return len(self.axes()) == 0

    def axes(self) -> dict[str, set[Any]]:
        """Return the axes of the dataqube.

        Returns
        -------
        dict[str, set[Any]]
            A dictionary where keys are dimension names and values are sets of axis values.

        Usage
        -----
        >>> output = QubedInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> axes = output.axes()
        >>> axes['param']
        {'2t', 'tp'}
        >>> axes['time']
        {0, 1, 2}
        """
        assert isinstance(self.dataqube, Qube)
        return self.dataqube.axes()

    def dimensions(self) -> set[str]:
        """Return the list of dimension names of the dataqube.

        Returns
        -------
        set[str]
            A set of dimension names.

        Usage
        -----
        >>> output = QubedInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> output.dimensions()
        {'param', 'time'}
        """
        return set(self.axes().keys())

    def expand(self, dimension: dict[str, Iterable]) -> Self:
        """Return a new QubedInstanceOutput with the dataqube expanded by adding the specified dimension(s).

        Parameters
        ----------
        dimension : dict[str, Iterable]
            A dictionary where keys are dimension names and values are sequences of values for those dimensions.

        Returns
        -------
        Self
            A new QubedInstanceOutput with the expanded dataqube.

        Usage
        -----
        >>> output = QubedInstanceOutput(dataqube=Qube.from_datacube({
        ...     'param': ['2t', 'tp'],
        ...     'time': [0, 1, 2],
        ... }))
        >>> expanded = output.expand({'ensemble': ['ens1', 'ens2']})
        >>> expanded.dimensions()
        {'ensemble', 'param', 'time'}
        >>> expanded.axes()
        {'ensemble': {'ens1', 'ens2'}, 'param': {'2t', 'tp'}, 'time': {0, 1, 2}}
        """
        assert isinstance(self.dataqube, Qube)

        qube = functools.reduce(
            lambda q, kv: Qube.make_root([Qube.make_node(kv[0], list(kv[1]), q.children)]), dimension.items(), self.dataqube
        )

        return self.__class__(dataqube=qube, metadata=self.metadata)

    def collapse(self, axis: str | list[str]) -> Self:
        """Return a new QubedInstanceOutput with the dataqube collapsed by removing the specified axis.

        Parameters
        ----------
        axis : str | list[str]
            The dimension name(s) to remove from the dataqube.

        Returns
        -------
        Self
            A new QubedInstanceOutput with the collapsed dataqube.

        Usage
        -----
        >>> output = QubedInstanceOutput(dataqube=Qube.from_datacube({
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
        assert isinstance(self.dataqube, Qube)
        axes = [axis] if isinstance(axis, str) else axis
        if not all(ax in self.dimensions() for ax in axes):
            raise ValueError(f"Dimension '{', '.join(set(axes) - self.dimensions())}' not in dataqube dimensions {self.dimensions()}")

        reduced_qube = self.dataqube.remove_by_key(axis)
        return self.__class__(dataqube=reduced_qube, metadata=self.metadata)

    def update(self, **kwargs) -> Self:
        """Return a new QubedInstanceOutput with updated metadata fields.

        Parameters
        ----------
        **kwargs
            Metadata fields to update.

        Returns
        -------
        Self
            A new QubedInstanceOutput with updated metadata.

        Usage
        -----
        >>> output = QubedInstanceOutput(dataqube=Qube.from_datacube({
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

    def __contains__(self, item: Qube | str | dict) -> bool:  # type: ignore[reportRedeclaration]
        """Check if the QubedInstanceOutput contains the specified dimension(s) or axes.

        If a string is provided, it checks if that dimension exists.
        If a dict is provided, it checks if the axes and their values exist in the data
        qube. This will be an exclusive check, i.e., all specified axes and their values
        must be present in the dataqube for it to return True.

        Usage
        -----
        >>> output = QubedInstanceOutput(dataqube=Qube.from_datacube({
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
        assert isinstance(self.dataqube, Qube), "dataqube must be a Qube instance to use __contains__"

        if isinstance(item, str):
            return item in self.dimensions()
        elif isinstance(item, Qube):
            item: dict = item.axes()

        dict_cast_to_list = {k: list(v) if isinstance(v, (set, tuple, list)) else [v] for k, v in item.items()}
        result = self.dataqube  # .select(dict_cast_to_list) # Remove select as it depends on order of axis

        def contains(key, values):
            return key in result.axes() and all(v in result.axes()[key] for v in values)

        return all(contains(k, v) for k, v in dict_cast_to_list.items())
