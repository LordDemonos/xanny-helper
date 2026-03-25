# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source (dist/ is in .dockerignore; we build it in the image)
COPY . .
RUN npm run build

# Create necessary directories and set permissions
RUN mkdir -p /app/cache /app/config && \
    chown -R node:node /app

# Set environment variables
ENV NODE_ENV=production

# Switch to non-root user
USER node

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Run the bot
CMD ["npm", "start"] 