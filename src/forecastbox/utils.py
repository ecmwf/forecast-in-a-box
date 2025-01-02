from cascade.low.func import *  # noqa: F403

# NOTE possibly make ext configurable
# NOTE this is not the most visually appealing -- to restore original uvicorn color based logging, use
# https://github.com/encode/uvicorn/blob/master/uvicorn/config.py#L66
logging_config = {
	"version": 1,
	"disable_existing_loggers": True,
	"formatters": {
		"default": {
			"format": "{asctime}:{levelname}:{name}:{process}:{message:1.10000}",
			"style": "{",
		},
	},
	"handlers": {
		"default": {
			"formatter": "default",
			"class": "logging.StreamHandler",
			"stream": "ext://sys.stderr",
		},
	},
	"loggers": {
		"uvicorn": {"level": "INFO"},
		"forecastbox": {"level": "INFO"},
		"forecastbox.worker": {"level": "DEBUG"},
		"forecastbox.executor": {"level": "DEBUG"},
		"cascade": {"level": "INFO"},
		"cascade.shm": {"level": "DEBUG"},
		"cascade.controller": {"level": "DEBUG"},
		"cascade.executors": {"level": "DEBUG"},
		"httpcore": {"level": "ERROR"},
		"httpx": {"level": "ERROR"},
		"": {"level": "WARNING", "handlers": ["default"]},
	},
}
