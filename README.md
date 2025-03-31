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

python -m forecastbox.standalone.entrypoint 
# or 

uvicorn forecastbox.entrypoint:app --reload --log-level info 
python -m cascade.gateway tcp://localhost:8067
```
