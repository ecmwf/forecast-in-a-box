
from enum import StrEnum

class NodeType(StrEnum):
    SOURCE = "source"
    TRANSFORM = "transform"
    SINK = "sink"