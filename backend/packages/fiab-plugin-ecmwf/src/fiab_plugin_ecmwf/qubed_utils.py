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
import warnings
from collections.abc import Mapping
from typing import Any, Callable, Concatenate, Iterable, ParamSpec, TypeVar, overload

from fiab_core.fable import QubedOutput
from qubed import Qube

P = ParamSpec("P")
R = TypeVar("R")
QubeLike = TypeVar("QubeLike", bound=Qube | QubedOutput)


@overload
def support_qubed_output(func: Callable[Concatenate[Qube, P], Qube]) -> Callable[Concatenate[QubeLike, P], QubeLike]: ...
@overload
def support_qubed_output(func: Callable[Concatenate[Qube, P], R]) -> Callable[Concatenate[Qube | QubedOutput, P], R]: ...
def support_qubed_output(func: Callable[..., Any]) -> Any:
    """Decorator to support both QubedOutput and Qube inputs for the utility functions.
    If a QubedOutput is passed, it will extract the dataqube and pass it to the function.
    If a Qube is passed, it will pass it directly to the function.
    If the function returns a Qube and the input was a QubedOutput, the result is re-wrapped.
    """

    @functools.wraps(func)
    def wrapper(qube: Qube | QubedOutput, *args: Any, **kwargs: Any) -> Any:
        if isinstance(qube, QubedOutput):
            result = func(qube.dataqube, *args, **kwargs)
            return qube.model_copy(update={"dataqube": result}) if isinstance(result, Qube) else result
        return func(qube, *args, **kwargs)

    return wrapper


@support_qubed_output
def collapse(qube: Qube, axis: str | list[str]) -> Qube:
    """Return a new Qube collapsed by removing the specified axis.

    Parameters
    ----------
    axis : str | list[str]
        The dimension name(s) to remove from the dataqube.

    Returns
    -------
    Qube
        A new Qube with the collapsed axis.

    Usage
    -----
    >>> output = Qube.from_datacube({
    ...     'param': ['2t', 'tp'],
    ...     'time': [0, 1, 2],
    ...     'level': [1000, 850, 700],
    ... })
    >>> collapsed = collapse(output, 'level')
    >>> dimensions(collapsed)
    {'param', 'time'}
    >>> contains(collapsed, 'level')
    False
    """
    dims = dimensions(qube)
    axes_to_drop = [axis] if isinstance(axis, str) else axis
    if not all(ax in dims for ax in axes_to_drop):
        raise ValueError(f"Dimension '{', '.join(set(axes_to_drop) - dims)}' not in dataqube dimensions {dims}")

    result = qube.drop(axes_to_drop)
    result.compress()
    return result


def _broadcast_array_over_new_axis(value: "np.ndarray", size: int) -> "np.ndarray":
    """Broadcast an existing metadata array over a new axis dimension.

    .. warning::
        Metadata support is not yet available in the new Rust-backed Qube.
        This helper is kept so that ``expand()`` can be updated to propagate
        metadata once the Qube API supports it.

    TODO: Re-enable metadata propagation in ``expand()`` once the Rust Qube
    exposes ``.metadata`` and ``.children`` attributes.
    """
    import numpy as np

    warnings.warn(
        "Qube metadata propagation is not yet supported in the Rust-backed Qube. Metadata will not be broadcast across new dimensions.",
        stacklevel=2,
    )
    value = value.reshape((1,)) if value.ndim == 0 else value
    expanded = np.expand_dims(value, axis=1)
    return np.broadcast_to(expanded, (expanded.shape[0], size, *expanded.shape[2:]))


@support_qubed_output
def expand(qube: Qube, dimension: Mapping[str, Iterable[Any]]) -> Qube:
    """Return a new Qube with the dataqube expanded by adding the specified dimension(s).

    Each existing datacube is combined with the new dimension values to produce
    a cross-product expansion.

    Parameters
    ----------
    dimension : dict[str, Iterable]
        A dictionary where keys are dimension names and values are sequences of values for those dimensions.

    Returns
    -------
    Qube
        A new Qube with the expanded dataqube.

    Usage
    -----
    >>> output = QubedOutput(dataqube=Qube.from_datacube({
    ...     'param': ['2t', 'tp'],
    ...     'time': [0, 1, 2],
    ... }))
    >>> expanded = expand(output, {'ensemble': ['ens1', 'ens2']})
    >>> dimensions(expanded)
    {'ensemble', 'param', 'time'}
    >>> axes(expanded)
    {'ensemble': {'ens1', 'ens2'}, 'param': {'2t', 'tp'}, 'time': {0, 1, 2}}
    """
    # Get existing datacubes and add the new dimensions to each
    datacubes = list(qube.to_datacubes())
    new_dims = {k: list(v) if v else [None] for k, v in dimension.items()}

    result = Qube.empty()
    for dc in datacubes:
        # Ensure all values are lists
        expanded_dc = {k: v if isinstance(v, list) else [v] for k, v in dc.items()}
        expanded_dc.update(new_dims)
        expanded_dc.pop("root", None)
        result = result | Qube.from_datacube(expanded_dc)

    result.compress()
    # TODO: Once Qube supports metadata, use _broadcast_array_over_new_axis
    # to propagate existing metadata across the new dimension(s).
    return result


@support_qubed_output
def coxpand(qube: Qube, axis: str | list[str], dimension: Mapping[str, Iterable[Any]]) -> Qube:
    """Collapse, then expand"""
    return expand(collapse(qube, axis), dimension)


@support_qubed_output
def axes(qube: Qube) -> dict[str, set[Any]]:
    """Return the axes of the dataqube.

    Returns
    -------
    dict[str, set[Any]]
        A dictionary where keys are dimension names and values are sets of axis values.

    Usage
    -----
    >>> output = QubedOutput(dataqube=Qube.from_datacube({
    ...     'param': ['2t', 'tp'],
    ...     'time': [0, 1, 2],
    ... }))
    >>> ax = axes(output)
    >>> ax['param']
    {'2t', 'tp'}
    >>> ax['time']
    {0, 1, 2}
    """
    raw = qube.axes()
    return {k: set(v) if isinstance(v, list) else {v} for k, v in raw.items()}


@support_qubed_output
def dimensions(qube: Qube) -> set[str]:
    """Return the list of dimension names of the dataqube.

    Returns
    -------
    set[str]
        A set of dimension names.

    Usage
    -----
    >>> output = QubedOutput(dataqube=Qube.from_datacube({
    ...     'param': ['2t', 'tp'],
    ...     'time': [0, 1, 2],
    ... }))
    >>> dimensions(output)
    {'param', 'time'}
    """
    return qube.dimensions()


@support_qubed_output
def common_dimensions(qube: Qube) -> set[str]:
    """Return the list of dimension names present in all nodes of the dataqube.

    Returns
    -------
    set[str]
        A set of dimension names.

    Usage
    -----
    >>> output = QubedOutput(
    ...     dataqube=(Qube.from_datacube({
    ...         'param': ['2t', 'tp'],
    ...         'time': [0, 1, 2],
    ...     }) | Qube.from_datacube({
    ...         'param': ['msl'],
    ...     }))
    ... )
    >>> common_dimensions(output)
    {'param'}
    """
    datacubes = list(qube.to_datacubes())
    if not datacubes:
        return set()
    return set.intersection(*(set(k for k in dc if k != "root") for dc in datacubes))


@support_qubed_output
def contains(qube: Qube, item: Qube | str | dict) -> bool:
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
    >>> contains(output, 'param')
    True
    >>> contains(output, 'level')
    False
    >>> contains(output, {'param': ['2t']})
    True
    >>> contains(output, {'param': ['2t2']})
    False
    >>> contains(output, {'param': ['2t'], 'time': [0, 1], })
    True
    >>> contains(output, {'param': ['2t'], 'time': [0, 3], })
    False
    """
    if isinstance(item, str):
        return item in dimensions(qube)

    lookup: dict = axes(item) if isinstance(item, Qube) else item
    dict_cast_to_list = {k: list(v) if isinstance(v, (set, tuple, list)) else [v] for k, v in lookup.items()}
    current_axes = axes(qube)

    def _contains_axis_values(key: str, values: Iterable[Any]) -> bool:
        return key in current_axes and all(v in current_axes[key] for v in values)

    return all(_contains_axis_values(k, v) for k, v in dict_cast_to_list.items())


def select(
    qube: QubedOutput,
    selection: Mapping[str, Any | Iterable[Any] | Callable[[Any], bool]],
) -> QubedOutput:
    """Return a new QubedOutput with the dataqube matching selection criteria

    Usage
    -----
    >>> output = QubedOutput(dataqube=Qube.from_datacube({
    ...     'param': ['2t', 'tp'],
    ...     'time': [0, 1, 2],
    ... }))
    >>> selection = select(output, {'param': '2t'})
    >>> axes(selection)
    {'param': {'2t'}, 'time': {0, 1, 2}}
    """
    # TODO: Once Qube.select supports callable predicates, pass them through
    # directly instead of requiring pre-filtered lists.

    # Normalise selection values to lists for the Rust API
    normalised: dict[str, list[Any]] = {}
    for k, v in selection.items():
        if callable(v) and not isinstance(v, (str, bytes)):
            warnings.warn(
                f"Callable selection predicates are not yet supported by the Rust Qube. Dimension '{k}' predicate will be ignored.",
                stacklevel=2,
            )
            continue
        if isinstance(v, (list, tuple, set)):
            normalised[k] = list(v)
        else:
            normalised[k] = [v]
    return QubedOutput(dataqube=qube.dataqube.select(normalised))
