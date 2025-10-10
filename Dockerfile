# Use Node.js official image as base
FROM node:20-slim

# Install Python 3 and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy Python requirements first (for better caching)
COPY pybridge/requirements.txt ./pybridge/
RUN pip3 install --break-system-packages --no-cache-dir -r ./pybridge/requirements.txt

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

