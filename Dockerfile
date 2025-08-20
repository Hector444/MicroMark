# --- Fase 1: Builder ---
# Usamos una imagen completa de Node para instalar dependencias
FROM node:18-alpine AS builder
WORKDIR /usr/src/app

# Instalar dependencias del sistema operativo: git para dependencias de npm
RUN apk add --no-cache git

COPY package*.json ./
RUN npm install --omit=dev

# --- Fase 2: Production ---
# Usamos una imagen ligera para la ejecución final
FROM node:18-alpine
WORKDIR /usr/src/app

# Instalar dependencias clave del sistema: FFMPEG y LibreOffice
# python3 y py3-pip son necesarios para el conversor de libreoffice
RUN apk add --no-cache ffmpeg libreoffice python3 py3-pip

# Copiamos las dependencias ya instaladas desde la fase de builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
# Copiamos el código de nuestra aplicación
COPY index.js ./

# Exponemos el puerto en el que correrá nuestro servicio
EXPOSE 3000

# Comando para iniciar el servicio
CMD [ "node", "index.js" ]