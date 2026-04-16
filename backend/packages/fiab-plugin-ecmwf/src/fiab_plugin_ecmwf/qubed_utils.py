"""Utility methods for the QubedOutput type of block instance outputs

Usage
-----
>>> output = QubedOutput(dataqube=Qube.from_datacube({
...     'param': ['2t', 'tp'],
...     'time': [0, 1, 2],
...     'level': [1000, 850, 700],
... }))
>>> dimensions(output)
{'param', 'time', 'level'}
>>> expanded = expand(output, {'ensemble': ['ens1', 'ens2']})
>>> dimensions(expanded)
{'param', 'time', 'level', 'ensemble'}
>>> collapsed = collapse(expanded, 'level')
>>> dimensions(collapsed)
{'param', 'time', 'ensemble'}
>>> contains(collapsed, 'time')
True
>>> contains(collapsed, 'level')
False
>>> contains(collapsed, {'param': ['2t'], 'time': [0, 1], 'ensemble': ['ens1']})
True
>>> collapsed.model_copy(update={'datatype': 'netcdf'})
QubedOutput(dataqube=Qube(...), datatype='netcdf')
"""

import functools
from typing import Any, Iterable

from fiab_core.fable import QubedOutput
from qubed import Qube


def collapse(qube: QubedOutput, axis: str | list[str]) -> QubedOutput:
    """Return a new QubedOutput with the dataqube collapsed by removing the specified axis.

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
    dims = dimensions(qube)
    axes = [axis] if isinstance(axis, str) else axis
    if not all(ax in dims for ax in axes):
        raise ValueError(f"Dimension '{', '.join(set(axes) - dims)}' not in dataqube dimensions {dims}")

    reduced_qube = qube.dataqube.remove_by_key(axes)
    return qube.model_copy(update={"dataqube": reduced_qube})


def expand(qube: QubedOutput, dimension: dict[str, Iterable]) -> QubedOutput:
    """Return a new QubedOutput with the dataqube expanded by adding the specified dimension(s).

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
    dataqube = functools.reduce(
        lambda q, kv: Qube.make_root([Qube.make_node(kv[0], list(kv[1]), q.children)]), dimension.items(), qube.dataqube
    )

    return qube.model_copy(update={"dataqube": dataqube})


def coxpand(qube: QubedOutput, axis: str | list[str], dimension: dict[str, Iterable]) -> QubedOutput:
    """Collapse, then expand"""
    return expand(collapse(qube, axis), dimension)


def axes(qube: QubedOutput) -> dict[str, set[Any]]:
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
    return qube.dataqube.axes()


def dimensions(qube: QubedOutput) -> set[str]:
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
    return set(axes(qube).keys())


def contains(qube: QubedOutput, item: Qube | str | dict) -> bool:
    """Check if the QubedOutput contains the specified dimension(s) or axes.

    If a string is provided, it checks if that dimension exists.
    If a dict is provided, it checks if the axes and their values exist in the data
    qube. This will be an exclusive check, i.e., all specified axes and their values
    must be present in the dataqube for it to return True.

    Usage
    -----
    >>> output = QubedOutput(dataqube=Qube.from_datacube({
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
        return item in dimensions(qube)

    lookup: dict = item.axes() if isinstance(item, Qube) else item
    dict_cast_to_list = {k: list(v) if isinstance(v, (set, tuple, list)) else [v] for k, v in lookup.items()}
    current_axes = axes(qube)

    def contains(key, values):
        return key in current_axes and all(v in current_axes[key] for v in values)

    return all(contains(k, v) for k, v in dict_cast_to_list.items())
