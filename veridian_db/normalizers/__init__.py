"""
Veridian spec normalizers.

Dedicated, single-purpose parsers for the canonical specification types:
CPU, GPU, RAM (memory), storage, and display. The primary orchestrator in
``veridian_db.normalizer`` delegates to these modules instead of inlining the
parsing logic.
"""

from .base import NormalizedValue, infer_type
from .cpu import parse_cpu, is_cpu_spec_name, CPU_PATTERNS
from .gpu import parse_gpu, is_gpu_spec_name, GPU_PATTERNS
from .memory import parse_memory
from .storage import parse_storage
from .display import parse_display, is_display_spec_name, PANEL_TYPES

__all__ = [
    # base
    'NormalizedValue',
    'infer_type',
    # cpu
    'parse_cpu',
    'is_cpu_spec_name',
    'CPU_PATTERNS',
    # gpu
    'parse_gpu',
    'is_gpu_spec_name',
    'GPU_PATTERNS',
    # memory
    'parse_memory',
    # storage
    'parse_storage',
    # display
    'parse_display',
    'is_display_spec_name',
    'PANEL_TYPES',
]