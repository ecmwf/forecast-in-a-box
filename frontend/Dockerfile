# Use an official node image as the base
FROM node:22-slim

# Set the working directory in the container
WORKDIR /app/frontend/

# Install tools for testing
# ENV DEBIAN_FRONTEND=noninteractive
# RUN apt update && \
#     apt install -y --no-install-recommends curl iproute2 \
#     && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy the frontend directory into the container
COPY ./ ./

# Install fiab dependencies
RUN yarn install && \
    yarn add vite && \
    yarn prodbuild

# ENV VITE_API_BASE="http://backend:8000"
CMD ["yarn", "preview"]
EXPOSE 3000
