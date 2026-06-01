You may want to consult the [c4 diagrams](./c4diagrams.md) to give you a better picture.

After you are done with installation, you may want to visit [tuning and configuration](tuningAndConfiguration.md) as well.

# Standalone Setup

The recommended way to run Forecast-in-a-Box is via the self-bootstrapping launcher:

```bash
curl -LsSf https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/main/scripts/fiab.sh > fiab.sh
chmod +x fiab.sh
./fiab.sh
```

This handles uv, Python, dependencies, and launches both the backend and cascade automatically.

# Containerized Setup
Consult the [docker example](../../deployment/ewc), albeit understand that the example is not necessarily up to date.

# Developer Setup

See [backend development](../../backend/development.md) and [frontend guidelines](../../frontend/GUIDELINES.md).

```bash
# backend
cd backend
uv sync --extra runtime --all-packages
just dev

# frontend
cd frontend
npm install
npm run dev
```
