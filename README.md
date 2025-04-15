# Forecast in a Box

Project is in experimental stage. Don't use this yet.

## Usage

How to use this?

### Setup Backend

```bash
uv venv --seed ./
uv pip install ./backend
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

### Docker

Set the ecmwf-api-client keys from [ECMWF API Key Management](https://api.ecmwf.int/v1/key/) as env vars.

Additionally, you will need to clone [anemoi-cascade](https://github.com/ecmwf/anemoi-cascade) alongside this repo.

Then:

```bash
docker-compose up --build
```

### Notes

```fuser -k 12346/tcp```