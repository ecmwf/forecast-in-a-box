# Forecast in a Box

Project is in experimental stage. Don't use this yet.

## Usage

How to use this?

### Setup Backend

```bash
uv venv --seed ./
uv pip install ./
```

### Setup frontend

```bash
npm install
```

### Running

Running the server

```bash
npm run next-dev &

uv run --module forecastbox.standalone.entrypoint 
# or 
uv run uvicorn forecastbox.entrypoint:app --reload --log-level info & 
uv run --module cascade.gateway CASCADE_URL
```
