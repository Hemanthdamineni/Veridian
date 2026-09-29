import importlib
import sys

mods = ["requests", "bs4", "yaml", "lxml", "playwright", "pytest", "aiohttp", "dateutil"]
print("python", sys.version.split()[0])
for m in mods:
    try:
        mod = importlib.import_module(m)
        ver = getattr(mod, "__version__", "?")
        print(f"OK   {m} {ver}")
    except Exception as e:  # noqa: BLE001
        print(f"MISS {m}: {type(e).__name__}: {e}")
