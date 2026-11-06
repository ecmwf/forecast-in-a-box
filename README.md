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

## Overview
Forecast-in-a-Box (FiaB) is a prototype piloted by ECMWF, through an effort jointly funded by [Destination Earth](https://destination-earth.eu/).
It is an open-source software package for running AI-driven weather models end-to-end on a single machine.
FiaB brings together ECMWF’s open-source software stack and AI models — such as ANEMOI, EarthKit, AIFS, PProc — from initial conditions, to the execution of AI-driven models, post-processing (products), and visualisation.
As a monorepo, FiaB builds into one installable Python wheel, `forecast-in-a-box`, which includes the bundled web frontend. Plugins extend it with data sources and products, and are versioned separately.

For more information about the project, please read: [AI-driven solutions for the Digital Twin Engine](https://destine.ecmwf.int/news/forecast-in-a-box-portable-ai-forecasting-workflows-within-the-destine-digital-twin-engine/).

## User guides
The following guides are available for different user profiles:
**[Operator]** Researcher or domain expert with low-to-medium technical proficiency
**[Developer]** Active contributer of Forecast-in-a-Box with medium-to-high technical proficiency

* [User guide](docs/userGuide.md) -- quick start installation and usage on a laptop or server. Audience: Operator, Developer
* [Troubleshooting](docs/troubleshooting.md) -- troubleshooting and tuning. Audience: Operator, Developer
* [Advanced Installation](docs/installation.md) -- upgrade, reinstall and containerised setup. Audience: Operator, Developer
* [Frontend Development](frontend/README.md) -- frontend development. Audience: Developer
* [Backend Development](backend/development.md) -- backend and plugins development. Audience: Developer
* [CI/CD](docs/developer/cicd.md) -- workflows, runners and local run checks. Audience: Developer

## Contributions and Support
Forecast-in-a-Box is provided by ECMWF as an open source software, without support.
External contributions are welcome - please read the [Guidelines](./CONTRIBUTING.md) for more information.

## License
Please consult Forecast-in-a-Box [License Terms](./LICENSE).
