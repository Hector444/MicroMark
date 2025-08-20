# --- Fase 1: Builder ---
FROM node:18-bullseye-slim AS builder
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y --no-install-recommends git
COPY package*.json ./
RUN npm install --omit=dev

# --- Fase 2: Production ---
FROM node:18-bullseye-slim
WORKDIR /usr/src/app

# Habilitar repositorios y aceptar licencia de fuentes
RUN sed -i 's/main/main contrib non-free/g' /etc/apt/sources.list && \
    apt-get update && \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections

# Instalar dependencias clave incluyendo yt-dlp
RUN apt-get install -y --no-install-recommends \
    ffmpeg \
    libreoffice \
    ttf-mscorefonts-installer \
    python3-pip \
    && pip3 install yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copiar artefactos de la fase de builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY index.js ./

EXPOSE 3000
CMD [ "node", "index.js" ]