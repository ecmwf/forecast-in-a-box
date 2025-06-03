# Use an official lightweight Python image as the base
# 3.11 required by mir
FROM python:3.11-slim

# Install system deps
ENV DEBIAN_FRONTEND=noninteractive

# Set the working directory in the container
WORKDIR /app/cascade

# Copy the backend directory into the container
COPY install.sh /app/cascade/install.sh

# Install UV
COPY --from=ghcr.io/astral-sh/uv:0.7.8 /uv /uvx /bin/

# Create a virtual env. Install fiab dependencies, with caching
RUN --mount=type=cache,mode=0755,target=/root/.cache/uv sh /app/cascade/install.sh

ENV PATH="/app/.venv/bin/:$PATH"
ENTRYPOINT ["/app/.venv/bin/python", "-m", "cascade.gateway", "tcp://0.0.0.0:8067"]

