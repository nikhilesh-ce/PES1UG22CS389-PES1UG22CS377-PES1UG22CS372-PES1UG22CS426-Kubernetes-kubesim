FROM node:18

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

RUN npm install

# Copy all source files
COPY src/ ./src/

EXPOSE 5000

CMD ["node", "src/app.js"]