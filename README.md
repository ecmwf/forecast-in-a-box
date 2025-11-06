# Forecast in a Box

<p align="center">
  <a href="https://github.com/ecmwf/codex/raw/refs/heads/main/Project%20Maturity">
    <img src="https://github.com/ecmwf/codex/raw/refs/heads/main/Project%20Maturity/emerging_badge.svg" alt="Static Badge"></a>

<a href="https://codecov.io/gh/ecmwf/forecast-in-a-box">
    <img src="https://codecov.io/gh/ecmwf/forecast-in-a-box/branch/develop/graph/badge.svg" alt="Code Coverage"></a>

<a href="https://opensource.org/licenses/apache-2-0">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>

<a href="https://github.com/ecmwf/forecast-in-a-box/releases">
    <img src="https://img.shields.io/github/v/release/ecmwf/forecast-in-a-box?color=blue&label=Release&style=flat-square" alt="Latest Release"></a>
</p>

> \[!IMPORTANT\]
> This software is **Emerging** and subject to ECMWF's guidelines on [Software Maturity](https://github.com/ecmwf/codex/raw/refs/heads/main/Project%20Maturity).

Forecast-In-A-Box is a prototype AI solution concept piloted by ECMWF, through an effort jointly funded by [Destination Earth](https://destination-earth.eu/) and ECMWF core activities. It showcases a way to containerize and package complete AI-based forecasting pipelines, bringing together ECMWF’s open-source software and AI models — such as ANEMOI, EarthKit, AIFS, PProc and other components of the ECMWF stack — to cover all stages of the forecasting process, from using data inputs from ECMWF’s analyses to the execution of AI models, post-processing, and visualization.

It allows to run any model that subscribes to the Anemoi-Inference interface.

For more information read: [AI-driven solutions for the Digital Twin Engine](https://destine.ecmwf.int/news/forecast-in-a-box-portable-ai-forecasting-workflows-within-the-destine-digital-twin-engine/).

There are the following guides:
* [User Guide](docs/userGuide.md) -- basic installation and usage on a personal laptop. Audience: Researcher
* [Troubleshooting](docs/troubleshooting.md) -- general purpose troubleshooting and tuning. Audience: Operator, Developer
* [Advanced Installation](docs/advancedInstallation.md) -- cluster, cloud, and docker deployments. Audience: Operator, Developer
* [Tuning and Configuration](docs/tuningAndConfiguration.md) -- advanced tweaking. Audience: Operator
* [Frontend Development](frontend/README.md) -- specifics to the javascript frontend. Audience: Developer
* [Backend Development](backend/README.md#Development) -- specifics to the python backend. Audience: Developer

## Contributions and Support
Due to the maturity and status of the project, there is no support provided -- unless the usage of this project happens within some higher-status initiative that ECMWF participates at.
External contributions and created issues will be looked at, but are not guaranteed to be accepted or responded to.
In general, follow ECMWF's guidelines for [external contributions](https://github.com/ecmwf/codex/tree/main/External%20Contributions).

## License
See [license](./LICENSE).
