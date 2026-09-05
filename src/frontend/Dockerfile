FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY next.config.js tsconfig.json tailwind.config.ts postcss.config.js ./
COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["npm", "run", "dev"]
