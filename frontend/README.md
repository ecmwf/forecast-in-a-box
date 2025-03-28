# FIAB App

Use uv to setup a project / virtual environment in the root directory.

Then setup `.env` file.

```dotfile
DATA_PATH='./data_dir'
MODEL_REPOSITORY=https://sites.ecmwf.int/repository/fiab/
CASCADE_GATEWAY=localhost:8079
API=localhost:8000
```

Run `npm install`

Then to run the server, `npm run next-dev`
