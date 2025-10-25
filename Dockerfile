# Use Node.js official image as base
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port (Render will set PORT env var)
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

