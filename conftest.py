import os
import sys

# Ensure the repository root is importable so tests can do
# `from veridian_db.normalizer import ...` regardless of how pytest is invoked.
sys.path.insert(0, os.path.dirname(__file__))