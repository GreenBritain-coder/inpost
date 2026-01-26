FROM node:20-alpine AS builder

WORKDIR /app

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
RUN NODE_ENV=development npm run build

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Remove any existing templates to prevent template processing
RUN rm -rf /etc/nginx/templates/*

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
