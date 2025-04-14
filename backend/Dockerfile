# Use an official lightweight Python image as the base
FROM python:3.11

# Set the working directory in the container
WORKDIR /app

# Copy the forecastbox directory into the container
COPY forecastbox /app/forecastbox
COPY pyproject.toml /app/pyproject.toml

# Copy the entrypoint script into the container
COPY fiab.sh /app/fiab.sh

# Ensure the entrypoint script is executable
RUN chmod +x /app/fiab.sh

# Install any necessary dependencies (if applicable)
RUN pip install uv

# Install Rust
# RUN apt-get update && apt-get install -y curl && \
#     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
#     . "$HOME/.cargo/env"

ENTRYPOINT ["/app/fiab.sh"]
