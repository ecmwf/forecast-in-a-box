# Step 1: Use Node.js as the base image
FROM node:18-alpine AS builder

# Step 2: Set the working directory inside the container
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Step 3: Copy package.json and package-lock.json to the working directory
COPY package.json ./

# Step 4: Install dependencies
RUN npm install

# Step 5: Copy the rest of the application code
COPY . .

# Step 6: Build the Next.js application
RUN npm run build

# Step 7: Use a lightweight web server to serve the built application
FROM node:18-alpine AS runner

# Step 8: Set the working directory for the runtime container
WORKDIR /app

# Step 9: Copy the built application from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

# Step 10: Install only production dependencies
RUN npm install --production

# Step 11: Expose the port the app will run on
EXPOSE 3000

# Step 12: Start the Next.js application
CMD ["npm", "start"]