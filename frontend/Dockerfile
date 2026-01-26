FROM node:20-alpine AS builder

WORKDIR /app

# Accept build-time arguments for Vite environment variables
# Default to localhost if not provided (for local builds)
ARG VITE_API_URL=http://localhost:3000/api
ENV VITE_API_URL=$VITE_API_URL

# Print the API URL being used (for debugging)
RUN echo "Building with VITE_API_URL=$VITE_API_URL"

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY vite.config.ts ./

# Install dependencies (including devDependencies for build)
# Use npm install since package-lock.json may not exist
# Explicitly set NODE_ENV=development to ensure devDependencies are installed
RUN NODE_ENV=development npm install

# Copy source code
COPY src ./src
COPY index.html ./

# Build the application (ensure NODE_ENV is development for build)
# VITE_API_URL will be baked into the build at this step
RUN NODE_ENV=development npm run build

# Verify build output exists
RUN ls -la /app/dist && \
    if [ ! -f /app/dist/index.html ]; then \
      echo "ERROR: index.html not found in dist folder!" && \
      exit 1; \
    fi && \
    echo "Build verification: Files in dist folder:" && \
    ls -la /app/dist/

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Verify files were copied
RUN ls -la /usr/share/nginx/html && \
    if [ ! -f /usr/share/nginx/html/index.html ]; then \
      echo "ERROR: index.html not found in nginx html directory!" && \
      exit 1; \
    fi && \
    echo "Nginx setup verification: Files in html directory:" && \
    ls -la /usr/share/nginx/html/

# Remove any existing templates to prevent template processing
RUN rm -rf /etc/nginx/templates/*

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
