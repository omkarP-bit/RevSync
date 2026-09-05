FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src

RUN npx tsc --noEmit

EXPOSE 3001

CMD ["npm", "run", "dev"]
