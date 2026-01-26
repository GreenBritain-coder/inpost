FROM node:20-slim

# Install Puppeteer dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set environment variables for Puppeteer BEFORE npm install
# This prevents Puppeteer from downloading Chromium during installation
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including devDependencies for build)
# Use npm install since package-lock.json may not exist
# Explicitly set NODE_ENV=development to ensure devDependencies are installed
RUN NODE_ENV=development npm install

# Copy source code
COPY src ./src

# Build the application (ensure NODE_ENV is development for build)
# Create dist directory first, then compile with verbose output
RUN mkdir -p dist && NODE_ENV=development npx tsc --pretty --listEmittedFiles

# Expose port
EXPOSE 3000

# Set NODE_ENV to production for runtime (can be overridden by deployment platform)
ENV NODE_ENV=production

# Start the application (run migrations first)
CMD ["sh", "-c", "npm run migrate && npm start"]

